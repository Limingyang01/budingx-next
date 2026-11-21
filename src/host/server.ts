// Host service: roles, routing, approvals and event fan-out (SP008 design §3).
//
// One process may own a session; every attached client is either that
// process's owner client (first hello when the process holds writer.lock) or
// a read-only observer. The server forwards SessionEvent values verbatim and
// adds no session content of its own.
import type { Message, SessionEvent } from '../core/events.js'
import type { PermissionMode } from '../core/permissions.js'
import type { SessionStore } from '../storage/session-store.js'
import type { HostEngine, HostHistory } from './engine.js'
import {
  HostOwnershipError,
  SessionOwnershipRole
} from './ownership.js'
import {
  HOST_PROTOCOL_VERSION,
  HOST_SCOPE,
  encodeFrame,
  parseClientFrame,
  type DescribeResult,
  type HelloResult,
  type HistoryResult,
  type HostError,
  type HostErrorCode,
  type HostRequestFrame,
  type HostResponseFrame,
  type HostRole,
  type HostServerFrame
} from './protocol.js'

/** One transport connection. Transports own framing, not policy. */
export type HostConnection = {
  send(text: string): void
  close(code?: number, reason?: string): void
  onLine(handler: (line: string) => void): void
  onClose(handler: () => void): void
}

export type HostServerOptions = {
  sessionId: string
  workspaceId: string
  ownership: SessionOwnershipRole
  engine?: HostEngine
  /** Read-only recovery fallback used when no engine is attached. */
  sessionStore: SessionStore
  /** Called after shutdown frames are sent and the lock is released. */
  onShutdown?: () => void
}

type ClientState = {
  connection: HostConnection
  helloed: boolean
  role: HostRole
  clientId: string
  usedIds: Set<string>
}

function fail(error: HostError): HostResponseFrame {
  return { id: '', ok: false, error }
}

/**
 * Host service shared by all transports. Attaching a connection never grants
 * write access: the hello reply assigns owner or observer, and every
 * management request re-checks both the client role and the writer lock.
 */
export class HostServer {
  private readonly clients = new Set<ClientState>()
  private readonly ownership: SessionOwnershipRole
  private readonly engine: HostEngine | undefined
  private readonly sessionStore: SessionStore
  private readonly options: HostServerOptions
  private eventSeq = 0
  private clientSeq = 0
  private unsubscribe: (() => void) | undefined
  private closing = false
  private shutdownTask: Promise<void> | undefined

  constructor(options: HostServerOptions) {
    this.options = options
    this.ownership = options.ownership
    this.engine = options.engine
    this.sessionStore = options.sessionStore
    if (options.engine) {
      this.unsubscribe = options.engine.onEvent((event) => this.broadcastEvent(event))
    }
  }

  get clientCount(): number {
    return this.clients.size
  }

  get role(): HostRole {
    return this.ownership.role
  }

  /** Attach one transport connection and start routing its frames. */
  attach(connection: HostConnection): void {
    if (this.closing) {
      connection.close(1001, 'server is shutting down')
      return
    }
    const client: ClientState = {
      connection,
      helloed: false,
      role: 'observer',
      clientId: '',
      usedIds: new Set()
    }
    this.clients.add(client)
    connection.onLine((line) => this.handleLine(client, line))
    connection.onClose(() => {
      this.clients.delete(client)
    })
  }

  /** Close every connection, release the writer lock and dispose the engine. */
  shutdown(): Promise<void> {
    if (this.shutdownTask) return this.shutdownTask
    this.closing = true
    this.shutdownTask = (async () => {
      this.unsubscribe?.()
      this.unsubscribe = undefined
      try {
        await this.engine?.dispose()
      } finally {
        this.ownership.release()
        for (const client of this.clients) {
          client.connection.close(1000, 'server shutdown')
        }
        this.clients.clear()
        this.options.onShutdown?.()
      }
    })()
    return this.shutdownTask
  }

  private handleLine(client: ClientState, line: string): void {
    if (this.closing) {
      this.send(client, { id: '', ok: false, error: this.error('HOST_STATE_006', 'server is shutting down') })
      return
    }
    const parsed = parseClientFrame(line)
    if (!parsed.ok) {
      this.send(client, { id: this.extractId(line), ok: false, error: parsed.error })
      return
    }
    const frame = parsed.frame
    if (frame.type !== 'hello' && !client.helloed) {
      this.send(client, { id: frame.id, ok: false, error: this.error('HOST_AUTH_004', 'send hello before any other request') })
      return
    }
    if (frame.type === 'hello' && client.helloed) {
      this.send(client, { id: frame.id, ok: false, error: this.error('HOST_STATE_006', 'hello was already completed') })
      return
    }
    if (frame.type === 'hello') {
      this.handleHello(client, frame)
      return
    }
    if (client.usedIds.has(frame.id)) {
      this.send(client, {
        id: frame.id,
        ok: false,
        error: this.error('HOST_PROTOCOL_002', `request id ${frame.id} was already used on this connection`)
      })
      return
    }
    client.usedIds.add(frame.id)

    switch (frame.type) {
      case 'ping':
        this.send(client, { id: frame.id, ok: true, result: { pong: true } })
        return
      case 'describe':
        this.handleDescribe(client, frame)
        return
      case 'history':
        this.handleHistory(client, frame)
        return
      case 'submit':
        if (!this.requireWrite(client, frame.id)) return
        this.engine?.submit(frame.text)
        this.send(client, { id: frame.id, ok: true, result: { accepted: true } })
        return
      case 'interrupt':
        if (!this.requireWrite(client, frame.id)) return
        this.send(client, {
          id: frame.id,
          ok: true,
          result: { interrupted: this.engine?.interrupt() ?? false }
        })
        return
      case 'approval':
        if (!this.requireWrite(client, frame.id)) return
        this.handleApproval(client, frame)
        return
      case 'set_permission_mode':
        if (!this.requireWrite(client, frame.id)) return
        this.handlePermissionMode(client, frame)
        return
      case 'takeover':
        this.handleTakeover(client, frame)
        return
      case 'shutdown':
        this.handleShutdown(client, frame)
        return
    }
  }

  private handleHello(client: ClientState, frame: Extract<HostRequestFrame, { type: 'hello' }>): void {
    if (frame.version !== HOST_PROTOCOL_VERSION) {
      this.send(client, {
        id: frame.id,
        ok: false,
        error: this.error(
          'HOST_PROTOCOL_001',
          `protocol version ${frame.version} is not supported; this host speaks ${HOST_PROTOCOL_VERSION}`
        )
      })
      return
    }
    const ownerTaken = [...this.clients].some((other) => other !== client && other.role === 'owner')
    const role: HostRole = this.ownership.role === 'owner' && !ownerTaken ? 'owner' : 'observer'
    client.helloed = true
    client.role = role
    client.clientId = frame.clientId ?? `client-${++this.clientSeq}`
    const result: HelloResult = {
      type: 'hello_ok',
      protocolVersion: HOST_PROTOCOL_VERSION,
      sessionId: this.options.sessionId,
      workspaceId: this.options.workspaceId,
      clientId: client.clientId,
      role,
      scope: HOST_SCOPE
    }
    this.send(client, { id: frame.id, ok: true, result })
  }

  private handleDescribe(client: ClientState, frame: Extract<HostRequestFrame, { type: 'describe' }>): void {
    const description = this.describe()
    const result: DescribeResult = { ...description, role: client.role, scope: HOST_SCOPE }
    this.send(client, { id: frame.id, ok: true, result })
  }

  private handleHistory(client: ClientState, frame: Extract<HostRequestFrame, { type: 'history' }>): void {
    const history = this.history(frame.limit)
    const result: HistoryResult = { messages: history.messages, truncated: history.truncated }
    this.send(client, { id: frame.id, ok: true, result })
  }

  private handleApproval(
    client: ClientState,
    frame: Extract<HostRequestFrame, { type: 'approval' }>
  ): void {
    if (!this.engine) {
      this.send(client, { id: frame.id, ok: false, error: this.error('HOST_STATE_006', 'no engine is attached') })
      return
    }
    const accepted = this.engine.approve(frame.requestId, frame.outcome)
    if (!accepted) {
      this.send(client, {
        id: frame.id,
        ok: false,
        error: this.error('HOST_STATE_006', `no pending approval request ${frame.requestId}`)
      })
      return
    }
    this.send(client, { id: frame.id, ok: true, result: { accepted: true } })
  }

  private handlePermissionMode(
    client: ClientState,
    frame: Extract<HostRequestFrame, { type: 'set_permission_mode' }>
  ): void {
    if (!this.engine) {
      this.send(client, { id: frame.id, ok: false, error: this.error('HOST_STATE_006', 'no engine is attached') })
      return
    }
    const changed = this.engine.setPermissionMode(frame.mode)
    if (!changed) {
      this.send(client, { id: frame.id, ok: false, error: this.error('HOST_STATE_006', 'permission mode was not applied') })
      return
    }
    this.send(client, { id: frame.id, ok: true, result: { mode: frame.mode } })
  }

  private handleTakeover(client: ClientState, frame: Extract<HostRequestFrame, { type: 'takeover' }>): void {
    if (!this.engine) {
      this.send(client, { id: frame.id, ok: false, error: this.error('HOST_STATE_006', 'no engine is attached') })
      return
    }
    try {
      this.ownership.takeover()
    } catch (error) {
      if (error instanceof HostOwnershipError) {
        this.send(client, { id: frame.id, ok: false, error: this.error(error.code, error.message) })
        return
      }
      throw error
    }
    for (const other of this.clients) {
      if (other !== client && other.role === 'owner') other.role = 'observer'
    }
    client.role = 'owner'
    this.send(client, { id: frame.id, ok: true, result: { role: 'owner' } })
    this.broadcastRole()
  }

  private handleShutdown(client: ClientState, frame: Extract<HostRequestFrame, { type: 'shutdown' }>): void {
    this.send(client, { id: frame.id, ok: true, result: { stopping: true } })
    void this.shutdown()
  }

  private describe(): Omit<DescribeResult, 'role' | 'scope'> {
    if (this.engine) {
      const description = this.engine.describe()
      return {
        sessionId: description.sessionId,
        workspaceId: description.workspaceId,
        ...(description.title ? { title: description.title } : {}),
        state: description.state,
        planMode: description.planMode,
        permissionMode: description.permissionMode
      }
    }
    const summary = this.sessionStore.summary(this.options.sessionId)
    return {
      sessionId: this.options.sessionId,
      workspaceId: this.options.workspaceId,
      ...(summary ? { title: summary.title } : {}),
      state: 'unknown',
      planMode: false,
      permissionMode: 'read_only'
    }
  }

  private history(limit?: number): HostHistory {
    const source = this.engine
      ? this.engine.history(limit)
      : this.readOnlyHistory()
    if (limit === undefined || limit >= source.messages.length) return source
    const messages: Message[] = source.messages.slice(source.messages.length - limit)
    return { messages, truncated: true }
  }

  private readOnlyHistory(): HostHistory {
    const restored = this.sessionStore.restore(this.options.sessionId)
    return { messages: restored.messages as unknown as Message[], truncated: false }
  }

  /** Re-check lock ownership and the client role before any write path. */
  private requireWrite(client: ClientState, id: string): boolean {
    const role = this.ownership.refresh()
    if (role !== 'owner') {
      this.demoteOwnerClients()
      this.broadcastRole()
    }
    if (role !== 'owner' || client.role !== 'owner' || !this.engine) {
      const code: HostErrorCode = 'HOST_SESSION_003'
      this.send(client, {
        id,
        ok: false,
        error: this.error(code, 'session is owned by another writer; this connection is read-only')
      })
      return false
    }
    return true
  }

  private demoteOwnerClients(): void {
    for (const other of this.clients) {
      if (other.role === 'owner') other.role = 'observer'
    }
  }

  private broadcastEvent(event: SessionEvent): void {
    const frame: HostServerFrame = { type: 'event', seq: ++this.eventSeq, event }
    for (const client of this.clients) {
      if (client.helloed) this.send(client, frame)
    }
  }

  private broadcastRole(): void {
    for (const client of this.clients) {
      if (client.helloed) this.send(client, { type: 'role_changed', role: client.role })
    }
  }

  private send(client: ClientState, frame: HostServerFrame): void {
    try {
      client.connection.send(encodeFrame(frame))
    } catch {
      // A broken transport is closed by its own onClose handler.
    }
  }

  private error(code: HostErrorCode, message: string): HostError {
    return { code, message }
  }

  private extractId(line: string): string {
    try {
      const parsed = JSON.parse(line) as { id?: unknown }
      return typeof parsed.id === 'string' ? parsed.id : ''
    } catch {
      return ''
    }
  }
}

export { fail }
