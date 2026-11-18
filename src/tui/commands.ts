// Session commands (SP002 design §3.5/§3.6, AC MM-03).
// Commands are processed at turn boundaries only.
// Wording: lang 'zh' for the modern interactive TUI; default 'en' keeps
// pipe/machine-facing output stable (TC-06). Command syntax, identifiers,
// env names and provider error codes always stay English.
import type { Session } from '../core/session.js'
import type { DenialRecord } from '../core/events.js'
import type { PermissionMode } from '../core/permissions.js'
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
}

const MODE_ALIASES: Record<string, PermissionMode> = {
  read: 'read_only',
  read_only: 'read_only',
  workspace: 'workspace_edit',
  workspace_edit: 'workspace_edit',
  full: 'full_access',
  full_access: 'full_access'
}

export function commandHelp(lang: 'zh' | 'en' = 'en'): string {
  return lang === 'zh'
    ? `命令：
  /help                 显示本帮助
  /config               显示端点、模型与密钥状态
  /models               打开模型管理（管道模式列出档案）
  /model [id]           切换模型（下一回合生效）
  /permission           查看权限模式；/permission read|workspace|full 切换
  /rules                列出权限规则（含遮蔽标注）
  /rules add <allow|deny> <tool|*> [path-glob]  新增规则
  /rules rm <id>        删除规则
  /diff [路径]          查看本会话改动（交互模式打开对话框）
  /undo [路径]          撤销最近一组改动或指定文件（外部改动会阻止自动撤销）
  /denials              查看拒绝历史
  /clear                清空会话
  /exit                 退出 budingx`
    : `Commands:
  /help                 show this help
  /config               show the active endpoint, model and key state
  /models               open model management (list profiles in pipes)
  /model [id]           switch the model (takes effect from the next turn)
  /permission           show the permission mode; /permission read|workspace|full to switch
  /rules                list permission rules (with shadow annotations)
  /rules add <allow|deny> <tool|*> [path-glob]  add a rule
  /rules rm <id>        remove a rule
  /diff [path]          show this session's changes (opens a dialog interactively)
  /undo [path]          undo the latest change group or a file (foreign edits block undo)
  /denials              show the denial history
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
  const [command, ...rest] = text.slice(1).split(/\s+/)
  const argument = rest.join(' ')

  switch (command) {
    case 'help':
      return { handled: true, message: commandHelp(lang) }
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
    default:
      return {
        handled: true,
        error: pick('未知命令；使用 /help', 'Unknown command; use /help')
      }
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
    pick(modes.zh[mode] ?? mode, modes.en[mode] ?? mode)
  const current = policy.getMode()
  if (!argument) {
    const lines = modes.order.map((mode) => `${mode === current ? '*' : ' '} ${label(mode)}`)
    return {
      handled: true,
      message: pick(
        `当前权限模式：${label(current)}\n` + lines.join('\n'),
        `Permission mode: ${label(current)}\n` + lines.join('\n')
      )
    }
  }
  const next = Object.hasOwn(MODE_ALIASES, argument) ? MODE_ALIASES[argument] : undefined
  if (!next) {
    return {
      handled: true,
      error: pick('用法：/permission read|workspace|full', 'Usage: /permission read|workspace|full')
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
