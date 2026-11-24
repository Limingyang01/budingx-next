import { stripVTControlCharacters } from 'node:util'
import { addAbortListener } from 'node:events'
import { openTransport, resolveMcpEnv, type RpcMessage } from './transport.js'
import {
  McpError,
  type McpClientOptions,
  type McpElicitationAction,
  type McpResourceDescriptor,
  type McpServerConfig,
  type McpToolDescriptor
} from './types.js'

export { resolveMcpEnv }
export const MCP_PROTOCOL_VERSION = '2025-06-18'
const supportedVersions = new Set([MCP_PROTOCOL_VERSION, '2025-03-26', '2024-11-05'])

export function mcpToolName(server: string, tool: string): string {
  const segment = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_')
  return `mcp__${segment(server)}__${segment(tool)}`
}

type Pending = { resolve(value: any): void; reject(error: Error): void }
export class McpClient {
  readonly name: string
  private transport?: Awaited<ReturnType<typeof openTransport>>
  private readonly lifetime = new AbortController()
  private readonly privateValues: string[]
  private readonly pending = new Map<number, Pending>()
  private readonly prompts = new Map<string | number, AbortController>()
  private nextId = 1
  private descriptors: McpToolDescriptor[] = []
  private catalog: McpResourceDescriptor[] = []
  private refreshing = false
  private changed = false
  private ready = false
  protocolVersion?: string
  serverInfo?: { name?: string; version?: string }
  capabilities?: Record<string, unknown>

  private constructor(
    readonly config: McpServerConfig,
    private readonly options: McpClientOptions
  ) {
    this.name = config.name
    const refs = 'command' in config ? config.env : config.headers
    const credential = /auth|token|passwd|password|secret|credential|cookie|(?:^|[_-])key(?:$|[_-])|apikey/i
    const values = Object.entries(resolveMcpEnv(refs, options.env))
      .filter(([name, value]) => !('command' in config) ||
        credential.test(name) || credential.test((refs?.[name] ?? '').replace(/[\${}]/g, '')) ||
        /^(?:Bearer|Basic)\s+/i.test(value)
      )
      .map(([, value]) => value)
    this.privateValues = values
      .flatMap((value) => [value, value.replace(/^(?:Bearer|Basic)\s+/i, '')])
      .filter(Boolean)
  }

  // Diagnostic/status text can quote values supplied privately to this source.
  private displayText(value: string): string {
    let text = stripVTControlCharacters(value)
    for (const binding of this.privateValues) text = text.replaceAll(binding, '[redacted]')
    return text
  }

  private displayValue(value: unknown): unknown {
    if (typeof value === 'string') return this.displayText(value)
    if (Array.isArray(value)) return value.map((entry) => this.displayValue(entry))
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [this.displayText(key), this.displayValue(entry)])
      )
    }
    return value
  }

  private failure(
    code: 'BUDINGX_MCP_CONNECT_FAILED' | 'BUDINGX_MCP_SERVER_EXITED' | 'BUDINGX_MCP_PROTOCOL',
    reason: string
  ) {
    return new McpError(code, `MCP ${this.name} ${reason}`)
  }

  static async connect(config: McpServerConfig, options: McpClientOptions = {}): Promise<McpClient> {
    const client = new McpClient(config, options)
    const timeout = options.connectTimeoutMs ?? 10_000
    const signal = AbortSignal.any([
      AbortSignal.timeout(timeout),
      client.lifetime.signal,
      ...(options.signal ? [options.signal] : [])
    ])
    try {
      client.transport = await openTransport(
        config,
        options.env ?? process.env,
        {
          receive: (msg) => client.onMessage(msg),
          disconnected: () => client.disconnect()
        },
        signal
      )
      const initialized = await client.request(
        'initialize',
        {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: options.onElicitation ? { elicitation: {} } : {},
          clientInfo: { name: 'budingx', version: '1' }
        },
        timeout,
        signal
      )
      if (!supportedVersions.has(initialized?.protocolVersion))
        throw client.failure('BUDINGX_MCP_PROTOCOL', '不支持该协议版本')
      client.protocolVersion = initialized.protocolVersion
      client.capabilities = initialized.capabilities ?? {}
      const info = initialized.serverInfo
      client.serverInfo = {
        ...(typeof info?.name === 'string' ? { name: client.displayText(info.name) } : {}),
        ...(typeof info?.version === 'string' ? { version: client.displayText(info.version) } : {})
      }
      client.transport.initialized?.(initialized.protocolVersion)
      await client.transport.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, signal)
      await client.discover(timeout, signal)
      signal.throwIfAborted()
      client.ready = true
      if (client.changed) void client.refresh()
      return client
    } catch (error) {
      await client.close()
      if (error instanceof McpError) throw error
      throw client.failure('BUDINGX_MCP_CONNECT_FAILED', '连接失败')
    }
  }

  private onMessage(msg: RpcMessage): void {
    if (msg?.jsonrpc !== '2.0' || this.isClosed) return
    if (msg.method && msg.id !== undefined) {
      void this.respond(msg).catch(() => this.disconnect())
    } else if (!msg.method && typeof msg.id === 'number') {
      const entry = this.pending.get(msg.id)
      if (msg.error) entry?.reject(this.failure('BUDINGX_MCP_PROTOCOL', '协议错误 ' + Number(msg.error.code)))
      else if ('result' in msg) entry?.resolve(msg.result)
    } else if (msg.method === 'notifications/cancelled') {
      this.prompts.get(msg.params?.requestId)?.abort()
    } else if (
      msg.method === 'notifications/tools/list_changed' ||
      msg.method === 'notifications/resources/list_changed'
    ) {
      this.changed = true
      if (this.ready) void this.refresh()
    }
  }

  private async refresh() {
    if (this.refreshing) return
    this.refreshing = true
    try {
      while (this.changed && !this.isClosed) {
        this.changed = false
        await this.discover(this.options.connectTimeoutMs ?? 10_000)
        this.options.onToolsChanged?.()
      }
    } catch {
      this.disconnect()
    } finally {
      this.refreshing = false
    }
  }

  private async respond(msg: RpcMessage) {
    const reply: RpcMessage = { jsonrpc: '2.0', id: msg.id }
    if (msg.method === 'ping') reply.result = {}
    else if (msg.method === 'elicitation/create') {
      const params = msg.params
      const schema = params?.requestedSchema
      const properties = schema?.properties
      const canPresent =
        (params?.mode === undefined || params.mode === 'form') &&
        schema?.type === 'object' &&
        properties &&
        typeof properties === 'object' &&
        !Array.isArray(properties) &&
        Object.keys(properties).length === 0 &&
        (!schema.required || schema.required.length === 0) &&
        typeof params?.message === 'string' &&
        params.message.length > 0 &&
        params.message.length <= 2000
      const action =
        canPresent && this.options.onElicitation && this.prompts.size === 0
          ? await this.confirm(msg.id!, this.displayText(params.message))
          : 'decline'
      reply.result = action === 'accept' ? { action, content: {} } : { action }
    } else reply.error = { code: -32601, message: 'Method not supported' }
    if (!this.isClosed)
      await this.transport!.send(
        reply,
        AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.options.callTimeoutMs ?? 30_000)])
      )
  }

  private async confirm(id: string | number, message: string): Promise<McpElicitationAction> {
    const cancel = new AbortController()
    const signal = AbortSignal.any([
      cancel.signal,
      this.lifetime.signal,
      AbortSignal.timeout(this.options.elicitationTimeoutMs ?? 60_000)
    ])
    this.prompts.set(id, cancel)
    const cancelled = new Promise<'cancel'>((resolve) =>
      signal.addEventListener('abort', () => resolve('cancel'), { once: true })
    )
    try {
      const action = await Promise.race([
        cancelled,
        this.options.onElicitation!({ server: this.name, message, signal })
      ])
      return action === 'accept' || action === 'decline' ? action : 'cancel'
    } catch {
      return 'cancel'
    } finally {
      this.prompts.delete(id)
      cancel.abort()
    }
  }

  private disconnect(): void {
    if (this.isClosed) return
    const error = this.failure('BUDINGX_MCP_SERVER_EXITED', '连接已断开')
    void this.close()
    this.options.onClose?.(error)
  }

  private async request(
    method: string,
    params: unknown,
    timeout: number,
    caller?: AbortSignal
  ): Promise<any> {
    if (this.isClosed) throw this.failure('BUDINGX_MCP_SERVER_EXITED', '已关闭')
    const timeoutSignal = AbortSignal.timeout(timeout)
    const signal = AbortSignal.any([this.lifetime.signal, timeoutSignal, ...(caller ? [caller] : [])])
    const id = this.nextId++
    let listener: Disposable | undefined
    try {
      return await new Promise((resolve, reject) => {
        listener = addAbortListener(signal, () =>
          reject(
            this.isClosed
              ? this.failure('BUDINGX_MCP_SERVER_EXITED', '已关闭')
              : new McpError(
                  'BUDINGX_MCP_TIMEOUT',
                  `MCP ${this.name} ${method} ${timeoutSignal.aborted ? '超时' : '已取消'}`
                )
          )
        )
        if (signal.aborted) return
        this.pending.set(id, { resolve, reject })
        void this.transport!.send({ jsonrpc: '2.0', id, method, params }, signal).catch((error) => {
          if (signal.aborted) return
          if (error instanceof McpError && error.code === 'BUDINGX_MCP_PROTOCOL') reject(error)
          else {
            reject(this.failure('BUDINGX_MCP_SERVER_EXITED', '连接已断开'))
            this.disconnect()
          }
        })
      })
    } finally {
      listener?.[Symbol.dispose]()
      this.pending.delete(id)
    }
  }

  private async pages(key: 'tools' | 'resources', timeout: number, signal?: AbortSignal): Promise<any[]> {
    const rows: any[] = []
    const cursors = new Set<string>()
    let cursor: string | undefined
    do {
      const page = await this.request(key + '/list', cursor ? { cursor } : {}, timeout, signal)
      if (!Array.isArray(page?.[key])) throw this.failure('BUDINGX_MCP_PROTOCOL', '无效目录')
      rows.push(...page[key])
      if (!page.nextCursor) break
      cursor = page.nextCursor
      if (typeof cursor !== 'string' || cursors.has(cursor) || cursors.size >= 100)
        throw this.failure('BUDINGX_MCP_PROTOCOL', '无效目录分页')
      cursors.add(cursor)
    } while (cursor)
    return rows
  }

  private async discover(timeout: number, signal?: AbortSignal) {
    await Promise.all([
      this.capabilities?.tools ? this.listTools(timeout, signal) : undefined,
      this.capabilities?.resources ? this.listResources(timeout, signal) : undefined
    ])
  }
  async listTools(
    timeout = this.options.connectTimeoutMs ?? 10_000,
    signal?: AbortSignal
  ): Promise<McpToolDescriptor[]> {
    const rows = await this.pages('tools', timeout, signal)
    this.descriptors = rows
      .filter((row) => typeof row?.name === 'string' && this.displayText(row.name) === row.name)
      .map(({ name, description, inputSchema }) => ({
        name,
        ...(typeof description === 'string' ? { description: this.displayText(description) } : {}),
        inputSchema: this.displayValue(inputSchema)
      }))
    return this.descriptors
  }
  async listResources(
    timeout = this.options.connectTimeoutMs ?? 10_000,
    signal?: AbortSignal
  ): Promise<McpResourceDescriptor[]> {
    const rows = await this.pages('resources', timeout, signal)
    this.catalog = rows
      .filter((row) => typeof row?.uri === 'string' && this.displayText(row.uri) === row.uri && typeof row.name === 'string')
      .map(({ uri, name, description, mimeType }) => ({
        uri,
        name: this.displayText(name),
        ...(typeof description === 'string' ? { description: this.displayText(description) } : {}),
        ...(typeof mimeType === 'string' ? { mimeType: this.displayText(mimeType) } : {})
      }))
    return this.catalog
  }
  async readResource(uri: string, signal?: AbortSignal): Promise<unknown> {
    if (!this.catalog.some((item) => item.uri === uri))
      throw this.failure('BUDINGX_MCP_PROTOCOL', '资源不在当前服务器目录')
    return this.displayValue(await this.request('resources/read', { uri }, this.options.callTimeoutMs ?? 30_000, signal))
  }
  get tools() {
    return this.descriptors
  }
  get resources() {
    return this.catalog
  }
  get isClosed() {
    return this.lifetime.signal.aborted
  }

  async callTool(name: string, args: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.isClosed) throw this.failure('BUDINGX_MCP_SERVER_EXITED', '已关闭')
    if (!this.descriptors.some((tool) => tool.name === name))
      throw this.failure('BUDINGX_MCP_PROTOCOL', '工具不在当前服务器目录')
    const result = await this.request(
      'tools/call',
      { name, arguments: args ?? {} },
      this.options.callTimeoutMs ?? 30_000,
      signal
    )
    if (result?.isError) {
      const detail = this.displayText(extractMcpText(result))
      throw new McpError(
        'BUDINGX_MCP_TOOL_ERROR',
        `MCP ${this.name}/${name} 返回错误：${detail || 'unknown'}`
      )
    }
    return this.displayValue(result)
  }
  async close() {
    this.lifetime.abort()
    this.transport?.close()
    this.transport = undefined
  }
}

export function extractMcpText(result: unknown): string {
  const content = (result as { content?: unknown })?.content
  if (!Array.isArray(content)) return ''
  return content
    .map((item) =>
      (item?.type === 'text' || item?.type === 'resource') && typeof item.text === 'string' ? item.text : ''
    )
    .filter(Boolean)
    .join('\n')
}
