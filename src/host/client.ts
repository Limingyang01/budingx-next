// SP008 T10：轻量宿主客户端。传输无关，stdio / 进程内 / WebSocket 复用同一实现。
import type { SessionEvent } from '../core/events.js'
import {
  encodeFrame,
  type HelloResult,
  type HostErrorCode,
  type HostRequestFrame,
  type HostRequestType,
  type HostResponseFrame,
  type HostResult,
  type HostRole
} from './protocol.js'
import type { HostTransport } from './transport/transport.js'

export class HostRequestError extends Error {
  constructor(
    readonly code: HostErrorCode,
    message: string
  ) {
    super(message)
  }
}

export type HostClientOptions = {
  transport: HostTransport
  protocolVersion?: number
  clientId?: string
  requestTimeoutMs?: number
}

type Pending = {
  resolve: (result: HostResult) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class HostClient {
  private readonly transport: HostTransport
  private readonly protocolVersion: number
  private readonly clientId: string | undefined
  private readonly requestTimeoutMs: number
  private readonly pending = new Map<string, Pending>()
  private readonly eventListeners = new Set<(event: SessionEvent, seq: number) => void>()
  private readonly roleListeners = new Set<(role: HostRole) => void>()
  private readonly closeListeners = new Set<(reason?: string) => void>()
  private seq = 0
  private roleValue: HostRole | undefined
  private closed = false

  constructor(options: HostClientOptions) {
    this.transport = options.transport
    this.protocolVersion = options.protocolVersion ?? 1
    this.clientId = options.clientId
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000
    this.transport.onLine((line) => this.handleLine(line))
    this.transport.onClose((reason) => this.handleClose(reason))
  }

  get role(): HostRole | undefined {
    return this.roleValue
  }

  get isClosed(): boolean {
    return this.closed
  }

  async connect(): Promise<HelloResult> {
    const result = (await this.request('hello', {
      version: this.protocolVersion,
      ...(this.clientId ? { clientId: this.clientId } : {})
    })) as HelloResult
    this.roleValue = result.role
    return result
  }

  request(
    type: Exclude<HostRequestType, 'hello'> | 'hello',
    payload: Record<string, unknown> = {}
  ): Promise<HostResult> {
    if (this.closed) {
      return Promise.reject(new HostRequestError('HOST_STATE_006', 'client is closed'))
    }
    this.seq += 1
    const id = 'c' + this.seq
    return new Promise<HostResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new HostRequestError('HOST_STATE_006', 'request timed out: ' + type))
      }, this.requestTimeoutMs)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
      this.transport.write(encodeFrame({ ...payload, id, type } as HostRequestFrame))
    })
  }

  onEvent(listener: (event: SessionEvent, seq: number) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  onRoleChanged(listener: (role: HostRole) => void): () => void {
    this.roleListeners.add(listener)
    return () => this.roleListeners.delete(listener)
  }

  onClose(listener: (reason?: string) => void): () => void {
    if (this.closed) {
      queueMicrotask(() => listener())
      return () => {}
    }
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  close(reason?: string): void {
    this.transport.close(reason)
    this.handleClose(reason)
  }

  private handleLine(line: string): void {
    let frame: unknown
    try {
      frame = JSON.parse(line)
    } catch {
      return
    }
    if (typeof frame !== 'object' || frame === null) return
    const record = frame as Record<string, unknown>
    if (record.type === 'event') {
      const seq = typeof record.seq === 'number' ? record.seq : 0
      for (const listener of this.eventListeners) listener(record.event as SessionEvent, seq)
      return
    }
    if (record.type === 'role_changed') {
      this.roleValue = record.role as HostRole
      for (const listener of this.roleListeners) listener(this.roleValue)
      return
    }
    if (record.type === 'fatal') {
      const code = record.code as HostErrorCode
      const message = typeof record.message === 'string' ? record.message : 'fatal host error'
      this.failAll(new HostRequestError(code, message))
      return
    }
    if (typeof record.id === 'string' && this.pending.has(record.id)) {
      const response = record as unknown as HostResponseFrame
      const pending = this.pending.get(record.id) as Pending
      this.pending.delete(record.id)
      clearTimeout(pending.timer)
      if (response.ok) pending.resolve(response.result)
      else pending.reject(new HostRequestError(response.error.code, response.error.message))
    }
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      clearTimeout(pending.timer)
      pending.reject(error)
    }
  }

  private handleClose(reason?: string): void {
    if (this.closed) return
    this.closed = true
    this.failAll(new HostRequestError('HOST_STATE_006', 'client closed'))
    for (const listener of this.closeListeners) listener(reason)
    this.closeListeners.clear()
  }
}
