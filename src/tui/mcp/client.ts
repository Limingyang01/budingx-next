import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  McpError,
  type McpClientOptions,
  type McpServerConfig,
  type McpToolDescriptor
} from './types.js'

export const MCP_PROTOCOL_VERSION = '2024-11-05'

type Pending = {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/** 只接受 `${ENV_NAME}` 形式的引用，避免密钥落盘后被原样传给子进程。 */
export function resolveMcpEnv(
  env: Record<string, string> | undefined,
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env ?? {})) {
    const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value.trim())
    if (!match) continue
    const resolved = source[match[1]!]
    if (resolved !== undefined) out[key] = resolved
  }
  return out
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_')
}

/** §8.2 规则 3：工具注册名 `mcp__<server>__<tool>`。 */
export function mcpToolName(server: string, tool: string): string {
  return `mcp__${sanitizeSegment(server)}__${sanitizeSegment(tool)}`
}

export class McpClient {
  readonly config: McpServerConfig
  readonly name: string
  private readonly child: ChildProcessWithoutNullStreams
  private readonly options: McpClientOptions
  private readonly pending = new Map<number, Pending>()
  private buffer = ''
  private nextId = 1
  private closed = false
  private descriptors: McpToolDescriptor[] = []
  protocolVersion?: string
  serverInfo?: { name?: string; version?: string }
  capabilities?: Record<string, unknown>

  private constructor(
    config: McpServerConfig,
    child: ChildProcessWithoutNullStreams,
    options: McpClientOptions
  ) {
    this.config = config
    this.name = config.name
    this.child = child
    this.options = options
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onData(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', () => {
      /* stderr 仅用于诊断；不写日志、不打印，避免密钥泄漏。 */
    })
    child.on('error', (error) => {
      this.failAll(new McpError('BUDINGX_MCP_CONNECT_FAILED', `MCP ${config.name} 启动失败：${error.message}`))
    })
    child.on('exit', (code) => {
      if (this.closed) return
      this.closed = true
      const error = new McpError(
        'BUDINGX_MCP_SERVER_EXITED',
        `MCP ${config.name} 已退出（退出码 ${code ?? 'unknown'}）`
      )
      this.failAll(error)
      this.options.onClose?.(error)
    })
  }

  static async connect(
    config: McpServerConfig,
    options: McpClientOptions = {}
  ): Promise<McpClient> {
    const env = {
      ...(options.env ?? process.env),
      ...resolveMcpEnv(config.env, options.env ?? process.env)
    }
    const child = spawn(config.command, config.args ?? [], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    const client = new McpClient(config, child, options)
    const connectTimeout = options.connectTimeoutMs ?? 10_000
    try {
      const initialized = await client.request(
        'initialize',
        {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'budingx', version: 'sp006' }
        },
        connectTimeout
      )
      client.protocolVersion =
        typeof initialized?.protocolVersion === 'string'
          ? initialized.protocolVersion
          : MCP_PROTOCOL_VERSION
      client.capabilities =
        initialized?.capabilities && typeof initialized.capabilities === 'object'
          ? (initialized.capabilities as Record<string, unknown>)
          : {}
      client.serverInfo =
        initialized?.serverInfo && typeof initialized.serverInfo === 'object'
          ? (initialized.serverInfo as { name?: string; version?: string })
          : {}
      client.notify('notifications/initialized', {})
      client.descriptors = await client.listTools(connectTimeout)
      return client
    } catch (error) {
      await client.close()
      if (error instanceof McpError) throw error
      throw new McpError(
        'BUDINGX_MCP_CONNECT_FAILED',
        `MCP ${config.name} 连接失败：${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    for (;;) {
      const index = this.buffer.indexOf('\n')
      if (index === -1) break
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (!line) continue
      let message: any
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (message && typeof message.id === 'number' && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id)!
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.error) {
          pending.reject(
            new McpError(
              'BUDINGX_MCP_PROTOCOL',
              `MCP ${this.config.name} 返回错误：${message.error.message ?? 'unknown'}`
            )
          )
        } else {
          pending.resolve(message.result)
        }
      } else if (message?.method === 'notifications/tools/list_changed') {
        this.options.onToolsChanged?.()
      }
    }
  }

  private failAll(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private send(payload: unknown): void {
    if (this.closed) {
      throw new McpError('BUDINGX_MCP_SERVER_EXITED', `MCP ${this.config.name} 已关闭`)
    }
    this.child.stdin.write(JSON.stringify(payload) + '\n')
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new McpError('BUDINGX_MCP_TIMEOUT', `MCP ${this.config.name} 超时：${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.send({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(error as Error)
      }
    })
  }

  async listTools(timeoutMs = this.options.connectTimeoutMs ?? 10_000): Promise<McpToolDescriptor[]> {
    const result = await this.request('tools/list', {}, timeoutMs)
    const tools = Array.isArray(result?.tools) ? result.tools : []
    this.descriptors = tools
      .filter((tool: any) => tool && typeof tool.name === 'string')
      .map((tool: any) => ({
        name: tool.name,
        ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
        ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {})
      }))
    return this.descriptors
  }

  get tools(): McpToolDescriptor[] {
    return this.descriptors
  }

  get isClosed(): boolean {
    return this.closed
  }

  /** 返回 MCP 原始工具结果；isError 结果转成 McpError 交给标准工具错误通道。 */
  async callTool(name: string, args: unknown): Promise<unknown> {
    if (this.closed) {
      throw new McpError('BUDINGX_MCP_SERVER_EXITED', `MCP ${this.config.name} 已关闭`)
    }
    const result = await this.request(
      'tools/call',
      { name, arguments: args ?? {} },
      this.options.callTimeoutMs ?? 30_000
    )
    if (result?.isError) {
      throw new McpError(
        'BUDINGX_MCP_TOOL_ERROR',
        `MCP ${this.config.name}/${name} 返回错误：${extractMcpText(result) || 'unknown'}`
      )
    }
    return result
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.failAll(new McpError('BUDINGX_MCP_SERVER_EXITED', `MCP ${this.config.name} 已关闭`))
    try {
      this.child.stdin.end()
    } catch {
      /* already closed */
    }
    try {
      this.child.kill()
    } catch {
      /* already exited */
    }
  }
}

/** 把 tools/call 结果压成标准工具文本。 */
export function extractMcpText(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content
    .map((item: any) => {
      if (item && item.type === 'text' && typeof item.text === 'string') return item.text
      if (item && item.type === 'resource' && typeof item.text === 'string') return item.text
      return ''
    })
    .filter(Boolean)
    .join('\n')
}
