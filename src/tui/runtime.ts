import { Session } from '../core/session.js'
import type { ApprovalGateway } from '../core/tools.js'
import { createOpenAiProvider } from '../provider/openai.js'
import { ConfigStore } from '../storage/config-store.js'
import { CredentialStore } from '../storage/credentials.js'
import { profileHost, type ResolvedConfig } from '../storage/profiles.js'

export function createConfiguredSession(
  getConfig: () => ResolvedConfig,
  approval: ApprovalGateway,
  configStore: ConfigStore
): Session {
  const provider = () => {
    const config = getConfig()
    return createOpenAiProvider({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      limits: {
        connectTimeoutMs: config.timeoutMs,
        idleStreamTimeoutMs: config.timeoutMs
      }
    })
  }
  return new Session({
    provider: provider(),
    resolveProvider: provider,
    approval,
    resolveSnapshot: () => {
      const config = getConfig()
      const profile = configStore.load().models.find((p) => p.id === config.profileId)
      return {
        modelId: config.profileId ?? 'session',
        model: config.model,
        baseUrlHost: new URL(config.baseUrl).host,
        capabilities: { tools: profile?.capabilities.tools ?? false }
      }
    }
  })
}

/** The host is checked again because the profile may have changed during entry. */
export function saveProfileKey(
  request: { id: string; host: string },
  key: string,
  stores: { configStore: ConfigStore; credentialStore: CredentialStore },
  getConfig: () => ResolvedConfig,
  setConfig: (next: ResolvedConfig) => void
): void {
  if (!key.trim() || /[\u0000-\u0020\u007f]/.test(key)) throw new Error('Invalid API key')
  const profile = stores.configStore.load().models.find((p) => p.id === request.id)
  if (!profile || profileHost(profile) !== request.host)
    throw new Error('Profile changed; restart key entry')
  stores.credentialStore.set(profile.id, request.host, key)
  const config = getConfig()
  if (config.profileId === profile.id && new URL(config.baseUrl).host === request.host)
    setConfig({ ...config, apiKey: key })
}
