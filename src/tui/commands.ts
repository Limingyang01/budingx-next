// Session commands (SP002 design §3.5/§3.6, AC MM-03).
// Commands are processed at turn boundaries only.
// Wording: lang 'zh' for the modern interactive TUI; default 'en' keeps
// pipe/machine-facing output stable (TC-06). Command syntax, identifiers,
// env names and provider error codes always stay English.
import type { Session } from '../core/session.js'
import type { DenialRecord } from '../core/events.js'
import type { PermissionMode } from '../core/permissions.js'
import type { ReasoningEffort } from '../core/provider.js'
import type { ConfigStore } from '../storage/config-store.js'
import type { CredentialStore } from '../storage/credentials.js'
import {
  maskKey,
  type ResolvedConfig
} from '../storage/profiles.js'
import type { PermissionsStore } from '../storage/permissions.js'
import type { discoverModels, probe } from '../provider/openai.js'
import { selectProfile } from './model-management.js'
import type { BudingPermissionPolicy, PermissionRule } from '../workspace/policy.js'
import { changeDiffs, type ChangeRecord, type UndoOutcome } from '../workspace/checkpoint.js'
import type { Workspace } from '../workspace/paths.js'
import { diffStats, diffText } from './render/diff-view.js'

export type CommandOutcome = {
  handled: boolean
  exit?: boolean
  message?: string
  error?: string
  openModels?: boolean
  openEffort?: boolean
  /** Interactive hosts open the diff dialog on this instead of printing. */
  openDiffDialog?: boolean
}

export type CommandContext = {
  session: Session
  configStore: ConfigStore
  credentialStore: CredentialStore
  getConfig: () => ResolvedConfig
  setConfig: (config: ResolvedConfig) => void
  exit: () => void
  probe?: typeof probe
  discoverModels?: typeof discoverModels
  interactive?: boolean
  lang?: 'zh' | 'en'
  /** SP003: present once the workspace runtime is wired. */
  permission?: {
    policy: BudingPermissionPolicy
    setMode?: (mode: PermissionMode) => boolean
    store: PermissionsStore
    workspace: Workspace
    checkpointChanges: () => ChangeRecord[]
    undo: (path?: string) => UndoOutcome
    denials: () => DenialRecord[]
    modes: { order: PermissionMode[]; zh: Record<string, string>; en: Record<string, string> }
  }
  /** SP005: present once the session persistence runtime is wired. */
  sessions?: {
    /** List known sessions with id, title, updated time and turn count. */
    list: () => { sessionId: string; title: string; updatedAt: string; turns: number }[]
    /** Restore a session by id; unknown ids must fail explicitly. */
    resume: (sessionId: string) => {
      ok: boolean
      message?: string
      messages?: unknown[]
      needsReview?: { name: string; callId: string; detail?: string }[]
      warnings?: string[]
    }
  }
  /**
   * 0.5.2：上下文用量。usedTokens 优先取 provider 真实 usage，
   * 缺失时用本地估算；window 未知时只报已用 token。
   */
  contextUsage?: {
    usage: () => {
      usedTokens: number
      maxTokens?: number
      reservedOutputTokens?: number
      triggerTokens?: number
      percentUsed?: number
      source: 'provider' | 'estimate'
    }
  }
  /** SP005: context budget composition for /context. */
  context?: {
    budget: () => {
      estimatedTokens: number
      maxTokens: number
      reservedOutputTokens: number
      triggerTokens: number
      messages: number
      breakdown: { kind: string; tokens: number }[]
    }
  }
  /**
   * 0.5.2：推理强度（/effort）。参考实现的底部状态栏会常驻显示它。
   */
  effort?: {
    current: () => ReasoningEffort
    set: (next: ReasoningEffort) => void
    choices: readonly ReasoningEffort[]
    /** True when the provider ignores the setting. */
    supported?: boolean
  }
  /** SP005: project and session memory for /memory. */
  memory?: {
    read: (scope: 'project' | 'session') => { entries: { title: string; text: string }[]; message?: string }
    write: (scope: 'project' | 'session', title: string, text: string) => { ok: boolean; message?: string }
  }
}

const MODE_ALIASES: Record<string, PermissionMode> = {
  read: 'read_only',
  read_only: 'read_only',
  edit: 'workspace_edit',
  workspace: 'workspace_edit',
  workspace_edit: 'workspace_edit',
  full: 'full_access',
  full_access: 'full_access'
}

export function interactiveModeLabel(mode: PermissionMode, lang: 'zh' | 'en'): string {
  return (lang === 'zh'
    ? { read_only: '仅可查看', workspace_edit: '允许编辑', full_access: '全自动' }
    : { read_only: 'Read-only', workspace_edit: 'Allow edits', full_access: 'Full auto' }
  )[mode]
}

export function commandHelp(lang: 'zh' | 'en' = 'en', interactive = false): string {
  const modes = interactive ? 'edit|full' : 'read|workspace|full'
  return lang === 'zh'
    ? `命令：
  /help                 显示本帮助
  /config               显示端点、模型与密钥状态
  /models               打开模型管理（管道模式列出档案）
  /model [id]           切换模型（下一回合生效）
  /permission           查看权限模式；/permission ${modes} 切换
  /rules                列出权限规则（含遮蔽标注）
  /rules add <allow|deny> <tool|*> [path-glob]  新增规则
  /rules rm <id>        删除规则
  /diff [路径]          查看本会话改动（交互模式打开对话框）
  /undo [路径]          撤销最近一组改动或指定文件（外部改动会阻止自动撤销）
  /denials              查看拒绝历史
  /sessions             列出已保存的会话
  /resume <会话ID>      恢复指定会话（不重放未确认的工具调用）
  /context              查看上下文预算构成
  /memory               查看项目/会话记忆
  /memory <范围> add <标题>：<正文>  写入记忆
  /effort [low|medium|high]  选择或直接设置思考强度
  /clear                清空会话
  /exit                 退出 budingx`
    : `Commands:
  /help                 show this help
  /config               show the active endpoint, model and key state
  /models               open model management (list profiles in pipes)
  /model [id]           switch the model (takes effect from the next turn)
  /permission           show the permission mode; /permission ${modes} to switch
  /rules                list permission rules (with shadow annotations)
  /rules add <allow|deny> <tool|*> [path-glob]  add a rule
  /rules rm <id>        remove a rule
  /diff [path]          show this session's changes (opens a dialog interactively)
  /undo [path]          undo the latest change group or a file (foreign edits block undo)
  /denials              show the denial history
  /sessions             list saved sessions
  /resume <sessionId>    restore a session (unconfirmed tool calls are not replayed)
  /context              show the context budget composition
  /memory               show project/session memory
  /memory <scope> add <title>: <body>   store a memory entry
  /effort [low|medium|high]  choose or set the reasoning effort
  /clear                clear the conversation
  /exit                 leave budingx`
}

export async function runCommand(
  input: string,
  context: CommandContext
): Promise<CommandOutcome> {
  try {
    return await executeCommand(input, context)
  } catch {
    return {
      handled: true,
      error:
        context.lang === 'zh'
          ? '配置操作失败；请检查参数和文件权限'
          : 'Configuration operation failed; check input and file permissions'
    }
  }
}

async function executeCommand(
  input: string,
  context: CommandContext
): Promise<CommandOutcome> {
  const lang = context.lang ?? 'en'
  const pick = (zh: string, en: string) => (lang === 'zh' ? zh : en)
  const text = input.trim()
  if (!text.startsWith('/')) return { handled: false }
  // The command name ends at the first whitespace; everything after it is the
  // argument, with the original spacing kept so bodies stay readable.
  const body = text.slice(1)
  const separator = body.search(/\s/)
  const command = (separator < 0 ? body : body.slice(0, separator)).toLowerCase()
  const argument = separator < 0 ? '' : body.slice(separator + 1).trim()

  switch (command) {
    case 'help':
      return { handled: true, message: commandHelp(lang, context.interactive) }
    case 'exit':
    case 'quit':
      context.exit()
      return { handled: true, exit: true }
    case 'clear': {
      context.session.clearHistory()
      return { handled: true, message: pick('会话已清空', 'Conversation cleared') }
    }
    case 'config': {
      const config = context.getConfig()
      const key = config.apiKey
      return {
        handled: true,
        message: [
          pick(`端点：${config.baseUrl}`, `Endpoint: ${config.baseUrl}`),
          pick(
            `模型：${config.model || '（未配置）'}`,
            `Model: ${config.model || '(not configured)'}`
          ),
          pick(`密钥：${maskKey(key)}`, `API key: ${maskKey(key)}`),
          pick(`来源：${config.source}`, `Source: ${config.source}`),
          pick(`超时：${config.timeoutMs} ms`, `Timeout: ${config.timeoutMs} ms`)
        ].join('\n')
      }
    }
    case 'models': {
      if (argument) return { handled: true, error: pick('用法：/models', 'Usage: /models') }
      if (context.interactive) return { handled: true, openModels: true }
      const stored = context.configStore.load()
      if (stored.models.length === 0) {
        return {
          handled: true,
          message: pick('尚未存储模型档案', 'No model profiles stored yet')
        }
      }
      const lines = stored.models.map(
        (profile) =>
          `${profile.id === stored.defaultModelId ? '*' : ' '} ${profile.label} — ${profile.model} (${profile.baseUrl})`
      )
      return { handled: true, message: lines.join('\n') }
    }
    case 'model': {
      if (!argument) {
        const config = context.getConfig()
        return {
          handled: true,
          message: pick(
            `模型：${config.model || '（未配置）'}`,
            `Model: ${config.model || '(not configured)'}`
          )
        }
      }
      const stored = context.configStore.load()
      const profile = stored.models.find(
        (entry) => entry.id === argument || entry.label === argument
      )
      if (!profile) {
        return {
          handled: true,
          error: pick(`未知模型档案：${argument}`, `Unknown model profile: ${argument}`)
        }
      }
      selectProfile(context, profile)
      return {
        handled: true,
        message: pick(
          `已切换到 ${profile.label}；会话保留，自下一回合生效`,
          `Model switched to ${profile.label}; the conversation is kept and the switch applies from the next turn`
        )
      }
    }
    case 'permission':
      return permissionCommand(argument, context, pick)
    case 'rules':
      return rulesCommand(argument, context, pick)
    case 'diff':
      return diffCommand(argument, context, pick)
    case 'undo':
      return undoCommand(argument, context, pick)
    case 'denials':
      return denialsCommand(context, pick)
    case 'sessions':
      return sessionsCommand(context, pick)
    case 'resume':
      return resumeCommand(argument, context, pick)
    case 'context':
      return contextCommand(context, pick)
    case 'memory':
      return memoryCommand(argument, context, pick)
    case 'effort':
      return effortCommand(argument, context, pick)
    default:
      return {
        handled: true,
        error: pick('未知命令；使用 /help', 'Unknown command; use /help')
      }
  }
}

const EFFORT_ZH: Record<ReasoningEffort, string> = { low: '低', medium: '中', high: '高' }

export function effortDisplayLabel(effort: ReasoningEffort, zh: boolean): string {
  return zh ? EFFORT_ZH[effort] : effort
}

function effortCommand(
  argument: string,
  context: CommandContext,
  pick: (zh: string, en: string) => string
): CommandOutcome {
  const effort = context.effort
  if (!effort) {
    return {
      handled: true,
      error: pick(
        '推理强度未接入；当前运行时无法修改',
        'Reasoning effort is not wired; it cannot be changed at runtime'
      )
    }
  }
  const requested = argument.trim().toLowerCase()
  if (!requested) {
    if (context.interactive) return { handled: true, openEffort: true }
    return {
      handled: true,
      message: pick(
        `当前思考强度：${effortDisplayLabel(effort.current(), true)}（可选：${effort.choices.join(' / ')}）`,
        `Reasoning effort: ${effort.current()} (choose: ${effort.choices.join(' / ')})`
      )
    }
  }
  const choice = effort.choices.find((value) => value === requested || EFFORT_ZH[value] === requested)
  if (!choice) {
    return {
      handled: true,
      error: pick(
        `无效的推理强度：${requested}；可选：${effort.choices.join(' / ')}`,
        `Invalid reasoning effort: ${requested}; choose: ${effort.choices.join(' / ')}`
      )
    }
  }
  effort.set(choice)
  return {
    handled: true,
    message: pick(
      `思考强度已设为${EFFORT_ZH[choice]}（下一次请求生效）`,
      `Reasoning effort set to ${choice} (applies to the next request)`
    )
  }
}

/** 0.5.2：把 token 数压缩成紧凑文本（1234 → 1.2k，12000 → 12k）。 */
export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0'
  if (count < 1000) return String(Math.round(count))
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`
  if (count < 1000000) return `${Math.round(count / 1000)}k`
  return `${(count / 1000000).toFixed(1)}M`
}

/** SP005: list known sessions on disk. */
function sessionsCommand(
  context: CommandContext,
  pick: (zh: string, en: string) => string
): CommandOutcome {
  const sessions = context.sessions
  if (!sessions) {
    return {
      handled: true,
      error: pick(
        '会话存储尚未接入；请重新以支持持久化的方式启动 budingx',
        'Session storage is not wired; start budingx in a mode that supports persistence'
      )
    }
  }
  const listed = sessions.list()
  if (listed.length === 0) {
    return { handled: true, message: pick('尚无已保存的会话', 'No saved sessions yet') }
  }
  const lines = listed.map(
    (entry) =>
      `${entry.sessionId}  ${entry.title}  ${entry.updatedAt}  ${pick('回合', 'turns')} ${entry.turns}`
  )
  return { handled: true, message: lines.join('\n') }
}

/** SP005: restore a session by id. Unknown ids fail explicitly. */
function resumeCommand(
  argument: string,
  context: CommandContext,
  pick: (zh: string, en: string) => string
): CommandOutcome {
  const sessions = context.sessions
  if (!sessions) {
    return {
      handled: true,
      error: pick(
        '会话存储尚未接入；无法恢复会话',
        'Session storage is not wired; cannot resume a session'
      )
    }
  }
  const sessionId = argument.trim()
  if (!sessionId) {
    return {
      handled: true,
      error: pick('用法：/resume <sessionId>', 'Usage: /resume <sessionId>')
    }
  }
  const restored = sessions.resume(sessionId)
  if (!restored.ok) {
    return {
      handled: true,
      error: pick(
        `无法恢复会话 ${sessionId}：${restored.message ?? '未知错误'}`,
        `Cannot resume session ${sessionId}: ${restored.message ?? 'unknown error'}`
      )
    }
  }
  const warnings = restored.warnings ?? []
  const needsReview = restored.needsReview ?? []
  const lines = [
    pick(
      `已恢复会话 ${sessionId}，历史 ${restored.messages?.length ?? 0} 条消息`,
      `Resumed session ${sessionId} with ${restored.messages?.length ?? 0} messages`
    )
  ]
  if (needsReview.length > 0) {
    lines.push(
      pick(
        `有 ${needsReview.length} 个工具调用的结果未知，恢复时未重放，请先核对：`,
        `${needsReview.length} tool call(s) have an unknown outcome and were not replayed; verify them first:`
      )
    )
    for (const step of needsReview) {
      lines.push(`- ${step.name} (${step.callId})${step.detail ? ` — ${step.detail}` : ''}`)
    }
  }
  for (const warning of warnings) lines.push(pick(`提示：${warning}`, `Warning: ${warning}`))
  return { handled: true, message: lines.join('\n') }
}

/** SP005: context budget composition (the grid view itself belongs to SP006). */
function contextCommand(
  context: CommandContext,
  pick: (zh: string, en: string) => string
): CommandOutcome {
  const budget = context.context?.budget()
  const usage = context.contextUsage?.usage()
  if (!budget) {
    if (usage) {
      // 0.5.2：即使没有配置预算，也要能看到上下文用了多少。
      const used = formatTokens(usage.usedTokens)
      const lines = [
        usage.maxTokens === undefined
          ? pick(`上下文已用：${used} token`, `Context used: ${used} tokens`)
          : pick(
              `上下文已用：${used} / ${formatTokens(usage.maxTokens)} token（${usage.percentUsed ?? 0}%）`,
              `Context used: ${used} / ${formatTokens(usage.maxTokens)} tokens (${usage.percentUsed ?? 0}%)`
            ),
        pick(
          `来源：${usage.source === 'provider' ? '模型汇报的真实用量' : '本地估算'}`,
          `Source: ${usage.source === 'provider' ? 'provider-reported usage' : 'local estimate'}`
        )
      ]
      return { handled: true, message: lines.join('\n') }
    }
    return {
      handled: true,
      error: pick(
        '上下文预算未接入；请设置 contextBudget 后重试',
        'Context budget is not wired; configure contextBudget and retry'
      )
    }
  }
  const lines = [
    pick(
      `估算用量：${budget.estimatedTokens} / ${budget.maxTokens} token（预留输出 ${budget.reservedOutputTokens}，触发阈值 ${budget.triggerTokens}）`,
      `Estimated usage: ${budget.estimatedTokens} / ${budget.maxTokens} tokens (reserved output ${budget.reservedOutputTokens}, trigger ${budget.triggerTokens})`
    ),
    pick(`消息条数：${budget.messages}`, `Messages: ${budget.messages}`)
  ]
  for (const part of budget.breakdown) {
    lines.push(`- ${part.kind}: ${part.tokens}`)
  }
  return { handled: true, message: lines.join('\n') }
}

/** SP005: project and session memory. */
function memoryCommand(
  argument: string,
  context: CommandContext,
  pick: (zh: string, en: string) => string
): CommandOutcome {
  const memory = context.memory
  if (!memory) {
    return {
      handled: true,
      error: pick(
        '项目记忆尚未接入；请重新以支持记忆的方式启动 budingx',
        'Project memory is not wired; start budingx in a mode that supports memory'
      )
    }
  }
  const text = argument.trim()
  if (!text) {
    const lines: string[] = []
    for (const scope of ['project', 'session'] as const) {
      const read = memory.read(scope)
      lines.push(
        pick(
          `【${scope === 'project' ? '项目' : '会话'}记忆】${read.entries.length} 条`,
          `[${scope} memory] ${read.entries.length} entries`
        )
      )
      for (const entry of read.entries) {
        lines.push(`- ${entry.title}`)
      }
      if (read.message) lines.push(pick(`提示：${read.message}`, `Warning: ${read.message}`))
    }
    return { handled: true, message: lines.join('\n') }
  }
  const match = /^(project|session)\s+add\s+(.+)$/i.exec(text)
  if (!match) {
    return {
      handled: true,
      error: pick(
        '用法：/memory 或 /memory <project|session> add <标题>：<正文>',
        'Usage: /memory or /memory <project|session> add <title>: <body>'
      )
    }
  }
  const scope = match[1].toLowerCase() as 'project' | 'session'
  const rest = match[2]
  // Accept the ASCII colon and the full-width colon used by Chinese input.
  // Math.min() of an empty list is Infinity, so a missing colon has to be
  // checked explicitly or the title silently swallows the whole text
  // (SP005 review M7).
  const colonIndexes = [rest.indexOf(':'), rest.indexOf('：')].filter((index) => index >= 0)
  if (colonIndexes.length === 0) {
    return {
      handled: true,
      error: pick(
        '用法：/memory <project|session> add <标题>：<正文>',
        'Usage: /memory <project|session> add <title>: <body>'
      )
    }
  }
  const separator = Math.min(...colonIndexes)
  const title = rest.slice(0, separator).trim()
  const body = rest.slice(separator + 1).trim()
  const written = memory.write(scope, title, body)
  if (!written.ok) {
    return {
      handled: true,
      error: pick(
        `记忆写入失败：${written.message ?? '未知错误'}`,
        `Memory write failed: ${written.message ?? 'unknown error'}`
      )
    }
  }
  return {
    handled: true,
    message: pick(
      `已写入${scope === 'project' ? '项目' : '会话'}记忆：${title}`,
      `Stored in ${scope} memory: ${title}`
    )
  }
}

function nextRuleId(rules: PermissionRule[]): string {
  let max = 0
  for (const rule of rules) {
    const match = /^r-(\d+)$/.exec(rule.id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `r-${max + 1}`
}

function permissionCommand(
  argument: string,
  context: CommandContext,
  pick: (zh: string, en: string) => string
): CommandOutcome {
  const permission = context.permission
  if (!permission) {
    return { handled: true, error: pick('工作区运行时未启用', 'The workspace runtime is not active') }
  }
  const { policy, modes } = permission
  const label = (mode: PermissionMode) =>
    context.interactive ? interactiveModeLabel(mode, context.lang ?? 'en') : pick(modes.zh[mode] ?? mode, modes.en[mode] ?? mode)
  const current = policy.getMode()
  if (!argument) {
    const available = context.interactive ? modes.order.filter((mode) => mode !== 'read_only') : modes.order
    const lines = available.map((mode) => `${mode === current ? '*' : ' '} ${label(mode)}`)
    return {
      handled: true,
      message: pick(
        `当前权限模式：${label(current)}\n` + lines.join('\n'),
        `Permission mode: ${label(current)}\n` + lines.join('\n')
      )
    }
  }
  const next = Object.hasOwn(MODE_ALIASES, argument) ? MODE_ALIASES[argument] : undefined
  if (!next || (context.interactive && next === 'read_only')) {
    const usage = context.interactive ? 'edit|full' : 'read|workspace|full'
    return {
      handled: true,
      error: pick(`用法：/permission ${usage}`, `Usage: /permission ${usage}`)
    }
  }
  if (!changePermissionMode(permission, next)) {
    return {
      handled: true,
      error: pick(
        '此会话已切换权限模式，但无法保存启动模式',
        'Permission mode changed for this session. Could not save the startup mode.'
      )
    }
  }
  const note =
    next === 'full_access'
      ? pick('（不越过 deny 规则与凭据保护）', '(deny rules and credential protection still apply)')
      : next === 'read_only'
        ? pick('（只读；写操作将被拒绝）', '(read-only; writes are refused)')
        : context.interactive
          ? pick('（普通写入直接执行，敏感目标需审批）', '(ordinary writes proceed; sensitive targets require approval)')
          : pick('（写入工作区内文件前逐个确认）', '(asks before writing files inside the workspace)')
  return {
    handled: true,
    message: pick(`已切换到权限模式：${label(next)}${note}`, `Permission mode is now ${label(next)}${note}`)
  }
}

export function changePermissionMode(
  permission: NonNullable<CommandContext['permission']>,
  mode: PermissionMode
): boolean {
  if (permission.setMode) return permission.setMode(mode)
  permission.policy.setMode(mode)
  return true
}

function rulesCommand(
  argument: string,
  context: CommandContext,
  pick: (zh: string, en: string) => string
): CommandOutcome {
  const permission = context.permission
  if (!permission) {
    return { handled: true, error: pick('工作区运行时未启用', 'The workspace runtime is not active') }
  }
  const { policy, store } = permission
  const rules = policy.listRules()
  const [action, ...rest] = argument ? argument.split(/\s+/) : []
  const save = (next: PermissionRule[]): CommandOutcome => {
    try {
      store.save({ schemaVersion: 1, rules: next })
    } catch (error) {
      return {
        handled: true,
        error: error instanceof Error ? error.message : 'rule rejected'
      }
    }
    policy.setRules(next)
    return { handled: true, message: pick('规则已保存并生效', 'Rules saved and active') }
  }
  if (!action || action === 'list') {
    if (rules.length === 0) {
      return {
        handled: true,
        message: pick('暂无权限规则', 'No permission rules yet')
      }
    }
    const shadow = new Map(policy.shadowed().map((entry) => [entry.ruleId, entry.shadowedBy]))
    const lines = rules.map((rule) => {
      const base = `${rule.id} ${rule.action} ${rule.tool}${rule.path ? ' ' + rule.path : ''}${rule.note ? ' — ' + rule.note : ''}`
      const by = shadow.get(rule.id)
      return by
        ? base + pick(`【被 ${by} 遮蔽】`, ` [shadowed by ${by}]`)
        : base
    })
    return { handled: true, message: lines.join('\n') }
  }
  if (action === 'add') {
    const kind = rest[0]
    const tool = rest[1]
    const path = rest[2]
    if ((kind !== 'allow' && kind !== 'deny') || !tool) {
      return {
        handled: true,
        error: pick(
          '用法：/rules add <allow|deny> <tool|*> [路径-glob]',
          'Usage: /rules add <allow|deny> <tool|*> [path-glob]'
        )
      }
    }
    return save([...rules, { id: nextRuleId(rules), action: kind, tool, ...(path ? { path } : {}) }])
  }
  if (action === 'rm') {
    const id = rest[0]
    if (!id) return { handled: true, error: 'Usage: /rules rm <id>' }
    if (!rules.some((rule) => rule.id === id)) {
      return { handled: true, error: pick(`未知规则：${id}`, `Unknown rule: ${id}`) }
    }
    return save(rules.filter((rule) => rule.id !== id))
  }
  return {
    handled: true,
    error: pick('用法：/rules [list|add|rm]', 'Usage: /rules [list|add|rm]')
  }
}

function diffCommand(
  argument: string,
  context: CommandContext,
  pick: (zh: string, en: string) => string
): CommandOutcome {
  const permission = context.permission
  if (!permission) {
    return { handled: true, error: pick('工作区运行时未启用', 'The workspace runtime is not active') }
  }
  const changes = changeDiffs(permission.workspace, permission.checkpointChanges())
  if (argument) {
    const record = changes.find((entry) => entry.path === argument)
    if (!record) {
      return { handled: true, error: pick(`没有该路径的当前改动：${argument}`, `No current change for ${argument}`) }
    }
    return {
      handled: true,
      message: [`── ${record.path} (${record.operation}) ──`, ...diffText(record.hunks)].join('\n')
    }
  }
  if (changes.length === 0) {
    return { handled: true, message: pick('本会话尚无工作区改动', 'No workspace changes in this session') }
  }
  const lines = changes.map((record) => {
    const { additions, removals } = diffStats(record.hunks)
    return ` ${record.path} (${record.operation}) +${additions}/-${removals}`
  })
  return {
    handled: true,
    message:
      pick('本会话改动：', 'Session changes:') +
      '\n' +
      lines.join('\n') +
      pick('\n/diff <路径> 查看详情', '\n/diff <path> for detail')
  }
}

function undoCommand(
  argument: string,
  context: CommandContext,
  pick: (zh: string, en: string) => string
): CommandOutcome {
  const permission = context.permission
  if (!permission) {
    return { handled: true, error: pick('工作区运行时未启用', 'The workspace runtime is not active') }
  }
  const outcome = permission.undo(argument || undefined)
  if (outcome.undone && !outcome.reason) {
    return {
      handled: true,
      message: pick(`已撤销：${outcome.paths.join('、')}`, `Undone: ${outcome.paths.join(', ')}`)
    }
  }
  return {
    handled: true,
    error:
      (outcome.reason ?? pick('没有可撤销的会话改动', 'Nothing to undo')) +
      (outcome.paths.length > 0 ? pick(`；已恢复：${outcome.paths.join('、')}`, `; restored: ${outcome.paths.join(', ')}`) : '')
  }
}

function denialsCommand(
  context: CommandContext,
  pick: (zh: string, en: string) => string
): CommandOutcome {
  const permission = context.permission
  if (!permission) {
    return { handled: true, error: pick('工作区运行时未启用', 'The workspace runtime is not active') }
  }
  const denials = permission.denials()
  if (denials.length === 0) {
    return { handled: true, message: pick('暂无拒绝记录', 'No denials recorded') }
  }
  const lines = denials.map(
    (denial) =>
      `${denial.at.slice(11, 19)} ${denial.tool}${denial.path ? ' ' + denial.path : ''} — ${denial.reason}`
  )
  return { handled: true, message: lines.join('\n') }
}
