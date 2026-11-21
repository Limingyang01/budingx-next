import { readFileSync } from 'node:fs'
import type { ToolContext, ToolHandler } from '../../core/tools.js'
import { mcpPath } from '../../storage/paths.js'
import { extractMcpText, McpClient, mcpToolName } from './client.js'
import {
  McpError,
  type McpClientOptions,
  type McpServerConfig,
  type McpServerStatus,
  type McpToolDescriptor
} from './types.js'

export * from './types.js'
export { McpClient, extractMcpText, mcpToolName, resolveMcpEnv, MCP_PROTOCOL_VERSION } from './client.js'

export interface LoadedMcpConfig {
  servers: McpServerConfig[]
  warnings: string[]
  /** 配置文件存在但整体不可解析时为 true，宿主据此提示 /mcp。 */
  corrupt?: boolean
}

const ENV_REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/

function validateServer(name: string, raw: any, warnings: string[]): McpServerConfig | undefined {
  if (!raw || typeof raw !== 'object') {
    warnings.push(`MCP 配置无效，已忽略：${name}`)
    return undefined
  }
  if (typeof raw.command !== 'string' || raw.command.trim() === '') {
    warnings.push(`MCP 服务器缺少 command，已忽略：${name}`)
    return undefined
  }
  const args = Array.isArray(raw.args)
    ? raw.args.filter((item: unknown): item is string => typeof item === 'string')
    : undefined
  const env: Record<string, string> = {}
  if (raw.env && typeof raw.env === 'object') {
    for (const [key, value] of Object.entries(raw.env)) {
      if (typeof value !== 'string') continue
      if (!ENV_REF.test(value.trim())) {
        // SM-09：不打印、不保留明文密钥，只报告键名。
        warnings.push(`MCP 服务器 ${name} 的环境变量 ${key} 必须是 \${ENV_NAME} 引用，已忽略`)
        continue
      }
      env[key] = value.trim()
    }
  }
  return {
    name,
    command: raw.command,
    ...(args && args.length > 0 ? { args } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
    enabled: raw.enabled !== false
  }
}

/** §8.2：读取 `~/.budingx/mcp.json`；损坏时返回空清单与告警，不崩溃。 */
export function loadMcpConfig(homeDir?: string): LoadedMcpConfig {
  let text: string
  try {
    text = readFileSync(mcpPath(homeDir), 'utf8')
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { servers: [], warnings: [] }
    return { servers: [], warnings: [`MCP 配置读取失败：${mcpPath(homeDir)}`], corrupt: true }
  }
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    return { servers: [], warnings: [`MCP 配置不是有效 JSON：${mcpPath(homeDir)}`], corrupt: true }
  }
  const rawServers = parsed?.mcpServers
  if (!rawServers || typeof rawServers !== 'object') {
    return { servers: [], warnings: [`MCP 配置缺少 mcpServers 对象：${mcpPath(homeDir)}`], corrupt: true }
  }
  const warnings: string[] = []
  const servers: McpServerConfig[] = []
  for (const [name, raw] of Object.entries(rawServers)) {
    const server = validateServer(name, raw, warnings)
    if (server) servers.push(server)
  }
  servers.sort((a, b) => a.name.localeCompare(b.name))
  return { servers, warnings }
}

/** SM-05：把 MCP 工具注册进 Agent 工具表（名字与 schema 均可用）。 */
export function toAgentTools(client: McpClient): ToolHandler[] {
  return client.tools.map((descriptor) => {
    const handler: ToolHandler = {
      name: mcpToolName(client.name, descriptor.name),
      summary: descriptor.description ?? `MCP ${client.name}:${descriptor.name}`,
      parameters: normalizeSchema(descriptor.inputSchema),
      describe: () => `MCP ${client.name} · ${descriptor.name}`,
      // 外部动作按写能力处理：只读档位拒绝，其余档位走审批通道（SM-07）。
      capability: () => 'write',
      requiresApproval: () => true,
      target: () => ({ kind: 'none' }),
      execute: async (input: unknown, _context: ToolContext) => {
        const result = await client.callTool(descriptor.name, input ?? {})
        const text = extractMcpText(result)
        if (text) return text
        return JSON.stringify(result ?? null)
      }
    }
    return handler
  })
}

function normalizeSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === 'object' && (schema as any).type === 'object') {
    return schema as Record<string, unknown>
  }
  return { type: 'object', properties: {} }
}

export interface ConnectedMcp {
  clients: McpClient[]
  tools: ToolHandler[]
  statuses: McpServerStatus[]
  warnings: string[]
  close(): Promise<void>
}

/** 连接全部启用的服务器；单个失败只降级该服务器（SM-08），并发以免串行叠加超时。 */
export async function connectMcpServers(
  configs: McpServerConfig[],
  options: McpClientOptions = {}
): Promise<ConnectedMcp> {
  const outcomes = await Promise.all(
    configs.map(async (config) => {
      if (config.enabled === false) {
        return {
          status: {
            name: config.name,
            command: config.command,
            connected: false,
            tools: 0,
            error: 'disabled'
          } satisfies McpServerStatus,
          warnings: [] as string[]
        }
      }
      try {
        const client = await McpClient.connect(config, options)
        return {
          client,
          tools: toAgentTools(client),
          status: {
            name: config.name,
            command: config.command,
            connected: true,
            tools: client.tools.length,
            ...(client.protocolVersion ? { protocolVersion: client.protocolVersion } : {}),
            ...(client.serverInfo?.name ? { serverName: client.serverInfo.name } : {}),
            ...(client.serverInfo?.version ? { serverVersion: client.serverInfo.version } : {})
          } satisfies McpServerStatus,
          warnings: [] as string[]
        }
      } catch (error) {
        const message = error instanceof McpError ? error.message : String(error)
        return {
          status: {
            name: config.name,
            command: config.command,
            connected: false,
            tools: 0,
            error: message
          } satisfies McpServerStatus,
          warnings: [message]
        }
      }
    })
  )
  const clients: McpClient[] = []
  const tools: ToolHandler[] = []
  const statuses: McpServerStatus[] = []
  const warnings: string[] = []
  for (const outcome of outcomes) {
    if (outcome.client) clients.push(outcome.client)
    if (outcome.tools) tools.push(...outcome.tools)
    statuses.push(outcome.status)
    warnings.push(...outcome.warnings)
  }
  return {
    clients,
    tools,
    statuses,
    warnings,
    close: async () => {
      await Promise.all(clients.map((client) => client.close()))
    }
  }
}

/**
 * 启动装配：读配置 → 连接 → 合并配置告警。
 * 宿主在创建 AgentRuntime 之前调用，并把 tools/statuses 传入。
 */
export async function startMcp(options: {
  homeDir?: string
  clientOptions?: McpClientOptions
} = {}): Promise<ConnectedMcp> {
  const loaded = loadMcpConfig(options.homeDir)
  const connected = await connectMcpServers(loaded.servers, options.clientOptions)
  connected.warnings.unshift(...loaded.warnings)
  return connected
}
