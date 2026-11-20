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
import { selectProfile } from './model-management.js'
import type { PermissionsStore } from '../storage/permissions.js'
import type { discoverModels, probe } from '../provider/openai.js'
import type { BudingPermissionPolicy, PermissionRule } from '../workspace/policy.js'
import { changeDiffs, type ChangeRecord, type UndoOutcome } from '../workspace/checkpoint.js'
import type { Workspace } from '../workspace/paths.js'
import { diffStats, diffText } from './render/diff-view.js'
import { homedir } from 'node:os'
import { discoverSkills, findSkill, type SkillEntry } from './skills.js'

import type { CommandContext, CommandOutcome } from './commands/types.js'

export type { CommandContext, CommandOutcome } from './commands/types.js'

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
  /models               打开模型管理（管道模式列出档案）
  /permissions          权限白名单/规则面板（Shift+Tab 切换模式）
  /rules                管理权限规则（交互模式打开面板；管道模式列出）
  /rules add <allow|deny> <tool|*> [path-glob]  新增规则
  /rules rm <id>        删除规则
  /diff [路径]          查看本会话改动（交互模式打开对话框）
  /undo [路径]          撤销最近一组改动或指定文件（外部改动会阻止自动撤销）
  /rewind               回滚对话+文件到检查点（别名 /undo，Esc+Esc）
  /denials              查看拒绝历史
  /sessions             列出已保存的会话
  /resume [会话ID]      恢复会话（交互模式打开选择面板，按当前工作区过滤）
  /continue             恢复当前工作区最近会话
  /context              上下文占用网格（System/Tools/History）
  /compact [指令]       手动压缩历史释放 token
  /cost                 累计 token 与预估费用（别名 /usage）
  /plan                 进入/退出规划模式（只读，审批后执行；Shift+Tab）
  /permissions          权限白名单面板（别名 /allowed-tools）
  /memory               查看项目/会话记忆
  /memory <范围> add <标题>：<正文>  写入记忆
  /effort [low|medium|high]  选择或直接设置思考强度
  /init                 生成项目指令（AGENTS.md）骨架
  /btw <问题>           旁路提问，不进入主会话上下文
  /worktree [list|create <名称>|remove <路径>]  管理隔离工作树
  /tasks                列出后台或未完成任务
  /mcp                  查看 MCP 服务器与工具
  /skills               查看已发现技能
  /export [--format jsonl|text] [--path <路径>]  导出会话
  /clear                清空会话（别名 /new /reset，保留项目规则）
  /exit                 退出 budingx`
    : `Commands:
  /help                 show this help
  /models               open model management (list profiles in pipes)
  /permissions          permission whitelist/rules panel (Shift+Tab cycles mode)
  /rules                manage permission rules (opens a panel interactively; lists in pipes)
  /rules add <allow|deny> <tool|*> [path-glob]  add a rule
  /rules rm <id>        remove a rule
  /diff [path]          show this session's changes (opens a dialog interactively)
  /undo [path]          undo the latest change group or a file (foreign edits block undo)
  /rewind               rewind conversation+files to a checkpoint (alias /undo, Esc+Esc)
  /denials              show the denial history
  /sessions             list saved sessions
  /resume [sessionId]   restore a session (picker interactively, filtered to this workspace)
  /continue             resume the most recent session in this workspace
  /context              context usage grid (System/Tools/History)
  /compact [instruction]  manually compact history to free tokens
  /cost                 cumulative tokens and estimated cost (alias /usage)
  /plan                 enter/exit plan mode (read-only until approved; Shift+Tab)
  /permissions          permission whitelist panel (alias /allowed-tools)
  /memory               show project/session memory
  /memory <scope> add <title>: <body>   store a memory entry
  /effort [low|medium|high]  choose or set the reasoning effort
  /init                 generate project instructions (AGENTS.md) skeleton
  /btw <question>       side question without polluting the main context
  /worktree [list|create <name>|remove <path>]  manage isolated worktrees
  /tasks                list background or unfinished tasks
  /mcp                  show MCP servers and tools
  /skills               show discovered skills
  /export [--format jsonl|text] [--path <path>]  export the session
  /clear                clear the conversation (aliases /new /reset, keeps project rules)
  /exit                 leave budingx`
}

let registryPromise:
  | Promise<import('./commands/registry.js').CommandRegistry>
  | undefined

function defaultRegistry(): Promise<import('./commands/registry.js').CommandRegistry> {
  // 懒加载注册表：内置命令模块反向引用本文件的既有实现，动态导入避免初始化环。
  registryPromise ??= import('./commands/index.js').then((module) => module.getDefaultRegistry())
  return registryPromise
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
  const text = input.trim()
  if (!text.startsWith('/')) return { handled: false }
  const registry = await defaultRegistry()
  const resolved = registry.resolve(text)
  if (resolved) {
    const result = await resolved.definition.run(resolved.args, context)
    if (result.outcome) {
      const outcome = result.outcome
      const hasMessage = outcome.message !== undefined || outcome.error !== undefined
      const hasEffect =
        outcome.prompt !== undefined ||
        outcome.sideQuestion !== undefined ||
        outcome.openList !== undefined ||
        outcome.openModels !== undefined ||
        outcome.openEffort !== undefined ||
        outcome.openRules !== undefined ||
        outcome.openResume !== undefined ||
        outcome.openRewind !== undefined ||
        outcome.openContext !== undefined ||
        outcome.openDiffDialog !== undefined ||
        outcome.exit === true
      // 只带 handled 的结果把文本交给宿主展示（local-jsx 的非交互降级）。
      if (hasMessage || hasEffect || !result.value) return outcome
      return { ...outcome, message: result.value }
    }
    if (!result.value) return { handled: true }
    // SP006 CMD-04：prompt 型命令把文本交给宿主作为下一轮输入，并附带进度提示。
    if (resolved.definition.kind === 'prompt') {
      return {
        handled: true,
        prompt: {
          text: result.value,
          ...(resolved.definition.progressMessage
            ? { progress: resolved.definition.progressMessage }
            : {})
        }
      }
    }
    return { handled: true, message: result.value }
  }
  const lang = context.lang ?? 'en'
  const pick = (zh: string, en: string) => (lang === 'zh' ? zh : en)
  // 0.5.4：已加载技能可作为 /<skill> 命令展开为提示（prompt 型，对齐参考）。
  const body = text.slice(1)
  const separator = body.search(/\s/)
  const name = (separator < 0 ? body : body.slice(0, separator)).toLowerCase()
  const skillBody = loadSkillBody(name)
  if (skillBody !== undefined) return { handled: true, skillPrompt: { name, body: skillBody } }
  return {
    handled: true,
    error: pick('未知命令；使用 /help', 'Unknown command; use /help')
  }
}

const EFFORT_ZH: Record<ReasoningEffort, string> = { low: '低', medium: '中', high: '高' }

export function effortDisplayLabel(effort: ReasoningEffort, zh: boolean): string {
  return zh ? EFFORT_ZH[effort] : effort
}

export function effortCommand(
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
export function sessionsCommand(
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
export function resumeCommand(
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
export function contextCommand(
  context: CommandContext,
  pick: (zh: string, en: string) => string
): CommandOutcome {
  const budget = context.context?.budget()
  const usage = context.contextUsage?.usage()
  if (!budget) {
    if (usage) {
      // 0.5.4：只展示模型真实上报的用量；未拿到时不显示、不估算。
      if (usage.usedTokens === undefined) {
        return {
          handled: true,
          message: pick(
            '上下文用量：尚未收到模型上报的用量（完成一次回合后显示）',
            'Context usage: no provider-reported usage yet (shown after a turn completes)'
          )
        }
      }
      const used = formatTokens(usage.usedTokens)
      const lines = [
        usage.maxTokens === undefined
          ? pick(`上下文已用：${used} token`, `Context used: ${used} tokens`)
          : pick(
              `上下文已用：${used} / ${formatTokens(usage.maxTokens)} token（${usage.percentUsed ?? 0}%）`,
              `Context used: ${used} / ${formatTokens(usage.maxTokens)} tokens (${usage.percentUsed ?? 0}%)`
            ),
        pick(
          '来源：模型汇报的真实用量',
          'Source: provider-reported usage'
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
export function memoryCommand(
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

export function permissionCommand(
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

export function rulesCommand(
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

export function diffCommand(
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

/**
 * 工作区检查点只返回语言无关的错误原因（见 src/workspace/checkpoint.ts）；TUI 层
 * 负责把已知原因转成当前界面语言，未知原因原样透出，避免吞掉真实错误细节。
 */
function localizeUndoReason(
  reason: string,
  pick: (zh: string, en: string) => string
): string {
  if (reason === 'no session changes to undo') {
    return pick('没有可撤销的会话改动', 'Nothing to undo')
  }
  const single = /^no session change to undo for (.+)$/.exec(reason)
  if (single) {
    return pick(`该文件本会话没有可撤销的改动：${single[1]}`, `No session change to undo for ${single[1]}`)
  }
  return reason
}

export function undoCommand(
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
      (outcome.reason
        ? localizeUndoReason(outcome.reason, pick)
        : pick('没有可撤销的会话改动', 'Nothing to undo')) +
      (outcome.paths.length > 0 ? pick(`；已恢复：${outcome.paths.join('、')}`, `; restored: ${outcome.paths.join(', ')}`) : '')
  }
}

export function denialsCommand(
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

/** 0.5.4 /cost：累计 token 与预估费用（价格可配置，未配置只报 token/时长）。 */
export function costCommand(context: CommandContext, pick: (zh: string, en: string) => string): CommandOutcome {
  const totals = context.session.usageTotals
  const minutes = Math.floor(totals.elapsedMs / 60000)
  const seconds = Math.floor((totals.elapsedMs % 60000) / 1000)
  const lines = [
    pick(`累计输入：${formatTokens(totals.inputTokens)} token · 输出：${formatTokens(totals.outputTokens)} token · 请求 ${totals.requests} 次`,
      `Input: ${formatTokens(totals.inputTokens)} tokens · Output: ${formatTokens(totals.outputTokens)} tokens · ${totals.requests} requests`),
    pick(`会话时长：${minutes} 分 ${seconds} 秒`, `Duration: ${minutes}m ${seconds}s`)
  ]
  const priceIn = Number(process.env.BUDINGX_PRICE_INPUT_PER_MTOK ?? '')
  const priceOut = Number(process.env.BUDINGX_PRICE_OUTPUT_PER_MTOK ?? '')
  if (Number.isFinite(priceIn) && Number.isFinite(priceOut) && (priceIn > 0 || priceOut > 0)) {
    const cost = (totals.inputTokens / 1e6) * priceIn + (totals.outputTokens / 1e6) * priceOut
    lines.push(pick(`预估费用：$${cost.toFixed(4)}（按环境变量单价）`, `Estimated cost: $${cost.toFixed(4)} (env pricing)`))
  } else {
    lines.push(pick('预估费用：未配置单价（BUDINGX_PRICE_*_PER_MTOK）', 'Estimated cost: no pricing configured (BUDINGX_PRICE_*_PER_MTOK)'))
  }
  return { handled: true, message: lines.join('\n') }
}

/** 0.5.4 /plan：进入/退出规划模式（只读，审批后才执行）。 */
export function planCommand(argument: string, context: CommandContext, pick: (zh: string, en: string) => string): CommandOutcome {
  const session = context.session
  if (argument === 'open') {
    return { handled: true, message: session.planMode.active ? pick('当前处于规划模式', 'Plan mode active') : pick('当前不在规划模式', 'Not in plan mode') }
  }
  if (!session.planMode.active) {
    const result = session.enterPlanMode()
    if (!result.ok) return { handled: true, error: result.reason ?? 'cannot enter plan mode' }
    return { handled: true, message: pick('已进入规划模式：只读分析，计划获批后才执行修改', 'Plan mode: read-only research; changes run only after approval') }
  }
  // 已提交计划走审批退出；仅调研期直接离开并恢复原档位，避免卡住。
  if (session.planMode.phase === 'pending') {
    void session.exitPlanMode({}).catch(() => {})
    return { handled: true, message: pick('已请求退出规划模式（需审批）', 'Exiting plan mode (approval required)') }
  }
  session.leavePlanMode()
  return { handled: true, message: pick('已退出规划模式，恢复原权限档位', 'Left plan mode, restored permission mode') }
}

/** 0.5.4 /help：附加已加载的自定义技能命令（.budingx/skills）。 */
export function skillHelpSection(context: CommandContext, pick: (zh: string, en: string) => string): string {
  const skills = discoverSkillCommands()
  if (skills.length === 0) return ''
  const lines = skills.map((skill) => `  /${skill.name}  ${skill.description}`)
  return '\n' + pick('自定义技能命令：', 'Custom skill commands:') + '\n' + lines.join('\n')
}

/** SM-03：只暴露有效技能；无效条目留在 /skills 面板解释原因。 */
export function discoverSkillCommands(): { name: string; description: string }[] {
  return listSkills()
    .filter((skill) => skill.valid)
    .map((skill) => ({ name: skill.name, description: skill.description }))
}

export function listSkills(): SkillEntry[] {
  return discoverSkills({ homeDir: homedir(), workspaceDir: process.cwd() })
}

export function loadSkillBody(name: string): string | undefined {
  const skill = findSkill(listSkills(), name)
  if (!skill || !skill.valid) return undefined
  return skill.body
}
