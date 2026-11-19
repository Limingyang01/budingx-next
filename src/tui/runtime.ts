import { randomUUID } from 'node:crypto'
import { createCodingTaskTracker, createTaskRedirectTool } from '../core/coding.js'
import { ERROR_CODES } from '../core/constants.js'
import { createAskUserQuestionTool } from '../core/questions.js'
import { Session, type SubmitOptions } from '../core/session.js'
import type { ApprovalGateway, ToolHandler } from '../core/tools.js'
import type { DenialRecord } from '../core/events.js'
import type { PermissionMode } from '../core/permissions.js'
import { createCommandRunner } from '../exec/runner.js'
import { createSandboxPolicy, type SandboxBackend } from '../exec/sandbox-policy.js'
import { createBackgroundTaskTools, createExecTools } from '../exec/tools.js'
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
import { createGitTools } from './git-tools.js'

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
  sandboxBackend?: SandboxBackend
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
  const originalWorkspace = createWorkspace(options.cwd)
  let currentWorkspace = originalWorkspace
  const workspace: Workspace = {
    get root() { return currentWorkspace.root },
    resolve: (path) => currentWorkspace.resolve(path),
    isInside: (path) => currentWorkspace.isInside(path),
    realOf: (path) => currentWorkspace.realOf(path)
  }
  const permissionStore = new PermissionsStore(
    options.home ? permissionsPath(options.home) : undefined
  )
  const load = permissionStore.load()
  const warnings = load.corrupt && load.corruptReason ? [load.corruptReason] : []
  const policy = createPermissionPolicy({
    workspace,
    managedWorktree: () => currentWorkspace === originalWorkspace ? undefined : currentWorkspace.root,
    rules: load.file.rules as PermissionRule[],
    autoAcceptWorkspaceEdits: options.persistPermissionMode,
    mode: options.mode ?? (options.persistPermissionMode && !load.corrupt
      ? readPermissionMode(options.home)
      : 'read_only'),
    ...(options.home ? { dataRootOverride: dataRoot(options.home) } : {})
  })
  // Search results honour Read deny rules (SP003 T18i): a file the policy
  // refuses to read must not leak through Glob/Grep listings either.
  const workspaceToolOptions = {
    readDenied: (relativePath: string) =>
      policy.decide({ tool: 'Read', capability: 'read', path: relativePath })
        .action === 'deny'
  }
  const contexts = new Map<string, ReturnType<typeof createWorkspaceTools>>()
  function toolsFor(target: Workspace) {
    let scope = contexts.get(target.root)
    if (!scope) {
      scope = createWorkspaceTools(target, workspaceToolOptions)
      contexts.set(target.root, scope)
    }
    return scope
  }
  let activeTools = toolsFor(originalWorkspace)
  const workspaceTools = activeTools.tools.map((handler, index): ToolHandler => ({
    ...handler,
    execute: (input, context) => activeTools.tools[index].execute(input, context),
    ...(handler.prepareApproval ? {
      prepareApproval: (input: unknown) => activeTools.tools[index].prepareApproval!(input)
    } : {})
  }))
  // SP004 §4.4/§6.1：会话标识隔离后台输出目录与会话计划文件。
  const sessionId = randomUUID()
  const planMode = createPlanModeHost({
    sessionId,
    workspace,
    ...(options.home ? { home: options.home } : {})
  })
  const runner = createCommandRunner({
    defaultCwd: workspace.root,
    sandboxPolicy: createSandboxPolicy({ backend: options.sandboxBackend }),
    onCommandFinished: (event) => session.commandFinished(event),
    sessionId,
    ...(options.home ? { home: options.home } : {})
  })
  const execTools = createExecTools({
    runner,
    defaultCwd: workspace.root,
    getCwd: () => workspace.root,
    sandboxBackendId: options.sandboxBackend?.id,
    platform: process.platform
  })
  const gitTools = createGitTools({
    cwd: () => workspace.root,
    checkpoint: () => activeTools.checkpoint,
    switchWorkspace(path) {
      currentWorkspace = path === originalWorkspace.root ? originalWorkspace : createWorkspace(path)
      activeTools = toolsFor(currentWorkspace)
    },
    home: options.home
  })
  const codingTask = createCodingTaskTracker()
  const tools: ToolHandler[] = [
    ...workspaceTools,
    ...execTools,
    ...gitTools,
    ...createBackgroundTaskTools(runner),
    {
      name: 'StartCodingTask',
      summary: 'Track a user-requested coding task and require test evidence before reporting completion',
      parameters: {
        type: 'object',
        properties: { goal: { type: 'string', minLength: 1 } },
        required: ['goal'],
        additionalProperties: false
      },
      describe: () => '开始跟踪编码任务',
      async execute(input) {
        const goal = (input as { goal?: unknown } | null)?.goal
        if (typeof goal !== 'string' || !goal.trim()) throw new Error('Coding task goal is required')
        if (codingTask.get()) throw new Error('A coding task is already active; use TaskRedirect to change its goal')
        return JSON.stringify(codingTask.start(goal))
      }
    },
    createTaskRedirectTool(codingTask)
  ]
  const denials: DenialRecord[] = []
  const session = new Session({
    id: sessionId,
    provider: provider(),
    resolveProvider: provider,
    approval: options.approval,
    tools,
    planMode,
    codingTask,
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
  tools.push(createAskUserQuestionTool(session), ...createPlanModeTools(session, planMode.writePlanText))
  session.on((event) => {
    if (event.type === 'denial_recorded') denials.push(event.denial)
    if (event.type === 'conversation_cleared' ||
      (event.type === 'turn_finalized' && (event.outcome === 'completed' ||
        event.error?.code === ERROR_CODES.execSandboxUnavailable))) codingTask.reset?.()
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

  return {
    session, workspace, policy, setPermissionMode, permissionStore, denials, warnings,
    get checkpoint() { return activeTools.checkpoint }
  }
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
