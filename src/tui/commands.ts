// Session commands (SP002 design §3.5/§3.6, AC MM-03).
// Commands are processed at turn boundaries only.
// Wording: lang 'zh' for the modern interactive TUI; default 'en' keeps
// pipe/machine-facing output stable (TC-06). Command syntax, identifiers,
// env names and provider error codes always stay English.
import type { Session } from '../core/session.js'
import type { ConfigStore } from '../storage/config-store.js'
import type { CredentialStore } from '../storage/credentials.js'
import {
  createProfile,
  maskKey,
  profileHost,
  updateProfile,
  type ResolvedConfig
} from '../storage/profiles.js'
import { probe, type ProbeResult } from '../provider/openai.js'

export type CommandOutcome = {
  handled: boolean
  exit?: boolean
  message?: string
  error?: string
  keyRequest?: { id: string; host: string }
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
