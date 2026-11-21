// SP007 T10 — 诊断端口组装（design §4.2）。把宿主事实（runtime/config/mcp/agents/
// keybindings/instructions）适配为 /status /stats /doctor 的纯函数输入；面板只渲染。
// 凭据只显来源不显值（RD-15）；零网络（rg 探测为本地子进程）。
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import type { CommandContext } from '../commands/types.js'
import type { AgentRuntime } from '../runtime.js'
import type { ConfigStore } from '../../storage/config-store.js'
import type { ResolvedConfig } from '../../storage/profiles.js'
import type { ToolHandler } from '../../core/tools.js'
import type { McpServerStatus } from '../mcp/types.js'
import { dataRoot } from '../../storage/paths.js'
import { loadAgentDefinitions } from '../agents.js'
import { loadKeybindings } from '../keybindings/index.js'
import { loadProjectInstructionsSync } from '../project-instructions.js'
import { contextWarnings } from './doctor-warnings.js'
import type { StatusReportInput } from './status-report.js'
import type { DoctorInput } from './doctor.js'

export type DiagnosticsPortOptions = {
  runtime: AgentRuntime
  configStore: ConfigStore
  getConfig: () => ResolvedConfig
  mcpStatuses?: McpServerStatus[]
  mcpTools?: ToolHandler[]
  version: string
  cwd: string
  home: string
}

export type DiagnosticsPort = NonNullable<CommandContext['diagnostics']>

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

function mcpCounts(statuses: McpServerStatus[]): { connected: number; failed: number; pending: number } {
  let connected = 0
  let failed = 0
  let pending = 0
  for (const status of statuses) {
    if (status.error) failed++
    else if (status.connected) connected++
    else pending++
  }
  return { connected, failed, pending }
}

function searchAvailable(): boolean {
  try {
    const result = spawnSync('rg', ['--version'], { stdio: 'ignore' })
    return result.status === 0
  } catch {
    return false
  }
}

function runtimeKind(entryPath: string): string {
  if (entryPath.includes('node_modules')) return 'npm-global'
  if (entryPath.includes('dist')) return 'npm-local'
  return 'development'
}

/** 复制文本到系统剪贴板（RD-08 Ctrl+S）：Windows Set-Clipboard，其他尽力而为。 */
export function copyToClipboard(text: string): boolean {
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Set-Clipboard'], { input: text })
      return result.status === 0
    }
    if (process.platform === 'darwin') {
      return spawnSync('pbcopy', [], { input: text }).status === 0
    }
    for (const attempt of [{ command: 'wl-copy', args: [] as string[] }, { command: 'xclip', args: ['-selection', 'clipboard'] }]) {
      if (spawnSync(attempt.command, attempt.args, { input: text }).status === 0) return true
    }
    return false
  } catch {
    return false
  }
}

export function buildDiagnosticsPort(options: DiagnosticsPortOptions): DiagnosticsPort {
  const { runtime, configStore, getConfig, version, cwd, home } = options
  const session = runtime.session
  const sessionsDir = join(dataRoot(home), 'sessions')
  const cachePath = join(dataRoot(home), 'stats-cache.json')

  const statusInput = (): StatusReportInput => {
    const current = getConfig()
    const profile = configStore.load().models.find((model) => model.id === current.profileId)
    const statuses = options.mcpStatuses ?? []
    const performance = session.performance
    return {
      version,
      sessionId: session.id,
      cwd,
      model: current.model,
      ...(profile?.label ? { profileLabel: profile.label } : {}),
      baseUrlHost: hostOf(current.baseUrl),
      credentialSource: current.source,
      mcp: mcpCounts(statuses),
      settingSources: current.source !== 'default' ? [current.source] : [],
      warnings: [...runtime.warnings],
      config: {
        source: current.source,
        ...(current.protocol ? { protocol: current.protocol } : {}),
        model: current.model,
        tools: profile?.capabilities.tools ?? false,
        ...(profile?.capabilities.vision !== undefined ? { vision: profile.capabilities.vision } : {})
      },
      usage: session.usageTotals,
      performance: {
        requestMs: performance.requestMs,
        ...(performance.firstTokenMs ? { firstTokenMs: performance.firstTokenMs } : {}),
        memoryRssBytes: performance.memoryRssBytes
      }
    }
  }

  const doctorInput = (): DoctorInput => {
    const statuses = options.mcpStatuses ?? []
    const agentLoad = loadAgentDefinitions({ cwd, home })
    const instructions = loadProjectInstructionsSync({ workspaceDir: cwd, homeDir: home })
    const entryPath = process.argv[1] ?? ''
    const envIssues: { name: string; issue: string }[] = []
    const window = process.env.BUDINGX_CONTEXT_WINDOW
    if (window !== undefined && (!/^\d+$/.test(window) || Number(window) <= 0)) {
      envIssues.push({ name: 'BUDINGX_CONTEXT_WINDOW', issue: '不是正整数：' + window })
    }
    return {
      runtime: {
        kind: runtimeKind(entryPath),
        version,
        nodeVersion: process.version,
        entryPath,
        searchAvailable: searchAvailable()
      },
      installations: [],
      configCorrupt: runtime.warnings.some((warning) => /corrupt|损坏/i.test(warning)),
      mcpFailed: statuses.filter((status) => status.error).map((status) => ({ name: status.name, ...(status.error ? { error: status.error } : {}) })),
      keybindingWarnings: loadKeybindings(home).warnings.map((warning) => warning.message),
      envIssues,
      agentParseErrors: agentLoad.warnings,
      contextWarnings: contextWarnings({
        instructionChars: instructions.content.length,
        agents: agentLoad.agents.map((agent) => ({ name: agent.name, description: agent.description })),
        mcpServers: (options.mcpTools ?? []).map((tool) => ({ name: tool.name, schema: JSON.stringify(tool.parameters ?? {}) })),
        unreachableRules: []
      })
    }
  }

  return {
    statusInput,
    sessionsDir,
    cachePath,
    today: new Date().toISOString().slice(0, 10),
    doctorInput,
    copyToClipboard
  }
}
