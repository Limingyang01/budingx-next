import { readFileSync } from 'node:fs'
import type { ToolHandler } from '../../core/tools.js'
import { mcpPath } from '../../storage/paths.js'
import { extractMcpText, McpClient, mcpToolName } from './client.js'
import { remoteUrl } from './transport.js'
import { McpError, type McpClientOptions, type McpServerConfig, type McpServerStatus } from './types.js'
export * from './types.js'
export { McpClient, extractMcpText, mcpToolName, resolveMcpEnv, MCP_PROTOCOL_VERSION } from './client.js'

export interface LoadedMcpConfig {
  servers: McpServerConfig[]
  warnings: string[]
  corrupt?: boolean
}
const ENV_REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/
function validateServer(name: string, raw: any, warnings: string[]): McpServerConfig | undefined {
  const invalid = () => {
    warnings.push(`MCP 配置无效，已忽略：${name}`)
    return undefined
  }
  if (!raw || typeof raw !== 'object') return invalid()
  const base = { name, enabled: raw.enabled !== false }
  if (raw.type !== undefined && raw.type !== 'stdio') {
    if (!['http', 'sse', 'ws'].includes(raw.type) || typeof raw.url !== 'string') return invalid()
    try {
      remoteUrl(raw.url, raw.type === 'ws')
    } catch {
      return invalid()
    }
    if (
      raw.headers !== undefined &&
      (!raw.headers || typeof raw.headers !== 'object' || Array.isArray(raw.headers))
    )
      return invalid()
    for (const [key, value] of Object.entries(raw.headers ?? {})) {
      if (
        typeof value !== 'string' ||
        !ENV_REF.test(value) ||
        !/^[A-Za-z0-9-]+$/.test(key) ||
        /^(?:host|connection|content-length|content-type|accept|transfer-encoding|upgrade|sec-websocket-.*|mcp-.*)$/i.test(
          key
        )
      )
        return invalid()
    }
    return { ...base, type: raw.type, url: raw.url, ...(raw.headers ? { headers: raw.headers } : {}) }
  }
  if (typeof raw.command !== 'string' || !raw.command.trim()) return invalid()
  const env: Record<string, string> = Object.create(null)
  for (const [key, value] of Object.entries(raw.env ?? {})) {
    if (typeof value === 'string' && ENV_REF.test(value.trim())) env[key] = value.trim()
    else warnings.push(`MCP 服务器 ${name} 的环境变量 ${key} 必须是 \${ENV_NAME} 引用，已忽略`)
  }
  return {
    ...base,
    command: raw.command,
    ...(Array.isArray(raw.args) ? { args: raw.args.filter((arg: unknown) => typeof arg === 'string') } : {}),
    ...(Object.keys(env).length ? { env: { ...env } } : {})
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

export function toAgentTools(client: McpClient): ToolHandler[] {
  function handler(
    name: string,
    summary: string,
    parameters: unknown,
    execute: ToolHandler['execute']
  ): ToolHandler {
    return {
      name: mcpToolName(client.name, name),
      summary,
      parameters:
        parameters && typeof parameters === 'object' && 'type' in parameters && parameters.type === 'object'
          ? (parameters as Record<string, unknown>)
          : { type: 'object', properties: {} },
      describe: () => `MCP ${client.name} · ${name}`,
      capability: () => 'write',
      requiresApproval: () => true,
      target: () => ({ kind: 'none' }),
      execute
    }
  }
  const tools = client.tools.map((tool) =>
    handler(
      tool.name,
      tool.description ?? `MCP ${client.name}:${tool.name}`,
      tool.inputSchema,
      async (input, context) => {
        const result = await client.callTool(tool.name, input ?? {}, context.signal)
        return extractMcpText(result) || JSON.stringify(result ?? null)
      }
    )
  )
  if (client.capabilities?.resources) {
    tools.push(
      handler('list_resources', 'List resources on ' + client.name, undefined, async (_input, context) =>
        JSON.stringify(await client.listResources(undefined, context.signal))
      )
    )
    tools.push(
      handler(
        'read_resource',
        'Read a listed resource on ' + client.name,
        { type: 'object', properties: { uri: { type: 'string' } }, required: ['uri'] },
        async (input, context) =>
          JSON.stringify(await client.readResource((input as { uri: string })?.uri, context.signal))
      )
    )
  }
  return tools
}

export interface ConnectedMcp {
  clients: McpClient[]
  tools: ToolHandler[]
  statuses: McpServerStatus[]
  warnings: string[]
  subscribe(listener: () => void): () => void
  start(name: string): Promise<void>
  stop(name: string): Promise<void>
  reconnect(name: string): Promise<void>
  close(): Promise<void>
}

type Slot = {
  config: McpServerConfig
  status: McpServerStatus
  revision: number
  attempts: number
  timer?: NodeJS.Timeout
  connecting?: Promise<void>
  attempt?: AbortController
  client?: McpClient
}
export async function connectMcpServers(
  configs: McpServerConfig[],
  options: McpClientOptions = {}
): Promise<ConnectedMcp> {
  const clients: McpClient[] = [],
    tools: ToolHandler[] = [],
    warnings: string[] = []
  const listeners = new Set<() => void>()
  const slots: Slot[] = configs.map((config) => {
    let address: string | undefined
    if ('url' in config) {
      try {
        address = remoteUrl(config.url, config.type === 'ws').origin
      } catch {
        /* startup reports invalid endpoints */
      }
    }
    const status: McpServerStatus = {
      name: config.name,
      command: 'command' in config ? config.command : (address ?? ''),
      transport: config.type ?? 'stdio',
      ...(address ? { address } : {}),
      tools: 0,
      resources: 0,
      connected: false,
      state: config.enabled === false ? 'disabled' : 'disconnected',
      ...(config.enabled === false ? { error: 'disabled' } : {})
    }
    return { config, status, attempts: 0, revision: 0 }
  })
  const namespaces = configs.map((config) => mcpToolName(config.name, ''))
  let closed = false
  const publish = () => {
    clients.splice(
      0,
      clients.length,
      ...slots.flatMap((s) => (s.client && !s.client.isClosed ? [s.client] : []))
    )
    const all = clients.flatMap(toAgentTools)
    const seen = new Set<string>(),
      collisions = new Set<string>()
    for (const item of all) {
      if (seen.has(item.name)) collisions.add(item.name)
      seen.add(item.name)
    }
    // Include disabled/disconnected origins when checking ownership. A saved tool
    // name must never become an alias for a different server after a disconnect.
    const unambiguous = all.filter(
      (item) =>
        !collisions.has(item.name) && namespaces.filter((prefix) => item.name.startsWith(prefix)).length === 1
    )
    tools.splice(0, tools.length, ...unambiguous)
    for (const fn of listeners) fn()
  }
  const clearCatalog = (slot: Slot) => {
    slot.client = undefined
    Object.assign(slot.status, { connected: false, tools: 0, resources: 0 })
    delete slot.status.protocolVersion
    delete slot.status.serverName
    delete slot.status.serverVersion
  }
  const updateCatalog = (slot: Slot, client: McpClient) => {
    Object.assign(slot.status, { tools: client.tools.length, resources: client.resources.length })
    publish()
  }
  function retry(slot: Slot) {
    if (
      closed ||
      slot.status.state === 'disabled' ||
      !slot.config.type ||
      slot.config.type === 'stdio' ||
      slot.attempts >= 5
    )
      return
    slot.status.state = 'reconnecting'
    const delay = (options.reconnectDelayMs ?? 500) * 2 ** slot.attempts++
    slot.timer = setTimeout(() => {
      slot.timer = undefined
      void connect(slot)
    }, delay)
    slot.timer.unref()
  }
  function connect(slot: Slot): Promise<void> {
    if (closed) return Promise.reject(new Error('MCP manager closed'))
    if (slot.connecting) return slot.connecting
    if (slot.client) return Promise.resolve()
    clearTimeout(slot.timer)
    const attempt = new AbortController()
    slot.attempt = attempt
    slot.status.state = 'connecting'
    delete slot.status.error
    publish()
    const run = async () => {
      try {
        const client = await McpClient.connect(slot.config, {
          ...options,
          signal: options.signal ? AbortSignal.any([options.signal, attempt.signal]) : attempt.signal,
          onClose: (error) => {
            if (slot.attempt !== attempt || !slot.client) return
            clearCatalog(slot)
            slot.status.state = 'disconnected'
            slot.status.error = error.message
            retry(slot)
            publish()
            options.onClose?.(error)
          },
          onToolsChanged: () => {
            if (slot.attempt === attempt && slot.client) {
              updateCatalog(slot, slot.client)
              options.onToolsChanged?.()
            }
          }
        })
        if (slot.attempt !== attempt || closed) {
          await client.close()
          return
        }
        if (client.isClosed) throw new Error('Connection ended')
        slot.client = client
        slot.attempts = 0
        Object.assign(slot.status, {
          connected: true,
          state: 'connected',
          protocolVersion: client.protocolVersion
        })
        if (!slot.config.type || slot.config.type === 'stdio') {
          slot.status.serverName = client.serverInfo?.name
          slot.status.serverVersion = client.serverInfo?.version
        }
        updateCatalog(slot, client)
      } catch (error) {
        if (slot.attempt !== attempt || closed) return
        clearCatalog(slot)
        slot.status.error = error instanceof McpError ? error.message : `MCP ${slot.config.name} 连接失败`
        slot.status.state = 'disconnected'
        retry(slot)
        publish()
      } finally {
        if (slot.attempt === attempt) slot.connecting = undefined
      }
    }
    slot.connecting = run()
    return slot.connecting
  }
  async function stop(slot: Slot) {
    slot.revision++
    clearTimeout(slot.timer)
    const client = slot.client,
      pending = slot.connecting,
      attempt = slot.attempt
    slot.connecting = undefined
    slot.attempt = undefined
    slot.attempts = 0
    attempt?.abort()
    clearCatalog(slot)
    slot.status.state = 'disabled'
    slot.status.error = 'disabled'
    publish()
    await Promise.all([client?.close(), pending])
  }
  function lookup(name: string): Slot {
    const slot = slots.find((s) => s.config.name === name)
    if (!slot) throw new Error('未知 MCP 服务器')
    return slot
  }
  await Promise.all(slots.filter((s) => s.config.enabled !== false).map(connect))
  warnings.push(
    ...slots.flatMap((s) => (s.status.error && s.status.state !== 'disabled' ? [s.status.error] : []))
  )
  return {
    clients,
    tools,
    statuses: slots.map((s) => s.status),
    warnings,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    start: async (name) => {
      const slot = lookup(name)
      slot.revision++
      slot.attempts = 0
      await connect(slot)
    },
    stop: async (name) => stop(lookup(name)),
    reconnect: async (name) => {
      const slot = lookup(name)
      const stopped = stop(slot)
      const revision = slot.revision
      await stopped
      if (!closed && slot.revision === revision) await connect(slot)
    },
    close: async () => {
      closed = true
      listeners.clear()
      await Promise.all(slots.map(stop))
    }
  }
}

export async function startMcp(
  options: { homeDir?: string; clientOptions?: McpClientOptions } = {}
): Promise<ConnectedMcp> {
  const loaded = loadMcpConfig(options.homeDir)
  const manager = await connectMcpServers(loaded.servers, options.clientOptions)
  manager.warnings.unshift(...loaded.warnings)
  return manager
}
