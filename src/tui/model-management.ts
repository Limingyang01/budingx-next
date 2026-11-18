import { discoverModels, probe } from '../provider/openai.js'
import { createProfile, normalizeBaseUrl, profileHost, startupProfile, updateProfile } from '../storage/profiles.js'
import type { ModelProfile } from '../storage/config-store.js'
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
  updatedAt?: string
  label: string
  baseUrl: string
  model: string
  apiKey: string
  tools: boolean
  startupDefault: boolean
}

export function selectProfile(stores: Stores, profile: ModelProfile) {
  const apiKey = stores.credentialStore.get(profile.id, profileHost(profile)) ?? ''
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

export function draftConnection(stores: Stores, draft: ModelDraft) {
  const baseUrl = normalizeBaseUrl(draft.baseUrl.trim())
  const host = new URL(baseUrl).host
  const model = draft.model.trim()
  const apiKey = checkedKey(draft.apiKey)
    || (draft.id ? stores.credentialStore.get(draft.id, host) : undefined)
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
    return { models: await request(url.toString(), apiKey, { signal }), suggested: false }
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

export async function testProfile(ctx: CommandContext, draft: ModelDraft, signal: AbortSignal) {
  const connection = draftConnection(ctx, draft)
  if (!connection.model || connection.model.length > 256 || /[\x00-\x1f\x7f]/.test(connection.model)) {
    throw new Error('Enter a valid model ID first')
  }
  return (ctx.probe ?? probe)(connection, { signal, tools: draft.tools })
}

export function saveModel(stores: Stores, draft: ModelDraft, use: boolean): ModelProfile {
  const file = stores.configStore.load()
  const priorDefault = startupProfile(file)?.id
  const old = draft.id ? file.models.find((model) => model.id === draft.id) : undefined
  if (draft.id && !old) throw new Error('Model profile no longer exists')
  if (old && draft.updatedAt && old.updatedAt !== draft.updatedAt) throw new Error('Profile changed; reopen it before saving')
  const baseUrl = normalizeBaseUrl(draft.baseUrl.trim())
  const model = draft.model.trim()
  const input = { baseUrl, model, label: draft.label.trim() || model.slice(0, 64), tools: draft.tools }
  if (file.models.some((item) => item.id !== draft.id && item.label === input.label)) {
    throw new Error('A profile with that label already exists')
  }
  const profile = old ? updateProfile(old, input) : createProfile(input)
  const key = checkedKey(draft.apiKey)
  const host = profileHost(profile)
  const changedHost = old && profileHost(old) !== host
  const credentials = key || changedHost ? stores.credentialStore.load() : undefined
  if (key) stores.credentialStore.set(profile.id, host, key)
  else if (changedHost) stores.credentialStore.remove(profile.id)
  file.models = old
    ? file.models.map((item) => item.id === old.id ? profile : item)
    : [...file.models, profile]
  if (draft.startupDefault) file.defaultModelId = profile.id
  else if (priorDefault === profile.id || file.models.length === 1) file.defaultModelId = null

  try {
    stores.configStore.save(file)
  } catch (error) {
    if (credentials) stores.credentialStore.save(credentials)
    throw error
  }
  if (use || stores.getConfig().profileId === profile.id) selectProfile(stores, profile)
  return profile
}

export function removeModel(stores: Stores, id: string, replacementId?: string) {
  const file = stores.configStore.load()
  if (!file.models.some((model) => model.id === id)) throw new Error('Model profile no longer exists')
  const remaining = file.models.filter((model) => model.id !== id)
  const replacement = remaining.find((model) => model.id === replacementId)
  if (replacementId && !replacement) throw new Error('Replacement profile no longer exists')
  const wasActive = stores.getConfig().profileId === id
  if (startupProfile(file)?.id === id) file.defaultModelId = replacement?.id ?? null
  file.models = remaining
  const credentials = stores.credentialStore.load()
  stores.credentialStore.remove(id)
  try {
    stores.configStore.save(file)
  } catch (error) {
    stores.credentialStore.save(credentials)
    throw error
  }
  if (wasActive) {
    if (replacement) selectProfile(stores, replacement)
    else stores.setConfig({ ...stores.getConfig(), profileId: undefined, model: '', apiKey: '' })
  }
}
