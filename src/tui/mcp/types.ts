export type McpTransportType = 'stdio' | 'http' | 'sse' | 'ws'

export type McpServerConfig = { name: string; enabled?: boolean } & (
  | { type?: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'http' | 'sse' | 'ws'; url: string; headers?: Record<string, string> }
)

export interface McpToolDescriptor {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface McpResourceDescriptor {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface McpServerStatus {
  name: string
  command: string
  connected: boolean
  tools: number
  resources?: number
  transport?: McpTransportType
  address?: string
  state?: 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
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
  constructor(
    readonly code: McpErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'McpError'
  }
}

export type McpElicitationRequest = { server: string; message: string; signal: AbortSignal }
export type McpElicitationAction = 'accept' | 'decline' | 'cancel'

export interface McpClientOptions {
  connectTimeoutMs?: number
  callTimeoutMs?: number
  elicitationTimeoutMs?: number
  reconnectDelayMs?: number
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  onClose?: (error: McpError) => void
  onToolsChanged?: () => void
  onElicitation?: (request: McpElicitationRequest) => Promise<McpElicitationAction>
}
