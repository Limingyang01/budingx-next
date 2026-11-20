/** SP006 §8.2：MCP 配置与工具描述契约（stdio 子集，D-06）。 */

export interface McpServerConfig {
  name: string
  command: string
  args?: string[]
  /** 只允许 `${ENV_NAME}` 形式；明文密钥在加载时丢弃并告警。 */
  env?: Record<string, string>
  enabled?: boolean
}

export interface McpToolDescriptor {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface McpServerStatus {
  name: string
  command: string
  connected: boolean
  tools: number
  protocolVersion?: string
  serverName?: string
  serverVersion?: string
  error?: string
}

export type McpErrorCode =
  | 'BUDINGX_MCP_CONNECT_FAILED'
  | 'BUDINGX_MCP_TIMEOUT'
  | 'BUDINGX_MCP_PROTOCOL'
  | 'BUDINGX_MCP_SERVER_EXITED'
  | 'BUDINGX_MCP_TOOL_ERROR'
  | 'BUDINGX_MCP_DISABLED'

export class McpError extends Error {
  readonly code: McpErrorCode
  constructor(code: McpErrorCode, message: string) {
    super(message)
    this.name = 'McpError'
    this.code = code
  }
}

export interface McpClientOptions {
  /** 连接（initialize + tools/list）超时，默认 10s。 */
  connectTimeoutMs?: number
  /** 单次调用超时，默认 30s。 */
  callTimeoutMs?: number
  /** 环境变量来源，默认 process.env；测试可注入。 */
  env?: NodeJS.ProcessEnv
  /** 服务器退出时回调（宿主要移除其工具并 notice）。 */
  onClose?: (error: McpError) => void
  /** tools/list_changed 通知回调。 */
  onToolsChanged?: () => void
}
