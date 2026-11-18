import { randomUUID } from 'node:crypto'
import type { ConfigFile, ModelProfile } from './config-store.js'

export type { ModelProfile }

export function startupProfile(file: ConfigFile): ModelProfile | undefined {
  if (file.defaultModelId === null) return undefined
  return file.models.find((profile) => profile.id === file.defaultModelId) ?? file.models[0]
}

export type Config = {
  baseUrl: string
  model: string
  apiKey: string
  timeoutMs: number
  prompt?: string
}

export function normalizeBaseUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('Invalid base URL')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Base URL must not contain credentials, query or fragment')
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new Error('Use HTTPS (HTTP is allowed only for explicit loopback endpoints)')
  return url.toString().replace(/\/+$/, '')
}

export function loadConfig(args: string[], env: NodeJS.ProcessEnv): Config {
  const config: Config = {
    baseUrl: env.BUDINGX_BASE_URL || 'https://api.openai.com/v1',
    model: env.BUDINGX_MODEL || '',
    apiKey: env.BUDINGX_API_KEY || '',
    timeoutMs: 120000
  }
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (!['--base-url', '--model', '--timeout', '--prompt'].includes(flag))
      throw new Error('Unknown option; use --help')
    const value = args[++i]
    if (!value || value.startsWith('--')) throw new Error('Option requires a value')
    if (flag === '--base-url') config.baseUrl = value
    if (flag === '--model') config.model = value
    if (flag === '--timeout') config.timeoutMs = Number(value)
    if (flag === '--prompt') config.prompt = value
  }
  config.baseUrl = normalizeBaseUrl(config.baseUrl)
  if (
    !Number.isSafeInteger(config.timeoutMs) ||
    config.timeoutMs < 1 ||
    config.timeoutMs > 600000
  )
    throw new Error('Timeout must be 1–600000 milliseconds')
  if (config.model.length > 256 || /[\r\n\x00-\x1f]/.test(config.model))
    throw new Error('Invalid model name')
  if (/[\r\n]/.test(config.apiKey)) throw new Error('Invalid API key')
  return config
}

// --- Model profiles (SP002 design §3.5, AC MM-03/MM-04/MM-07) ---

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export function validateProfileInput(input: {
  label?: string
  baseUrl?: string
  model?: string
}): void {
  const label = input.label ?? ''
  if (!label.trim()) throw new Error('Profile label is required')
  if (label.length > 64) throw new Error('Profile label is too long (max 64)')
  if (CONTROL_CHARACTERS.test(label))
    throw new Error('Profile label contains control characters')
  const model = input.model ?? ''
  if (!model.trim()) throw new Error('Model name is required')
  if (model.length > 256) throw new Error('Model name is too long (max 256)')
  if (CONTROL_CHARACTERS.test(model))
    throw new Error('Model name contains control characters')
  normalizeBaseUrl(input.baseUrl ?? '')
}

export function createProfile(
  input: { label: string; baseUrl: string; model: string; tools?: boolean },
  now: Date = new Date()
): ModelProfile {
  validateProfileInput(input)
  const id = randomUUID()
  const stamp = now.toISOString()
  return {
    id,
    label: input.label.trim(),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    model: input.model.trim(),
    apiKeyRef: id,
    capabilities: { tools: input.tools ?? true },
    createdAt: stamp,
    updatedAt: stamp
  }
}

export function updateProfile(
  profile: ModelProfile,
  patch: { label?: string; baseUrl?: string; model?: string; tools?: boolean },
  now: Date = new Date()
): ModelProfile {
  validateProfileInput({
    label: patch.label ?? profile.label,
    baseUrl: patch.baseUrl ?? profile.baseUrl,
    model: patch.model ?? profile.model
  })
  return {
    ...profile,
    label: (patch.label ?? profile.label).trim(),
    baseUrl: normalizeBaseUrl(patch.baseUrl ?? profile.baseUrl),
    model: (patch.model ?? profile.model).trim(),
    capabilities: {
      tools: patch.tools ?? profile.capabilities.tools
    },
    updatedAt: now.toISOString()
  }
}

/** The host a key is bound to. A key is never reused for another host. */
export function profileHost(profile: ModelProfile): string {
  return new URL(profile.baseUrl).host
}

/** Legacy profiles used the profile ID. Only explicit, generated group refs share credentials. */
export function profileCredentialRef(profile: ModelProfile): string {
  return /^group:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(profile.apiKeyRef)
    ? profile.apiKeyRef
    : profile.id
}

export function profileCredentialBinding(profile: ModelProfile, baseUrl = profile.baseUrl): string {
  return profileCredentialRef(profile) === profile.id ? new URL(baseUrl).host : baseUrl
}

export function maskKey(key: string | undefined): string {
  if (!key) return '(not set)'
  if (key.length <= 4) return '***'
  return '…' + key.slice(-4)
}

export type ProfileSource = {
  profileId?: string
  baseUrl?: string
  model?: string
  apiKey?: string
  timeoutMs?: number
}

export type ResolvedConfig = {
  baseUrl: string
  model: string
  apiKey: string
  timeoutMs: number
  prompt?: string
  profileId?: string
  source: 'cli' | 'env' | 'file' | 'default'
}

/**
 * Configuration priority: CLI arguments > BUDINGX_* environment > stored
 * profile. The 0.1.1 environment and flag usage stays intact.
 */
export function mergeSources(input: {
  args: string[]
  env: NodeJS.ProcessEnv
  file?: ProfileSource
}): ResolvedConfig {
  const cli: ProfileSource & { prompt?: string } = {}
  const args = input.args
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (!['--base-url', '--model', '--timeout', '--prompt'].includes(flag))
      throw new Error('Unknown option; use --help')
    const value = args[++i]
    if (!value || value.startsWith('--')) throw new Error('Option requires a value')
    if (flag === '--base-url') cli.baseUrl = value
    if (flag === '--model') cli.model = value
    if (flag === '--timeout') cli.timeoutMs = Number(value)
    if (flag === '--prompt') cli.prompt = value
  }

  const env: ProfileSource = {}
  if (input.env.BUDINGX_BASE_URL) env.baseUrl = input.env.BUDINGX_BASE_URL
  if (input.env.BUDINGX_MODEL) env.model = input.env.BUDINGX_MODEL
  if (input.env.BUDINGX_API_KEY) env.apiKey = input.env.BUDINGX_API_KEY

  const file = input.file ?? {}
  const pick = <K extends keyof ProfileSource>(key: K): ProfileSource[K] | undefined =>
    cli[key] ?? env[key] ?? file[key]

  const baseUrl = pick('baseUrl') ?? 'https://api.openai.com/v1'
  const model = pick('model') ?? ''
  const sameHost =
    !file.baseUrl ||
    new URL(normalizeBaseUrl(baseUrl)).host === new URL(file.baseUrl).host
  const apiKey = env.apiKey ?? (sameHost ? file.apiKey : undefined) ?? ''
  const timeoutMs = pick('timeoutMs') ?? 120000

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000)
    throw new Error('Timeout must be 1–600000 milliseconds')
  if (model.length > 256 || /[\u0000-\u001f\u007f]/.test(model))
    throw new Error('Invalid model name')
  if (/[\r\n]/.test(apiKey)) throw new Error('Invalid API key')

  const source: ResolvedConfig['source'] =
    cli.baseUrl || cli.model
      ? 'cli'
      : env.baseUrl || env.model || env.apiKey
        ? 'env'
        : file.baseUrl || file.model
          ? 'file'
          : 'default'

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    model,
    apiKey,
    timeoutMs,
    ...(cli.prompt === undefined ? {} : { prompt: cli.prompt }),
    ...(file.profileId ? { profileId: file.profileId } : {}),
    source
  }
}
