import { randomUUID } from 'node:crypto'
import { discoverModelMetadata, discoverModels, probe } from '../provider/openai.js'
import {
  createProfile, normalizeBaseUrl, profileCredentialBinding, profileCredentialRef,
  startupProfile, updateProfile
} from '../storage/profiles.js'
import type { CredentialsFile } from '../storage/credentials.js'
import type { ConfigFile, ModelProfile } from '../storage/config-store.js'
import type { CommandContext } from './commands.js'

type Stores = Pick<CommandContext, 'configStore' | 'credentialStore' | 'getConfig' | 'setConfig'>

const QWEN_PAY_AS_YOU_GO = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const QWEN_TOKEN_PLAN = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'

export const providerTemplates: { name: string; baseUrl: string; suggested?: string[] }[] = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { name: 'Qwen / 百炼按量付费', baseUrl: QWEN_PAY_AS_YOU_GO, suggested: ['qwen-plus', 'qwen-flash'] },
  { name: 'Qwen / 百炼 Token Plan', baseUrl: QWEN_TOKEN_PLAN, suggested: ['auto'] },
  { name: 'Kimi / 月之暗面', baseUrl: 'https://api.moonshot.cn/v1' },
  { name: 'GLM / 智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', suggested: ['glm-5.3'] },
  { name: '火山方舟 / 豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { name: '硅基流动 / SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1' },
  { name: 'MiniMax（中国站）', baseUrl: 'https://api.minimax.cn/v1', suggested: ['MiniMax-M3.1-Flash', 'MiniMax-M3'] },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { name: 'Custom', baseUrl: '' }
]

export type ModelDraft = {
  id?: string
  attachTo?: string
  modelIds?: string[]
  updatedAt?: string
  label: string
  baseUrl: string
  model: string
  apiKey: string
  tools: boolean
  startupDefault: boolean
  /**
   * SP009 0.9.1 LC-02：用户填写的自定义上下文窗口（token）。
   * 空字符串＝自动解析（环境变量 → 档案 → 服务端元数据 → 默认）。
   */
  contextWindow?: string
  /**
   * SP009 0.9.1 LC-01：拉取模型列表时服务端报告的上下文窗口，按模型 id 索引。
   */
  discoveredContextWindows?: Record<string, number>
}

export function selectProfile(stores: Stores, profile: ModelProfile) {
  const apiKey = stores.credentialStore.get(profileCredentialRef(profile), profileCredentialBinding(profile)) ?? ''
  stores.setConfig({
    ...stores.getConfig(),
    baseUrl: profile.baseUrl,
    model: profile.model,
    apiKey,
    profileId: profile.id,
    source: 'file'
  })
}

function checkedKey(key: string): string {
  const trimmed = key.trim()
  if (/[\x00-\x20\x7f]/.test(trimmed) || trimmed.length > 4096) {
    throw new Error('Invalid API key')
  }
  return trimmed
}

/**
 * SP009 0.9.1 LC-02：解析用户填写的上下文窗口。
 * undefined＝未触碰（沿用档案/自动）；空串＝清除（恢复自动）；否则必须为正整数。
 */
function parseContextWindowInput(value: string | undefined): number | null | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 10_000_000) {
    throw new Error('Context window must be a positive integer (tokens)')
  }
  return parsed
}

export function draftConnection(stores: Stores, draft: ModelDraft) {
  const baseUrl = normalizeBaseUrl(draft.baseUrl.trim())
  const refId = draft.id ?? draft.attachTo
  const profile = refId ? stores.configStore.load().models.find((item) => item.id === refId) : undefined
  if (draft.attachTo && profile?.baseUrl !== baseUrl) throw new Error('Use the saved provider endpoint')
  const model = draft.model.trim()
  const apiKey = checkedKey(draft.apiKey)
    || (profile ? stores.credentialStore.get(profileCredentialRef(profile), profileCredentialBinding(profile, baseUrl)) : undefined)
    || ''
  return { baseUrl, model, apiKey }
}

export async function loadModelIds(ctx: CommandContext, draft: ModelDraft, signal: AbortSignal) {
  const { baseUrl, apiKey } = draftConnection(ctx, draft)
  const host = new URL(baseUrl).hostname
  const isQwenCompatible = baseUrl.endsWith('/compatible-mode/v1') &&
    (host.endsWith('.maas.aliyuncs.com') || /^(?:cn-hongkong\.)?dashscope(?:-[a-z]+)?\.aliyuncs\.com$/.test(host))
  const isTokenPlan = host === new URL(QWEN_TOKEN_PLAN).hostname
  const nativeQwenList = isQwenCompatible && !isTokenPlan &&
    (host.endsWith('.maas.aliyuncs.com') || host === 'dashscope-us.aliyuncs.com')
  const url = new URL(nativeQwenList
    ? baseUrl.replace(/\/compatible-mode\/v1$/, '/api/v1') + '/models?capabilities=TG&page_size=100'
    : baseUrl + '/models')
  if (host === 'api.siliconflow.cn') url.searchParams.set('sub_type', 'chat')
  const request = ctx.discoverModels ?? discoverModels
  try {
    const models = await request(url.toString(), apiKey, { signal })
    // SP009 0.9.1 LC-01：同时拉取服务端报告的上下文窗口（大窗口模型据此调高预算）。
    const contextWindows = await discoverContextWindows(ctx, url.toString(), apiKey, signal)
    return {
      models,
      suggested: false,
      ...(Object.keys(contextWindows).length > 0 ? { contextWindows } : {})
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (signal.aborted || !/^HTTP (404|405|501)$/.test(message)) throw error
    const suggestions = providerTemplates.find((template) => template.baseUrl ===
      (isQwenCompatible && !isTokenPlan ? QWEN_PAY_AS_YOU_GO : baseUrl)
    )?.suggested
    if (!suggestions) throw error
    return { models: suggestions, suggested: true }
  }
}

/**
 * 读取服务端报告的上下文窗口。失败不影响模型列表本身（窗口只是增强信息）。
 */
async function discoverContextWindows(
  ctx: CommandContext,
  url: string,
  apiKey: string,
  signal: AbortSignal
): Promise<Record<string, number>> {
  const request = ctx.discoverModelMetadata ?? discoverModelMetadata
  try {
    const metadata = await request(url, apiKey, { signal })
    const result: Record<string, number> = {}
    for (const item of metadata) {
      if (item.contextWindow !== undefined) result[item.id] = item.contextWindow
    }
    return result
  } catch {
    return {}
  }
}

export async function testProfile(ctx: CommandContext, draft: ModelDraft, signal: AbortSignal) {
  const connection = draftConnection(ctx, draft)
  if (!connection.model || connection.model.length > 256 || /[\x00-\x1f\x7f]/.test(connection.model)) {
    throw new Error('Enter a valid model ID first')
  }
  return (ctx.probe ?? probe)(connection, { signal, tools: draft.tools })
}

function nextLabel(model: string, names: Set<string>): string {
  const label = model.slice(0, 64)
  if (!names.has(label)) return label
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`
    const candidate = label.slice(0, 64 - suffix.length) + suffix
    if (!names.has(candidate)) return candidate
  }
}

function persistProfiles(
  stores: Stores,
  file: ConfigFile,
  changeCredentials?: (credentials: CredentialsFile) => void
) {
  const previous = changeCredentials ? stores.credentialStore.load() : undefined
  if (previous && changeCredentials) {
    const next = structuredClone(previous)
    changeCredentials(next)
    stores.credentialStore.save(next)
  }
  try {
    stores.configStore.save(file)
  } catch (error) {
    if (previous) stores.credentialStore.save(previous)
    throw error
  }
}

export function saveModel(stores: Stores, draft: ModelDraft, use: boolean): ModelProfile {
  const file = stores.configStore.load()
  const priorDefault = startupProfile(file)?.id
  const targetId = draft.id ?? draft.attachTo
  const anchor = targetId ? file.models.find((model) => model.id === targetId) : undefined
  if (targetId && !anchor) throw new Error('Model profile no longer exists')
  if (anchor && draft.updatedAt && anchor.updatedAt !== draft.updatedAt) throw new Error('Profile changed; reopen it before saving')
  const old = draft.id ? anchor : undefined
  const baseUrl = normalizeBaseUrl(draft.baseUrl.trim())
  if (draft.attachTo && baseUrl !== anchor?.baseUrl) {
    throw new Error('Adding to a provider configuration requires its saved endpoint')
  }

  const oldRef = anchor ? profileCredentialRef(anchor) : undefined
  const grouped = anchor && oldRef !== anchor.id
  const members = anchor ? file.models.filter((item) => profileCredentialRef(item) === oldRef) : []
  if (grouped && members.some((member) => member.baseUrl !== anchor.baseUrl)) {
    throw new Error('Shared provider configuration has inconsistent endpoints')
  }
  const sameModel = new Map(members.map((item) => [item.model, item]))
  const models = new Set([draft.model.trim(), ...(draft.modelIds ?? []).map((item) => item.trim())])
  const primaryModel = draft.model.trim()
  if (!primaryModel) throw new Error('Model name is required')

  const names = new Set(file.models.filter((item) => item.id !== old?.id).map((item) => item.label))
  const label = draft.label.trim() || nextLabel(primaryModel, names)
  const alreadyExists = sameModel.get(primaryModel)
  if (old && alreadyExists && alreadyExists.id !== old.id) throw new Error('This model already belongs to the provider configuration')
  const input = { baseUrl, model: primaryModel, label, tools: draft.tools }
  const existingPrimary = draft.attachTo ? alreadyExists : undefined
  if (!existingPrimary && names.has(label)) throw new Error('A profile with that label already exists')
  // SP009 0.9.1 LC-01/02：自定义窗口优先，其次服务端发现值，最后沿用档案现值。
  const customWindow = parseContextWindowInput(draft.contextWindow)
  const discovered = draft.discoveredContextWindows ?? {}
  const primaryWindow = customWindow !== undefined
    ? customWindow
    : (discovered[primaryModel] ?? old?.contextWindow)
  const primary = old
    ? updateProfile(old, { ...input, contextWindow: primaryWindow })
    : existingPrimary ?? createProfile({ ...input, contextWindow: primaryWindow ?? undefined })
  names.add(primary.label)

  const additions: ModelProfile[] = []
  for (const model of models) {
    if (model === primaryModel || sameModel.has(model)) continue
    const name = nextLabel(model, names)
    const addWindow = typeof customWindow === 'number' ? customWindow : discovered[model]
    additions.push(createProfile({ baseUrl, model, label: name, tools: draft.tools, contextWindow: addWindow }))
    names.add(name)
  }

  const affected = new Map(members.map((item) => [item.id, item]))
  affected.set(primary.id, primary)
  for (const item of additions) affected.set(item.id, item)
  const ref = grouped && oldRef ? oldRef : affected.size > 1 ? 'group:' + randomUUID() : primary.id
  const key = checkedKey(draft.apiKey)
  const stamp = new Date().toISOString()
  const next = Array.from(affected.values(), (item) => ({
    ...item,
    apiKeyRef: ref,
    baseUrl,
    updatedAt: stamp
  }))
  const saved = next.find((item) => item.id === primary.id)!
  const updated = new Map(next.map((item) => [item.id, item]))
  const existing = new Set(file.models.map((item) => item.id))
  file.models = [
    ...file.models.map((item) => updated.get(item.id) ?? item),
    ...next.filter((item) => !existing.has(item.id))
  ]
  if (draft.startupDefault) file.defaultModelId = saved.id
  else if (!draft.attachTo && (priorDefault === saved.id || file.models.length === 1)) file.defaultModelId = null

  const binding = profileCredentialBinding(saved)
  const oldBinding = anchor ? profileCredentialBinding(anchor) : undefined
  const refChanged = Boolean(oldRef && oldRef !== ref)
  const bindingChanged = Boolean(oldBinding && oldBinding !== binding)
  const copyKey = refChanged && anchor?.baseUrl === baseUrl
  persistProfiles(stores, file, key || refChanged || bindingChanged ? (credentials) => {
    // Only migrate an existing key when explicitly grouping the exact same endpoint.
    const inherited = copyKey && oldRef && credentials.hosts?.[oldRef] === oldBinding
      ? credentials.keys[oldRef] : ''
    if (oldRef && (refChanged || bindingChanged)) {
      delete credentials.keys[oldRef]
      if (credentials.hosts) delete credentials.hosts[oldRef]
    }
    const nextKey = key || inherited
    if (nextKey) {
      credentials.keys[ref] = nextKey
      credentials.hosts = { ...credentials.hosts, [ref]: binding }
    }
  } : undefined)
  const activeId = stores.getConfig().profileId
  const active = activeId ? updated.get(activeId) : undefined
  if (use) selectProfile(stores, saved)
  else if (active) selectProfile(stores, active)
  return saved
}

export function removeModel(stores: Stores, id: string, replacementId?: string) {
  const file = stores.configStore.load()
  const profile = file.models.find((model) => model.id === id)
  if (!profile) throw new Error('Model profile no longer exists')
  const remaining = file.models.filter((model) => model.id !== id)
  const replacement = remaining.find((model) => model.id === replacementId)
  if (replacementId && !replacement) throw new Error('Replacement profile no longer exists')
  const wasActive = stores.getConfig().profileId === id
  if (startupProfile(file)?.id === id) file.defaultModelId = replacement?.id ?? null
  file.models = remaining
  const ref = profileCredentialRef(profile)
  const shared = remaining.some((model) => profileCredentialRef(model) === ref)
  persistProfiles(stores, file, shared ? undefined : (credentials) => {
    delete credentials.keys[ref]
    if (credentials.hosts) delete credentials.hosts[ref]
  })
  if (wasActive) {
    if (replacement) selectProfile(stores, replacement)
    else stores.setConfig({ ...stores.getConfig(), profileId: undefined, model: '', apiKey: '' })
  }
}
