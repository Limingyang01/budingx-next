import { randomUUID } from 'node:crypto'
import { createAskUserQuestionTool } from '../core/questions.js'
import { Session, type SubmitOptions } from '../core/session.js'
import type { ApprovalGateway, ToolHandler } from '../core/tools.js'
import type { DenialRecord } from '../core/events.js'
import type { PermissionMode } from '../core/permissions.js'
import { createCommandRunner } from '../exec/runner.js'
import { createSandboxPolicy } from '../exec/sandbox-policy.js'
import { createExecTools } from '../exec/tools.js'
import { createPlanModeHost } from '../plan/host.js'
import { createPlanModeTools } from '../plan/tools.js'
import { createOpenAiProvider } from '../provider/openai.js'
import { ConfigStore } from '../storage/config-store.js'
import { dataRoot, permissionsPath } from '../storage/paths.js'
import { PermissionsStore, readPermissionMode, savePermissionMode } from '../storage/permissions.js'
import type { ResolvedConfig } from '../storage/profiles.js'
import {
  createPermissionPolicy,
  type BudingPermissionPolicy,
  type PermissionRule
} from '../workspace/policy.js'
import { createWorkspaceTools, resolveFileReferences, type CheckpointStore } from '../workspace/index.js'
import { createWorkspace, type Workspace } from '../workspace/paths.js'

export function workspacePromptOptions(
  text: string,
  workspace: Workspace,
  policy: BudingPermissionPolicy
): SubmitOptions {
  return {
    resolveContext: () => {
      const { blocks, errors } = resolveFileReferences(workspace, text, (path) => {
        const decision = policy.decide({ tool: 'Read', capability: 'read', path })
        return decision.action === 'allow' ? undefined : decision.reason
      })
      return {
        context: blocks.map(({ source, content, notice }) => ({
          source,
          content: [content, notice].filter(Boolean).join('\n')
        })),
        notices: [
          ...blocks.map(({ source, notice }) => notice ? `@${source}: ${notice}` : `@${source} attached`),
          ...errors.map(({ raw, message }) => `@${raw}: ${message}`)
        ]
      }
    }
  }
}

export type AgentRuntime = {
  session: Session
  workspace: Workspace
  policy: BudingPermissionPolicy
  setPermissionMode(mode: PermissionMode): boolean
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
  persistPermissionMode?: boolean
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
    autoAcceptWorkspaceEdits: options.persistPermissionMode,
    mode: options.mode ?? (options.persistPermissionMode && !load.corrupt
      ? readPermissionMode(options.home)
      : 'read_only'),
    ...(options.home ? { dataRootOverride: dataRoot(options.home) } : {})
  })
  // Search results honour Read deny rules (SP003 T18i): a file the policy
  // refuses to read must not leak through Glob/Grep listings either.
  const { tools: workspaceTools, checkpoint } = createWorkspaceTools(workspace, {
    readDenied: (relativePath) =>
      policy.decide({ tool: 'Read', capability: 'read', path: relativePath })
        .action === 'deny'
  })
  // SP004 §4.4/§6.1：会话标识隔离后台输出目录与会话计划文件。
  const sessionId = randomUUID()
  const planMode = createPlanModeHost({
    sessionId,
    workspace,
    ...(options.home ? { home: options.home } : {})
  })
  // SP004 §4.7：隔离后端由宿主注入；本仓尚无已验证后端，因此 fail closed——
  // 普通命令在 spawn 之前即被拒绝（设计允许的宿主托管能力不受影响）。
  const runner = createCommandRunner({
    defaultCwd: workspace.root,
    sandboxPolicy: createSandboxPolicy({}),
    sessionId,
    ...(options.home ? { home: options.home } : {})
  })
  const execTools = createExecTools({
    runner,
    defaultCwd: workspace.root,
    platform: process.platform
  })
  const tools: ToolHandler[] = [...workspaceTools, ...execTools]
  const denials: DenialRecord[] = []
  const session = new Session({
    id: sessionId,
    provider: provider(),
    resolveProvider: provider,
    approval: options.approval,
    tools,
    planMode,
    disposers: [() => runner.dispose?.()],
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
  // 追问与计划模式工具需要 Session 实例本身，因此在构造后追加（数组引用共享）。
  tools.push(createAskUserQuestionTool(session), ...createPlanModeTools(session))
  session.on((event) => {
    if (event.type === 'denial_recorded') denials.push(event.denial)
  })
  function setPermissionMode(mode: PermissionMode): boolean {
    policy.setMode(mode)
    if (!options.persistPermissionMode) return true
    try {
      savePermissionMode(mode, options.home)
      return true
    } catch {
      return false
    }
  }

  return { session, workspace, policy, setPermissionMode, permissionStore, checkpoint, denials, warnings }
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
