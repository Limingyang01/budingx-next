// Agent definitions (SP007 design §4.1, AC SA-01/02).
// Pure parsing/validation/serialization only: core is IO-free
// (scripts/checks/module-boundaries.mjs). Directory discovery, caching and
// file writes live in the host layer src/tui/agents.ts (skills.ts precedent).
// Frontmatter is a flat key:value format parsed by hand (D13): the yaml
// package is not in the published runtime dependency whitelist.
import type { PermissionMode } from './permissions.js'
import type { ReasoningEffort } from './provider.js'

export const AGENT_COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'] as const
export type AgentColor = (typeof AGENT_COLORS)[number]
export type AgentSource = 'built-in' | 'user' | 'project'

export interface AgentDefinition {
  /** Unique agent type name; also the file stem <name>.md. */
  name: string
  /** When-to-use description shown to the model and in /agents. */
  description: string
  source: AgentSource
  /** Allow-list; undefined means all parent tools. */
  tools?: string[]
  disallowedTools?: string[]
  /** 'inherit' (default) keeps the parent session model. */
  model?: string
  effort?: ReasoningEffort
  permissionMode?: PermissionMode
  color?: AgentColor
  maxTurns?: number
  initialPrompt?: string
  /** Only true is meaningful; background agents auto-deny approvals. */
  background?: boolean
  filePath?: string
  /** Markdown body = the agent system prompt. */
  body: string
}

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const EFFORTS: readonly string[] = ['low', 'medium', 'high']
const MODES: readonly string[] = ['read_only', 'workspace_edit', 'full_access']
const UNSUPPORTED_KEYS = ['isolation', 'memory', 'mcpServers', 'hooks', 'skills']
const FRONTMATTER_LINE = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/

const READ_ONLY_DENY = ['Write', 'Edit', 'Bash', 'PowerShell', 'Agent', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode']

/** Built-in agents (reference behaviour, independently worded prompts). */
export const BUILT_IN_AGENTS: AgentDefinition[] = [
  {
    name: 'general-purpose',
    description: 'General-purpose agent for researching questions, searching code, and executing multi-step tasks. Use when a task needs several tool steps and the main conversation should stay focused.',
    source: 'built-in',
    model: 'inherit',
    body: 'You are a general-purpose subagent. Complete the delegated task fully using the available tools, then reply with a concise final answer that the parent agent can relay to the user. Do not ask the user questions; work with what you were given.'
  },
  {
    name: 'Explore',
    description: 'Read-only exploration agent for fast codebase research: locating files, tracing call chains, and answering questions about how code works. Never modifies files or runs commands.',
    source: 'built-in',
    model: 'inherit',
    disallowedTools: [...READ_ONLY_DENY],
    body: 'You are a read-only exploration subagent. Search and read files to answer the delegated question. Never modify files or execute commands. Report findings with exact file paths and line numbers, and state clearly when something could not be found.'
  },
  {
    name: 'Plan',
    description: 'Read-only planning agent that researches the codebase and produces an implementation plan with concrete steps and file targets. Never modifies files or runs commands.',
    source: 'built-in',
    model: 'inherit',
    disallowedTools: [...READ_ONLY_DENY],
    body: 'You are a planning subagent. Research the codebase read-only, then produce an implementation plan: ordered steps, exact file paths, and verification for each step. Never modify files or execute commands. End your reply with a "Critical Files" section listing 3-5 files most important to the plan.'
  }
]

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    const inner = trimmed.slice(1, -1)
    if (trimmed.startsWith('"')) {
      try {
        return JSON.parse(trimmed)
      } catch {
        return inner.replace(/\\(["\\])/g, '$1')
      }
    }
    return inner
  }
  return trimmed
}

function parseList(value: string): string[] | undefined {
  const trimmed = value.trim()
  let items: string[]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    items = trimmed.slice(1, -1).split(',')
  } else {
    items = trimmed.split(',')
  }
  const names = items.map((item) => unquote(item)).filter((item) => item.length > 0)
  if (names.length === 0 || names.includes('*')) return undefined
  return names
}

export interface ParseAgentOptions {
  source: AgentSource
  filePath?: string
}

export interface ParseAgentResult {
  definition?: AgentDefinition
  warnings: string[]
}

/** Parse one <name>.md agent file. Invalid files are skipped with warnings. */
export function parseAgentFile(text: string, options: ParseAgentOptions): ParseAgentResult {
  const warnings: string[] = []
  const where = options.filePath ?? '<memory>'
  const warn = (message: string) => warnings.push(`${where}: ${message}`)
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.trim() !== '---') {
    warn('缺少 frontmatter（需要 --- 围栏）')
    return { warnings }
  }
  let end = -1
  for (let index = 1; index < lines.length; index++) {
    if (lines[index]?.trim() === '---') {
      end = index
      break
    }
  }
  if (end === -1) {
    warn('frontmatter 未闭合')
    return { warnings }
  }
  const data: Record<string, string> = {}
  for (const line of lines.slice(1, end)) {
    const match = FRONTMATTER_LINE.exec(line)
    if (match) data[match[1]!] = unquote(match[2] ?? '')
  }
  const body = lines.slice(end + 1).join('\n').trim()

  const name = (data.name ?? '').trim()
  const description = (data.description ?? '').trim()
  if (!NAME_PATTERN.test(name)) {
    warn('name 缺失或非法（字母开头，仅字母/数字/_/-，≤64 字符）')
    return { warnings }
  }
  if (!description) {
    warn('description 缺失')
    return { warnings }
  }
  if (!body) {
    warn('正文为空（正文即系统提示词）')
    return { warnings }
  }
  for (const key of UNSUPPORTED_KEYS) {
    if (data[key] !== undefined) warn(`字段 ${key} 本轮不支持，已忽略`)
  }

  const definition: AgentDefinition = { name, description, source: options.source, body, model: 'inherit' }
  if (options.filePath) definition.filePath = options.filePath
  const tools = data.tools !== undefined ? parseList(data.tools) : undefined
  if (tools) definition.tools = tools
  const disallowed = data.disallowedTools !== undefined ? parseList(data.disallowedTools) : undefined
  if (disallowed) definition.disallowedTools = disallowed
  if (data.model !== undefined && data.model.trim()) definition.model = data.model.trim()
  if (data.effort !== undefined) {
    if (EFFORTS.includes(data.effort)) definition.effort = data.effort as ReasoningEffort
    else warn(`effort 非法：${data.effort}`)
  }
  if (data.permissionMode !== undefined) {
    if (MODES.includes(data.permissionMode)) definition.permissionMode = data.permissionMode as PermissionMode
    else warn(`permissionMode 非法：${data.permissionMode}`)
  }
  if (data.color !== undefined) {
    if ((AGENT_COLORS as readonly string[]).includes(data.color)) definition.color = data.color as AgentColor
    else warn(`color 非法：${data.color}`)
  }
  if (data.maxTurns !== undefined) {
    const turns = Number(data.maxTurns)
    if (Number.isInteger(turns) && turns > 0 && turns <= 1000) definition.maxTurns = turns
    else warn(`maxTurns 非法：${data.maxTurns}`)
  }
  if (data.initialPrompt !== undefined && data.initialPrompt.trim()) definition.initialPrompt = data.initialPrompt
  if (data.background === 'true') definition.background = true
  return { definition, warnings }
}

/** Serialize to <name>.md content; description is YAML double-quoted (D13). */
export function serializeAgentFile(definition: AgentDefinition): string {
  const lines: string[] = ['---']
  lines.push(`name: ${definition.name}`)
  lines.push(`description: ${JSON.stringify(definition.description)}`)
  if (definition.tools && definition.tools.length > 0) lines.push(`tools: ${definition.tools.join(', ')}`)
  if (definition.disallowedTools && definition.disallowedTools.length > 0) {
    lines.push(`disallowedTools: ${definition.disallowedTools.join(', ')}`)
  }
  lines.push(`model: ${definition.model ?? 'inherit'}`)
  if (definition.effort) lines.push(`effort: ${definition.effort}`)
  if (definition.permissionMode) lines.push(`permissionMode: ${definition.permissionMode}`)
  if (definition.color) lines.push(`color: ${definition.color}`)
  if (definition.maxTurns !== undefined) lines.push(`maxTurns: ${definition.maxTurns}`)
  if (definition.initialPrompt) lines.push(`initialPrompt: ${JSON.stringify(definition.initialPrompt)}`)
  if (definition.background) lines.push('background: true')
  lines.push('---', '', definition.body.trim(), '')
  return lines.join('\n')
}
