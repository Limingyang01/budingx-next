// Session commands (SP002 design §3.5/§3.6, AC MM-03).
// Commands are processed at turn boundaries only.
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
}

export type CommandContext = {
  session: Session
  configStore: ConfigStore
  credentialStore: CredentialStore
  getConfig: () => ResolvedConfig
  setConfig: (config: ResolvedConfig) => void
  exit: () => void
  probe?: typeof probe
}

export const COMMAND_HELP = `Commands:
  /help                 show this help
  /config               show the active endpoint, model and key state
  /models               list stored model profiles
  /model [id]           switch the model (takes effect from the next turn)
  /provider add         add a model profile
  /provider edit [id]   edit a model profile
  /provider rm [id]     remove a model profile
  /provider check [id]  verify a profile against the provider
  /clear                clear the conversation
  /exit                 leave budingx`

export async function runCommand(
  input: string,
  context: CommandContext
): Promise<CommandOutcome> {
  const text = input.trim()
  if (!text.startsWith('/')) return { handled: false }
  const [command, ...rest] = text.slice(1).split(/\s+/)
  const argument = rest.join(' ')

  switch (command) {
    case 'help':
      return { handled: true, message: COMMAND_HELP }
    case 'exit':
    case 'quit':
      context.exit()
      return { handled: true, exit: true }
    case 'clear': {
      context.session.clearHistory()
      return { handled: true, message: 'Conversation cleared' }
    }
    case 'config': {
      const config = context.getConfig()
      const key = config.apiKey
      return {
        handled: true,
        message: [
          `Endpoint: ${config.baseUrl}`,
          `Model: ${config.model || '(not configured)'}`,
          `API key: ${maskKey(key)}`,
          `Source: ${config.source}`,
          `Timeout: ${config.timeoutMs} ms`
        ].join('\n')
      }
    }
    case 'models': {
      const stored = context.configStore.load()
      if (stored.models.length === 0) {
        return { handled: true, message: 'No model profiles stored yet' }
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
        return { handled: true, message: `Model: ${config.model || '(not configured)'}` }
      }
      const stored = context.configStore.load()
      const profile = stored.models.find(
        (entry) => entry.id === argument || entry.label === argument
      )
      if (!profile) {
        return { handled: true, error: `Unknown model profile: ${argument}` }
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
        message: `Model switched to ${profile.label}; the conversation is kept and the switch applies from the next turn`
      }
    }
    case 'provider':
      return providerCommand(argument, context)
    default:
      return { handled: true, error: 'Unknown command; use /help' }
  }
}

async function providerCommand(
  argument: string,
  context: CommandContext
): Promise<CommandOutcome> {
  const [action, ...rest] = argument.split(/\s+/)
  const id = rest.join(' ')
  const stored = context.configStore.load()

  if (action === 'add') {
    const parts = rest
    const label = parts[0]
    const baseUrl = parts[1]
    const model = parts[2]
    if (!label || !baseUrl || !model) {
      return {
        handled: true,
        error: 'Usage: /provider add <label> <base-url> <model>'
      }
    }
    if (stored.models.some((profile) => profile.label === label)) {
      return { handled: true, error: `A profile named ${label} already exists` }
    }
    const profile = createProfile({ label, baseUrl, model })
    stored.models.push(profile)
    if (!stored.defaultModelId) stored.defaultModelId = profile.id
    context.configStore.save(stored)
    return { handled: true, message: `Added profile ${profile.label} (${profile.id})` }
  }

  if (action === 'edit') {
    const profile = stored.models.find(
      (entry) => entry.id === id || entry.label === id
    )
    if (!profile) return { handled: true, error: `Unknown model profile: ${id}` }
    const parts = rest.slice(1)
    const updated = updateProfile(profile, {
      label: parts[0] ?? profile.label,
      baseUrl: parts[1] ?? profile.baseUrl,
      model: parts[2] ?? profile.model
    })
    const index = stored.models.findIndex((entry) => entry.id === profile.id)
    stored.models[index] = updated
    context.configStore.save(stored)
    const hostChanged =
      profileHost(updated) !== profileHost(profile)
    return {
      handled: true,
      message: hostChanged
        ? `Updated ${updated.label}. The endpoint host changed, so the stored key is no longer used; re-enter the key for the new host.`
        : `Updated ${updated.label}`
    }
  }

  if (action === 'rm') {
    const profile = stored.models.find(
      (entry) => entry.id === id || entry.label === id
    )
    if (!profile) return { handled: true, error: `Unknown model profile: ${id}` }
    stored.models = stored.models.filter((entry) => entry.id !== profile.id)
    if (stored.defaultModelId === profile.id) stored.defaultModelId = stored.models[0]?.id
    context.configStore.save(stored)
    context.credentialStore.remove(profile.id)
    return { handled: true, message: `Removed ${profile.label} and its key` }
  }

  if (action === 'check') {
    const profile = stored.models.find(
      (entry) => entry.id === id || entry.label === id
    )
    if (!profile) return { handled: true, error: `Unknown model profile: ${id}` }
    const key = context.credentialStore.get(profile.id, profileHost(profile))
    if (!key) {
      return {
        handled: true,
        error: `No key stored for ${profile.label}; enter it before checking`
      }
    }
    const checker = context.probe ?? probe
    const result: ProbeResult = await checker(
      { baseUrl: profile.baseUrl, model: profile.model, apiKey: key },
      { tools: profile.capabilities.tools }
    )
    return {
      handled: true,
      message: result.ok
        ? `Provider reachable for ${profile.label}${
            result.supportsTools === undefined
              ? ''
              : result.supportsTools
                ? ' (tool calls supported)'
                : ' (tool calls not supported)'
          }`
        : `Provider check failed for ${profile.label}: ${result.message}`
    }
  }

  return {
    handled: true,
    error: 'Usage: /provider add|edit|rm|check'
  }
}
