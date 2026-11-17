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
  createProfile,
  maskKey,
  profileHost,
  updateProfile,
  type ResolvedConfig
} from '../storage/profiles.js'
import type { PermissionsStore } from '../storage/permissions.js'
import { probe, type ProbeResult } from '../provider/openai.js'
import type { BudingPermissionPolicy, PermissionRule } from '../workspace/policy.js'
import type { ChangeRecord, UndoOutcome } from '../workspace/checkpoint.js'
import type { Workspace } from '../workspace/paths.js'
import { diffStats, diffText } from './render/diff-view.js'

export type CommandOutcome = {
  handled: boolean
  exit?: boolean
  message?: string
  error?: string
  keyRequest?: { id: string; host: string }
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
  lang?: 'zh' | 'en'
  /** SP003: present once the workspace runtime is wired. */
  permission?: {
    policy: BudingPermissionPolicy
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
  /models               列出已存模型档案
  /model [id]           切换模型（下一回合生效）
  /provider add         添加模型档案
  /provider edit [id]   编辑模型档案
  /provider rm [id]     删除模型档案
  /provider check [id]  验证档案端点
  /provider key [id]    隐藏录入或更新密钥
  /provider default [id] 设置启动默认档案
  /provider tools [id] on|off 设置工具能力
  /provider orphans [clean] 查看数量或显式清理孤儿凭据
  /permission           查看权限模式；/permission read|workspace|full 切换
  /rules                列出权限规则（含遮蔽标注）
  /rules add <allow|deny> <tool|*> [path-glob]  新增规则
  /rules rm <id>        删除规则
  /diff [路径]          查看本会话改动（交互模式打开对话框）
  /undo [路径]          撤销本会话改动（外部改动会阻止自动撤销）
  /denials              查看拒绝历史
  /clear                清空会话
  /exit                 退出 budingx`
    : `Commands:
  /help                 show this help
  /config               show the active endpoint, model and key state
  /models               list stored model profiles
  /model [id]           switch the model (takes effect from the next turn)
  /provider add         add a model profile
  /provider edit [id]   edit a model profile
  /provider rm [id]     remove a model profile
  /provider check [id]  verify a profile against the provider
  /provider key [id]    enter or update the key in a hidden prompt
  /provider default [id] set the startup default profile
  /provider tools [id] on|off set tool capability
  /provider orphans [clean] count or explicitly remove orphan credentials
  /permission           show the permission mode; /permission read|workspace|full to switch
  /rules                list permission rules (with shadow annotations)
  /rules add <allow|deny> <tool|*> [path-glob]  add a rule
  /rules rm <id>        remove a rule
  /diff [path]          show this session's changes (opens a dialog interactively)
  /undo [path]          undo session changes (foreign edits block automatic undo)
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
      const key = context.credentialStore.get(profile.id, profileHost(profile))
      const next: ResolvedConfig = {
        ...context.getConfig(),
        baseUrl: profile.baseUrl,
        model: profile.model,
        apiKey: key ?? '',
        profileId: profile.id,
        source: 'file'
      }
      context.setConfig(next)
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
    case 'provider':
      return providerCommand(argument, context, pick)
    default:
      return {
        handled: true,
        error: pick('未知命令；使用 /help', 'Unknown command; use /help')
      }
  }
}

async function providerCommand(
  argument: string,
  context: CommandContext,
  pick: (zh: string, en: string) => string
): Promise<CommandOutcome> {
  const [action, ...rest] = argument.split(/\s+/)
  const id = rest[0]
  const stored = context.configStore.load()

  if (action === 'orphans') {
    const ids = context.credentialStore.orphanIds(stored.models.map((p) => p.id))
    if (rest.length > 1 || (id && id !== 'clean'))
      return { handled: true, error: 'Usage: /provider orphans [clean]' }
    if (id === 'clean') for (const orphan of ids) context.credentialStore.remove(orphan)
    return {
      handled: true,
      message: pick(
        `孤儿凭据${id === 'clean' ? '已清理' : ''}：${ids.length}`,
        `Orphan credentials${id === 'clean' ? ' removed' : ''}: ${ids.length}`
      )
    }
  }

  if (['key', 'default', 'tools'].includes(action)) {
    const profile = stored.models.find((p) => p.id === id || p.label === id)
    if (!profile)
      return { handled: true, error: pick('未知模型档案', 'Unknown model profile') }
    if (action === 'key') {
      if (rest.length !== 1)
        return {
          handled: true,
          error: pick(
            '用法：/provider key <档案>；密钥请在隐藏输入框录入',
            'Usage: /provider key <profile>; enter the key in the hidden prompt'
          )
        }
      return { handled: true, keyRequest: { id: profile.id, host: profileHost(profile) } }
    }
    if (action === 'default') {
      if (rest.length !== 1)
        return { handled: true, error: 'Usage: /provider default <profile>' }
      stored.defaultModelId = profile.id
    } else {
      if (rest.length !== 2 || !['on', 'off'].includes(rest[1]))
        return { handled: true, error: 'Usage: /provider tools <profile> on|off' }
      Object.assign(profile, updateProfile(profile, { tools: rest[1] === 'on' }))
    }
    context.configStore.save(stored)
    return { handled: true, message: pick('档案已更新', 'Profile updated') }
  }

  if (action === 'add') {
    const parts = rest
    const label = parts[0]
    const baseUrl = parts[1]
    const model = parts[2]
    if (!label || !baseUrl || !model) {
      return {
        handled: true,
        error: pick(
          '用法：/provider add <label> <base-url> <model>',
          'Usage: /provider add <label> <base-url> <model>'
        )
      }
    }
    if (stored.models.some((profile) => profile.label === label)) {
      return {
        handled: true,
        error: pick(`已存在同名档案：${label}`, `A profile named ${label} already exists`)
      }
    }
    const profile = createProfile({ label, baseUrl, model })
    stored.models.push(profile)
    if (!stored.defaultModelId) stored.defaultModelId = profile.id
    context.configStore.save(stored)
    return {
      handled: true,
      message: pick(
        `已添加档案 ${profile.label}（${profile.id}）`,
        `Added profile ${profile.label} (${profile.id})`
      )
    }
  }

  if (action === 'edit') {
    const profile = stored.models.find((entry) => entry.id === id || entry.label === id)
    if (!profile)
      return {
        handled: true,
        error: pick(`未知模型档案：${id}`, `Unknown model profile: ${id}`)
      }
    const parts = rest.slice(1)
    if (parts.length !== 3)
      return {
        handled: true,
        error: 'Usage: /provider edit <profile> <label> <base-url> <model>'
      }
    if (stored.models.some((p) => p.id !== profile.id && p.label === parts[0]))
      return {
        handled: true,
        error: pick('已存在同名档案', 'A profile with that label already exists')
      }
    const updated = updateProfile(profile, {
      label: parts[0] ?? profile.label,
      baseUrl: parts[1] ?? profile.baseUrl,
      model: parts[2] ?? profile.model
    })
    const index = stored.models.findIndex((entry) => entry.id === profile.id)
    stored.models[index] = updated
    context.configStore.save(stored)
    const hostChanged = profileHost(updated) !== profileHost(profile)
    const active = context.getConfig()
    if (active.profileId === profile.id) {
      context.setConfig({
        ...active,
        baseUrl: updated.baseUrl,
        model: updated.model,
        apiKey: hostChanged ? '' : active.apiKey
      })
    }
    return {
      handled: true,
      message: hostChanged
        ? pick(
            `已更新 ${updated.label}。端点主机已变化，旧密钥不再使用；请为新主机重新输入密钥。`,
            `Updated ${updated.label}. The endpoint host changed, so the stored key is no longer used; re-enter the key for the new host.`
          )
        : pick(`已更新 ${updated.label}`, `Updated ${updated.label}`)
    }
  }

  if (action === 'rm') {
    const profile = stored.models.find((entry) => entry.id === id || entry.label === id)
    if (!profile)
      return {
        handled: true,
        error: pick(`未知模型档案：${id}`, `Unknown model profile: ${id}`)
      }
    stored.models = stored.models.filter((entry) => entry.id !== profile.id)
    if (stored.defaultModelId === profile.id) stored.defaultModelId = stored.models[0]?.id
    context.configStore.save(stored)
    context.credentialStore.remove(profile.id)
    if (context.getConfig().profileId === profile.id) {
      context.setConfig({
        ...context.getConfig(),
        profileId: undefined,
        model: '',
        apiKey: ''
      })
    }
    return {
      handled: true,
      message: pick(
        `已删除 ${profile.label} 及其密钥`,
        `Removed ${profile.label} and its key`
      )
    }
  }

  if (action === 'check') {
    const profile = stored.models.find((entry) => entry.id === id || entry.label === id)
    if (!profile)
      return {
        handled: true,
        error: pick(`未知模型档案：${id}`, `Unknown model profile: ${id}`)
      }
    const key = context.credentialStore.get(profile.id, profileHost(profile))
    if (!key) {
      return {
        handled: true,
        error: pick(
          `${profile.label} 未存储密钥；请先输入密钥再验证`,
          `No key stored for ${profile.label}; enter it before checking`
        )
      }
    }
    const checker = context.probe ?? probe
    const result: ProbeResult = await checker(
      { baseUrl: profile.baseUrl, model: profile.model, apiKey: key },
      { tools: profile.capabilities.tools }
    )
    const toolsSuffix =
      result.supportsTools === undefined
        ? ''
        : result.supportsTools
          ? pick('（支持工具调用）', ' (tool calls supported)')
          : pick('（不支持工具调用）', ' (tool calls not supported)')
    return {
      handled: true,
      message: result.ok
        ? pick(
            `档案 ${profile.label} 端点可达`,
            `Provider reachable for ${profile.label}`
          ) + toolsSuffix
        : pick(
            `档案 ${profile.label} 验证失败：${result.message}`,
            `Provider check failed for ${profile.label}: ${result.message}`
          )
    }
  }

  return {
    handled: true,
    error: pick('用法：/provider add|edit|rm|check', 'Usage: /provider add|edit|rm|check')
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
  const next = MODE_ALIASES[argument]
  if (!next) {
    return {
      handled: true,
      error: pick('用法：/permission read|workspace|full', 'Usage: /permission read|workspace|full')
    }
  }
  policy.setMode(next)
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
  const changes = permission.checkpointChanges()
  if (changes.length === 0) {
    return { handled: true, message: pick('本会话尚无工作区改动', 'No workspace changes in this session') }
  }
  if (argument) {
    const record = changes.filter((entry) => entry.path === argument).at(-1)
    if (!record) {
      return { handled: true, error: pick(`没有该路径的会话改动：${argument}`, `No session change for ${argument}`) }
    }
    return {
      handled: true,
      message: [`── ${record.path} (${record.operation}) ──`, ...diffText(record.diff)].join('\n')
    }
  }
  const byPath = new Map<string, ChangeRecord>()
  for (const record of changes) byPath.set(record.path, record)
  const lines = [...byPath.values()].map((record) => {
    const { additions, removals } = diffStats(record.diff)
    return ` ${record.path} (${record.operation === 'create' ? pick('新建', 'new') : pick('修改', 'edit')}) +${additions}/-${removals}`
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
  if (outcome.undone) {
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
