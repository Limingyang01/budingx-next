import { Session } from '../core/session.js'
import type { ApprovalGateway, ToolHandler } from '../core/tools.js'
import type { DenialRecord } from '../core/events.js'
import type { PermissionMode } from '../core/permissions.js'
import { createOpenAiProvider } from '../provider/openai.js'
import { ConfigStore } from '../storage/config-store.js'
import { CredentialStore } from '../storage/credentials.js'
import { dataRoot, permissionsPath } from '../storage/paths.js'
import { PermissionsStore } from '../storage/permissions.js'
import { profileHost, type ResolvedConfig } from '../storage/profiles.js'
import {
  createPermissionPolicy,
  type BudingPermissionPolicy,
  type PermissionRule
} from '../workspace/policy.js'
import { createWorkspaceTools, type CheckpointStore } from '../workspace/index.js'
import { createWorkspace, type Workspace } from '../workspace/paths.js'

export type AgentRuntime = {
  session: Session
  workspace: Workspace
  policy: BudingPermissionPolicy
  permissionStore: PermissionsStore
  checkpoint: CheckpointStore
  /** Live record of refusals for /denials (SP003 AC PC-10). */
  denials: DenialRecord[]
  /** Startup warnings, e.g. a corrupt permissions file. */
  warnings: string[]
}

export type AgentRuntimeOptions = {
  cwd: string
  getConfig: () => ResolvedConfig
  approval: ApprovalGateway
  configStore: ConfigStore
  mode?: PermissionMode
  /** Test seam for the user data location; production uses ~/.budingx. */
  home?: string
}

/**
 * Build the Session with the SP003 workspace tools and permission policy
 * wired in (SP003 design §3.1). The permission file is read once here;
 * /rules writes it back through permissionStore and re-syncs the policy.
 */
export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  const provider = () => {
    const config = options.getConfig()
    return createOpenAiProvider({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      limits: {
        connectTimeoutMs: config.timeoutMs,
        idleStreamTimeoutMs: config.timeoutMs
      }
    })
  }
  const workspace = createWorkspace(options.cwd)
  const permissionStore = new PermissionsStore(
    options.home ? permissionsPath(options.home) : undefined
  )
  const load = permissionStore.load()
  const warnings = load.corrupt && load.corruptReason ? [load.corruptReason] : []
  const policy = createPermissionPolicy({
    workspace,
    rules: load.file.rules as PermissionRule[],
    mode: options.mode ?? 'read_only',
    ...(options.home ? { dataRootOverride: dataRoot(options.home) } : {})
  })
  // Search results honour Read deny rules (SP003 T18i): a file the policy
  // refuses to read must not leak through Glob/Grep listings either.
  const { tools, checkpoint } = createWorkspaceTools(workspace, {
    readDenied: (relativePath) =>
      policy.decide({ tool: 'Read', capability: 'read', path: relativePath })
        .action === 'deny'
  })
  const denials: DenialRecord[] = []
  const session = new Session({
    provider: provider(),
    resolveProvider: provider,
    approval: options.approval,
    tools,
    permissionPolicy: policy,
    resolveSnapshot: () => {
      const config = options.getConfig()
      const profile = options.configStore
        .load()
        .models.find((p) => p.id === config.profileId)
      return {
        modelId: config.profileId ?? 'session',
        model: config.model,
        baseUrlHost: new URL(config.baseUrl).host,
        capabilities: { tools: profile?.capabilities.tools ?? false }
      }
    }
  })
  session.on((event) => {
    if (event.type === 'denial_recorded') denials.push(event.denial)
  })
  return { session, workspace, policy, permissionStore, checkpoint, denials, warnings }
}

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
