import { randomUUID } from 'node:crypto'
import { createAskUserQuestionTool } from '../core/questions.js'
import { createWebSearchTool } from '../provider/web-search.js'
import { Session, type SubmitOptions } from '../core/session.js'
import type { ApprovalGateway, ToolHandler } from '../core/tools.js'
import type { DenialRecord } from '../core/events.js'
import type { PermissionMode } from '../core/permissions.js'
import { createCommandRunner } from '../exec/runner.js'
import { createSandboxPolicy } from '../exec/sandbox-policy.js'
import { createExecTools } from '../exec/tools.js'
import { createPlanModeHost } from '../plan/host.js'
import { createPlanModeTools, routePlanDraftTools } from '../plan/tools.js'
import { createOpenAiProvider } from '../provider/openai.js'
import { ConfigStore } from '../storage/config-store.js'
import { dataRoot, permissionsPath } from '../storage/paths.js'
import { PermissionsStore, readPermissionMode, savePermissionMode } from '../storage/permissions.js'
import {
  createSessionStore,
  startSession,
  type SessionStore
} from '../storage/session-store.js'
import {
  createProjectMemory,
  createSessionMemory,
  memoryContextText,
  type MemoryScope
} from '../storage/project-memory.js'
import { estimateTokens, normalizeBudget, triggerTokens } from '../core/context-budget.js'
import type { ReasoningEffort } from '../core/provider.js'
import type { ResolvedConfig } from '../storage/profiles.js'
import {
  createPermissionPolicy,
  type BudingPermissionPolicy,
  type PermissionRule
} from '../workspace/policy.js'
import { createWorkspaceTools, resolveFileReferences, type CheckpointStore } from '../workspace/index.js'
import { createWorkspace, type Workspace } from '../workspace/paths.js'
import type { Tracer } from '../core/observability.js'
import {
  loadTracingEnvironment,
  isValidBaseUrl,
  TracingRuntime,
  type ReceiptReporter
} from '../observability/index.js'

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
  /** SP004 agent-observability：正常退出时的限时追踪 flush；未启用时为 undefined。 */
  shutdownTracing?: () => Promise<void>
  /** SP006 §11：无头 system init 事件声明的工具名（注册顺序）。 */
  toolNames: string[]
  /** SP005：会话列表与恢复能力；未开启持久化时为 undefined。 */
  sessions?: {
    list: () => { sessionId: string; title: string; updatedAt: string; turns: number }[]
    resume: (sessionId: string) => {
      ok: boolean
      message?: string
      messages?: unknown[]
      needsReview?: { name: string; callId: string; detail?: string }[]
      warnings?: string[]
    }
  }
  /** 0.5.2：上下文用量（provider 真实 usage 优先，缺失时本地估算）。 */
  contextUsage?: {
    usage: () => {
      usedTokens?: number
      maxTokens?: number
      reservedOutputTokens?: number
      triggerTokens?: number
      percentUsed?: number
      source: 'provider' | 'none'
    }
  }
  /** SP005：上下文预算构成。 */
  context?: {
    budget: () => {
      estimatedTokens: number
      maxTokens: number
      reservedOutputTokens: number
      triggerTokens: number
      messages: number
      breakdown: { kind: string; tokens: number }[]
    }
  }
  /** 0.5.2：推理强度（/effort 与状态栏共用）。 */
  effort?: {
    current: () => ReasoningEffort
    set: (next: ReasoningEffort) => void
    choices: readonly ReasoningEffort[]
  }
  /** SP005：项目与会话记忆。 */
  memory?: {
    read: (scope: MemoryScope) => { entries: { title: string; text: string }[]; message?: string }
    write: (scope: MemoryScope, title: string, text: string) => { ok: boolean; message?: string }
  }
}

/**
 * SP004 agent-observability §4.9：追踪装配。TUI 与无界面验收脚本共用。
 * 任何失败都降级为「不注入 tracer」，绝不阻断启动；诊断不含密钥。
 */
export function setupTracing(options: {
  sessionId: string
  env?: NodeJS.ProcessEnv
  modelApiKey?: string
  report?: (message: string) => void
  onReceipt?: ReceiptReporter
}): { tracer?: Tracer; shutdown?: () => Promise<void>; diagnostics: string[] } {
  const env = options.env ?? process.env
  const diagnostics: string[] = []
  // 0.5.4：观测状态属于内部诊断，不再作为启动告警暴露给用户
  //（此前每次启动都会打印「Warning: Langfuse tracing: disabled」）。
  const report = (message: string): void => {
    diagnostics.push(message)
  }
  const merged = loadTracingEnvironment(env, env.BUDINGX_LANGFUSE_ENV_FILE, report)
  if (merged.BUDINGX_LANGFUSE_ENABLED !== '1') {
    report('Langfuse tracing: disabled')
    return { diagnostics }
  }
  if (!merged.LANGFUSE_PUBLIC_KEY || !merged.LANGFUSE_SECRET_KEY) {
    report('Langfuse tracing: disabled (missing project keys)')
    return { diagnostics }
  }
  const baseUrl = merged.LANGFUSE_BASE_URL || 'http://localhost:3000'
  if (!isValidBaseUrl(baseUrl)) {
    report('Langfuse tracing: disabled (invalid base url)')
    return { diagnostics }
  }
  const captureContent = merged.BUDINGX_LANGFUSE_CAPTURE_CONTENT === '1'
  const knownSecrets = [merged.LANGFUSE_SECRET_KEY, options.modelApiKey ?? ''].filter(
    (secret) => secret.length >= 8
  )
  const runtime = new TracingRuntime({
    config: {
      enabled: true,
      baseUrl,
      publicKey: merged.LANGFUSE_PUBLIC_KEY,
      secretKey: merged.LANGFUSE_SECRET_KEY,
      captureContent,
      knownSecrets
    },
    sessionId: options.sessionId,
    ...(options.onReceipt ? { report: options.onReceipt } : {})
  })
  report('Langfuse tracing: enabled')
  report(`Langfuse content capture: ${captureContent ? 'on' : 'off'}`)
  try {
    report(`Langfuse base url: ${new URL(baseUrl).host}`)
  } catch {
    /* URL 已校验 */
  }
  return {
    tracer: runtime,
    shutdown: () => runtime.shutdown(),
    diagnostics
  }
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
  /** SP005: reuse an existing session id instead of generating a new one. */
  sessionId?: string
  /** SP005: context budget in tokens; disabled when omitted. */
  contextBudget?: { maxTokens: number; reservedOutputTokens?: number }
  /** SP005: enable the session transcript (persistence) and project memory. */
  persistence?: boolean
  /** 0.5.2: initial reasoning effort; /effort changes it at runtime. */
  reasoningEffort?: ReasoningEffort
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
  const sessionId = options.sessionId ?? randomUUID()
  const tracing = setupTracing({
    sessionId,
    modelApiKey: options.getConfig().apiKey,
    report: (message) => warnings.push(message)
  })
  const planMode = createPlanModeHost({
    sessionId,
    workspace,
    ...(options.home ? { home: options.home } : {})
  })
  // SP004 §4.7：隔离后端由宿主注入；本仓尚无已验证后端，因此 fail closed——
  // 普通命令在 spawn 之前即被拒绝（设计允许的宿主托管能力不受影响）。
  // 0.5.4：对齐参考实现——权限审批是安全控制，沙箱为可选加固。未配置隔离后端时
  // 采用宿主信任执行：只读命令免审、其余按权限档位审批，命令可用而非一律拒绝。
  const sandboxPolicy = createSandboxPolicy({ hostTrusted: true })
  const runner = createCommandRunner({
    defaultCwd: workspace.root,
    sandboxPolicy,
    sessionId,
    ...(options.home ? { home: options.home } : {})
  })
  const execTools = createExecTools({
    runner,
    defaultCwd: workspace.root,
    sandboxPolicy
  })
  const tools: ToolHandler[] = [
    ...workspaceTools,
    ...execTools,
    createWebSearchTool(process.env.BUDINGX_TAVILY_API_KEY)
  ]
  const denials: DenialRecord[] = []
  // SP005 §5：会话转录与索引。持久化是可选的，未开启时行为与 SP004 一致。
  // 0.5.2：推理强度在运行时可变；会话每次请求读取一次。
  const effortChoices: readonly ReasoningEffort[] = ['low', 'medium', 'high']
  // 未显式设置时不发送该参数：不少兼容端点遇到未知字段会直接 400。
  // 状态栏仍显示默认值，避免“没设置”看起来像功能缺失。
  const DEFAULT_EFFORT: ReasoningEffort = 'medium'
  // 状态栏上下文占比的默认窗口（可用 BUDINGX_CONTEXT_WINDOW 覆盖）。
  const DEFAULT_CONTEXT_WINDOW = 200000
  let reasoningEffort: ReasoningEffort | undefined = options.reasoningEffort
  const persistence = options.persistence ?? false
  let sessionStore: SessionStore | undefined
  let transcript: ReturnType<typeof startSession>['transcript'] | undefined
  if (persistence) {
    sessionStore = createSessionStore({
      workspaceRoot: workspace.root,
      ...(options.home ? { home: options.home } : {})
    })
    try {
      transcript = startSession({
        sessionId,
        workspaceRoot: workspace.root,
        ...(options.home ? { home: options.home } : {})
      }).transcript
    } catch (error) {
      warnings.push(
        `session transcript could not be created: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  const session = new Session({
    id: sessionId,
    resolveReasoningEffort: () => reasoningEffort,
    provider: provider(),
    resolveProvider: provider,
    approval: options.approval,
    tools,
    planMode,
    disposers: [() => runner.dispose?.()],
    permissionPolicy: policy,
    ...(tracing.tracer ? { tracer: tracing.tracer } : {}),
    ...(transcript ? { transcript } : {}),
    ...(options.contextBudget
      ? {
          contextBudget: {
            maxTokens: options.contextBudget.maxTokens,
            ...(options.contextBudget.reservedOutputTokens !== undefined
              ? { reservedOutputTokens: options.contextBudget.reservedOutputTokens }
              : {})
          }
        }
      : {}),
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
  routePlanDraftTools(tools, session, planMode.draftPath, planMode.draftWorkspace)
  tools.push(createAskUserQuestionTool(session), ...createPlanModeTools(session, planMode.draftPath))
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

  // SP005 §5/§7：/sessions 与 /resume 的宿主实现。恢复只装载历史，
  // 绝不重放工具调用；未知结果标记为需核对。
  const sessionsSurface = sessionStore
    ? {
        list: () =>
          sessionStore!.list().map((entry) => ({
            sessionId: entry.sessionId,
            title: entry.title,
            updatedAt: entry.updatedAt,
            turns: entry.turns
          })),
        resume: (target: string) => {
          const restored = sessionStore!.restore(target)
          if (restored.status !== 'restored') {
            return { ok: false, message: restored.message ?? restored.status }
          }
          const restoredMessages = restored.messages as { id: string; role: string; blocks: unknown[] }[]
          session.restoreHistory(restoredMessages as unknown as Parameters<typeof session.restoreHistory>[0])
          // SR-10：沿用会话记录的权限模式，且绝不因恢复而升权。
          session.restorePermissionMode(restored.summary?.permissionMode)
          return {
            ok: true,
            messages: restoredMessages,
            needsReview: restored.needsReview.map((step) => ({
              name: step.name,
              callId: step.callId,
              ...(step.detail ? { detail: step.detail } : {})
            })),
            warnings: restored.warnings
          }
        }
      }
    : undefined
  // SP005 §4：/context 的预算构成（网格视图归 SP006）。
  const contextSurface = options.contextBudget
    ? {
        budget: () => {
          const history = session.history
          // 与会话循环使用同一个归一化预算与阈值工厂，
          // 避免 /context 展示的预留额与实际行为不一致（SP005 review M3）。
          const shape = normalizeBudget(
            options.contextBudget!.maxTokens,
            options.contextBudget!.reservedOutputTokens
          )
          const breakdown = history.map((message, index) => ({
            kind: `${index + 1}.${message.role}`,
            tokens: estimateTokens([message])
          }))
          return {
            estimatedTokens: estimateTokens(history),
            maxTokens: shape.maxTokens,
            reservedOutputTokens: shape.reservedOutputTokens,
            triggerTokens: triggerTokens({ messages: [...history], ...shape }),
            messages: history.length,
            breakdown
          }
        }
      }
    : undefined
  // SP005 §7：/memory 的宿主实现。项目记忆按工作区根隔离，会话记忆按会话隔离。
  const memorySurface = persistence
    ? {
        read: (scope: MemoryScope) => {
          const memory = scope === 'project'
            ? createProjectMemory({
                projectRoot: workspace.root,
                ...(options.home ? { home: options.home } : {})
              })
            : createSessionMemory({
                sessionId,
                ...(options.home ? { home: options.home } : {})
              })
          const read = memory.read()
          return {
            entries: read.entries.map((entry) => ({ title: entry.title, text: entry.body })),
            ...(read.corrupt ? { message: read.corruptReason ?? 'memory file is corrupt' } : {})
          }
        },
        write: (scope: MemoryScope, title: string, text: string) => {
          const memory = scope === 'project'
            ? createProjectMemory({
                projectRoot: workspace.root,
                ...(options.home ? { home: options.home } : {})
              })
            : createSessionMemory({
                sessionId,
                ...(options.home ? { home: options.home } : {})
              })
          const written = memory.write(title, text)
          return written.ok
            ? { ok: true }
            : { ok: false, message: written.message }
        }
      }
    : undefined

  // 0.5.2：上下文用量。provider 汇报过就采信真实 input token，
  // 否则退回本地估算，并明确标注来源。
  const contextUsageSurface = {
    usage: () => {
      // 0.5.4：状态栏上下文占比只用 Provider 真实上报的 inputTokens，
      // 不再用本地估算代替百分比（用户明确要求「不需要估算」）。
      // 未拿到真实用量前不显示占比；窗口缺省按 200k 计算，可用
      // BUDINGX_CONTEXT_WINDOW 覆盖。
      const providerUsage = session.usage
      const usedTokens = providerUsage?.inputTokens
      const window = options.contextBudget?.maxTokens ?? DEFAULT_CONTEXT_WINDOW
      const reserved = window === undefined
        ? undefined
        : normalizeBudget(window, options.contextBudget?.reservedOutputTokens).reservedOutputTokens
      const target = window === undefined || reserved === undefined
        ? undefined
        : Math.max(1, window - reserved)
      return {
        ...(usedTokens === undefined ? {} : { usedTokens }),
        ...(window === undefined ? {} : { maxTokens: window }),
        ...(reserved === undefined ? {} : { reservedOutputTokens: reserved }),
        ...(target === undefined
          ? {}
          : { triggerTokens: Math.floor(target * 0.85) }),
        ...(usedTokens === undefined || window === undefined || window <= 0
          ? {}
          : { percentUsed: Math.min(100, Math.round((usedTokens / window) * 1000) / 10) }),
        source: usedTokens === undefined ? 'none' as const : 'provider' as const
      }
    }
  }

  return {
    session, workspace, policy, setPermissionMode, permissionStore, checkpoint, denials, warnings,
    toolNames: tools.map((tool) => tool.name),
    contextUsage: contextUsageSurface,
    effort: {
      current: () => reasoningEffort ?? DEFAULT_EFFORT,
      set: (next: ReasoningEffort) => {
        reasoningEffort = next
      },
      choices: effortChoices
    },
    ...(tracing.shutdown ? { shutdownTracing: tracing.shutdown } : {}),
    ...(sessionsSurface ? { sessions: sessionsSurface } : {}),
    ...(contextSurface ? { context: contextSurface } : {}),
    ...(memorySurface ? { memory: memorySurface } : {})
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
