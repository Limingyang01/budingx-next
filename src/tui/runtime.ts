import { randomUUID } from 'node:crypto'
import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { createAskUserQuestionTool } from '../core/questions.js'
import { createWebSearchTool } from '../provider/web-search.js'
import { createWebFetchTool } from '../provider/web-fetch.js'
import { Session, type SessionOptions, type SubmitOptions } from '../core/session.js'
import type { ApprovalGateway, ToolHandler } from '../core/tools.js'
import type { DenialRecord, TurnSnapshot } from '../core/events.js'
import type { PermissionMode } from '../core/permissions.js'
import type { SessionWorktreeBinding } from '../core/transcript.js'
import { createCommandRunner } from '../exec/runner.js'
import { createSandboxPolicy } from '../exec/sandbox-policy.js'
import { createExecTools } from '../exec/tools.js'
import { resolveTaskOutputPath } from '../exec/persist.js'
import { createPlanModeHost } from '../plan/host.js'
import { getWorktreeBranch, verifyWorktreeSessionSync } from '../git/worktree.js'
import { createPlanModeTools, routePlanDraftTools } from '../plan/tools.js'
import { createOpenAiProvider } from '../provider/openai.js'
import { createAnthropicProvider } from '../provider/anthropic.js'
import { createAgentRegistry, type AgentRegistry } from '../core/agent-runtime.js'
import { createAgentTools } from '../core/agent-tools.js'
import { createToolSearch, type ToolSearchController } from '../core/tool-search.js'
import type { AgentDefinition } from '../core/agent-definitions.js'
import type { ModelProvider } from '../core/provider.js'
import { loadAgentDefinitions } from './agents.js'
import { createSubagentTranscript } from '../storage/session-transcript.js'
import { createImageCache, type ImageCache } from '../storage/image-cache.js'
import { loadProjectInstructionsSync } from './project-instructions.js'
import { activateSkill, discoverSkills, findSkill, type SkillEntry } from './skills.js'
import { generatePromptSuggestion } from './suggestion.js'
import { ConfigStore } from '../storage/config-store.js'
import { dataRoot, permissionsPath } from '../storage/paths.js'
import { PermissionsStore, readPermissionMode, savePermissionMode } from '../storage/permissions.js'
import {
  createSessionStore,
  startSession,
  type SessionChangeResult,
  type SessionSearchEntry,
  type SessionWriterLock,
  type SessionStore
} from '../storage/session-store.js'
import {
  createProjectMemory,
  createSessionMemory,
  memoryContextText,
  type MemoryScope
} from '../storage/project-memory.js'
import { estimateTokens, normalizeBudget, triggerTokens } from '../core/context-budget.js'
import { resolveContextWindow } from '../core/context-window.js'
import type { McpServerStatus } from './mcp/types.js'
import type { ConnectedMcp } from './mcp/index.js'
import type { SessionHooks } from '../core/hooks.js'
import type { ReasoningEffort } from '../core/provider.js'
import type { ResolvedConfig } from '../storage/profiles.js'
import {
  createPermissionPolicy,
  type BudingPermissionPolicy,
  type PermissionRule
} from '../workspace/policy.js'
import { createWorkspaceTools, resolveFileReferences, type CheckpointStore } from '../workspace/index.js'
import { createWorkspace, type Workspace } from '../workspace/paths.js'
import type { TasksPanelPort } from './tasks-panel.js'
import type { Tracer } from '../core/observability.js'
import {
  loadTracingEnvironment,
  isValidBaseUrl,
  redactValue,
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
  /** SP006 CMD-08：后台任务快照（来自 exec runner 的后台任务表）。 */
  tasks?: { list: () => import('./tasks.js').TaskRecord[] }
  taskPanel?: TasksPanelPort
  skillCatalog?: {
    list: () => SkillEntry[]
    reload: () => SkillEntry[]
    activate: typeof activateSkill
  }
  worktree?: {
    origin: () => Promise<{ cwd: string; branch: string }>
    enter: (binding: SessionWorktreeBinding) => Promise<void>
    exit: () => Promise<void>
    idle: () => boolean
  }
  /** SP006 §8.2：MCP 服务器连接状态（/mcp 与诊断用）。 */
  mcp?: Pick<ConnectedMcp, 'statuses'> & Partial<Pick<ConnectedMcp, 'start' | 'stop' | 'reconnect' | 'subscribe'>>
  /** SP007 T9：子代理 registry（卡片、ctrl+b 后台化、/tasks Agents 分组、TaskOutput/TaskStop）。 */
  agents?: AgentRegistry
  /** SP007 RD-12：ToolSearch 控制器（门控状态与诊断用）。 */
  toolSearch?: ToolSearchController
  /** SP007 MM-06：图片缓存（[Image #N] 重显 file:// 链接）。 */
  imageCache?: ImageCache
  /** SP005：会话列表与恢复能力；未开启持久化时为 undefined。 */
  sessions?: {
    list: () => { sessionId: string; title: string; updatedAt: string; turns: number }[]
    resume: (sessionId: string) => {
      ok: boolean
      message?: string
      messages?: unknown[]
      needsReview?: { name: string; callId: string; detail?: string }[]
      warnings?: string[]
      /** SP006：恢复后当前生效的会话 id（恢复会切换身份）。 */
      sessionId?: string
    }
    fork?: (sessionId?: string) => SessionChangeResult & { warnings?: string[] }
    rename?: (title: string) => SessionChangeResult
    searchIndex?: () => SessionSearchEntry[]
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
  /**
   * SP006 波次 G：输入框「下一句」建议，依据当前对话由模型生成。
   * 关闭 BUDINGX_PROMPT_SUGGESTIONS=0 时不提供该端口（不产生额外请求）。
   */
  suggestions?: {
    generate: (signal: AbortSignal) => Promise<string | undefined>
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
  /** SP005: explicit context budget override; otherwise resolved per model. */
  contextBudget?: { maxTokens: number; reservedOutputTokens?: number }
  /** SP009 0.9.1 LF-02：显式回合上限（无头 --max-turns）；缺省无上限。 */
  maxIterations?: number
  /** SP005: enable the session transcript (persistence) and project memory. */
  persistence?: boolean
  /** serve owns its writer lock through the host ownership role. */
  sessionWriterOwnedExternally?: boolean
  /** 0.5.2: initial reasoning effort; /effort changes it at runtime. */
  reasoningEffort?: ReasoningEffort
  /** SP006 §8.2：已连接的 MCP 服务器提供的工具与状态。 */
  mcp?: Pick<ConnectedMcp, 'tools'> & NonNullable<AgentRuntime['mcp']>
  /** SP006 §9：hooks 运行器；未提供时不触发任何 hook。 */
  hooks?: SessionHooks
}

/**
 * Build the Session with the SP003 workspace tools and permission policy
 * wired in (SP003 design §3.1). The permission file is read once here;
 * /rules writes it back through permissionStore and re-syncs the policy.
 */
export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  // SP007 PC-01：按档案协议分支选择适配器（OpenAI 兼容 / Anthropic Messages 直连）。
  const provider = (): ModelProvider => {
    const config = options.getConfig()
    const limits = {
      connectTimeoutMs: config.timeoutMs,
      idleStreamTimeoutMs: config.timeoutMs
    }
    if (config.protocol === 'anthropic') {
      return createAnthropicProvider({ baseUrl: config.baseUrl, apiKey: config.apiKey, limits })
    }
    return createOpenAiProvider({ baseUrl: config.baseUrl, apiKey: config.apiKey, limits })
  }
  // 全自动档位允许工作区外目标（用户 2026-11-23 缺陷）：边界判定跟随当前模式。
  let currentPermissionMode: PermissionMode | undefined
  const makeWorkspace = (cwd: string) => createWorkspace(cwd, {
    allowOutside: () => currentPermissionMode === 'full_access'
  })
  const originWorkspace = makeWorkspace(options.cwd)
  let activeWorkspace = originWorkspace
  let activeWorktree: SessionWorktreeBinding | undefined
  let originBranch: string | undefined
  const workspace: Workspace = {
    get root() { return activeWorkspace.root },
    resolve: (path) => activeWorkspace.resolve(path),
    isInside: (path) => activeWorkspace.isInside(path),
    realOf: (path) => activeWorkspace.realOf(path)
  }
  const permissionStore = new PermissionsStore(
    options.home ? permissionsPath(options.home) : undefined
  )
  const load = permissionStore.load()
  const warnings = load.corrupt && load.corruptReason ? [load.corruptReason] : []
  const policy = createPermissionPolicy({
    workspace,
    rules: load.file.rules as PermissionRule[],
    autoAcceptWorkspaceEdits: options.persistPermissionMode,
    managedWorkspaceRoot: () => activeWorktree ? activeWorkspace.root : undefined,
    mode: options.mode ?? (options.persistPermissionMode && !load.corrupt
      ? readPermissionMode(options.home)
      : 'read_only'),
    ...(options.home ? { dataRootOverride: dataRoot(options.home) } : {})
  })
  currentPermissionMode = policy.getMode()
  policy.onModeChanged?.((next) => {
    currentPermissionMode = next
  })
  // Search results honour Read deny rules (SP003 T18i): a file the policy
  // refuses to read must not leak through Glob/Grep listings either.
  const workspaceToolsFor = (target: Workspace) => createWorkspaceTools(target, {
    readDenied: (relativePath) => policy.decide({ tool: 'Read', capability: 'read', path: relativePath }).action === 'deny'
  })
  let workspaceTools = workspaceToolsFor(activeWorkspace)
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
  const runnerFor = (id: string, cwd: string) => createCommandRunner({
    defaultCwd: cwd,
    sandboxPolicy,
    sessionId: id,
    ...(options.home ? { home: options.home } : {})
  })
  let runner = runnerFor(sessionId, workspace.root)
  const runners = new Map([[sessionId, runner]])
  const execTools = createExecTools({
    runner,
    defaultCwd: workspace.root,
    sandboxPolicy
  })
  const tools: ToolHandler[] = [
    ...workspaceTools.tools,
    ...execTools,
    createWebSearchTool(process.env.BUDINGX_TAVILY_API_KEY),
    createWebFetchTool(
      process.env.BUDINGX_WEB_FETCH_ALLOW_PRIVATE === '1' ? { allowPrivateHosts: true } : {}
    ),
    ...(options.mcp?.tools ?? [])
  ]
  let workspaceToolCount = workspaceTools.tools.length + execTools.length
  const denials: DenialRecord[] = []
  // SP005 §5：会话转录与索引。持久化是可选的，未开启时行为与 SP004 一致。
  // 0.5.2：推理强度在运行时可变；会话每次请求读取一次。
  const effortChoices: readonly ReasoningEffort[] = ['low', 'medium', 'high']
  // 未显式设置时不发送该参数：不少兼容端点遇到未知字段会直接 400。
  // 状态栏仍显示默认值，避免“没设置”看起来像功能缺失。
  const DEFAULT_EFFORT: ReasoningEffort = 'medium'
  let reasoningEffort: ReasoningEffort | undefined = options.reasoningEffort
  const persistence = options.persistence ?? false
  let sessionStore: SessionStore | undefined
  let writer: SessionWriterLock | undefined
  let transcript: ReturnType<typeof startSession>['transcript'] | undefined
  if (persistence) {
    sessionStore = createSessionStore({
      workspaceRoot: workspace.root,
      ...(options.home ? { home: options.home } : {})
    })
    try {
      if (!options.sessionWriterOwnedExternally) {
        const claim = sessionStore.acquire(sessionId)
        if (!claim.acquired) throw new Error(`Session ${sessionId} is locked: ${claim.reason}`)
        writer = claim.lock
      }
      transcript = startSession({
        sessionId,
        workspaceRoot: workspace.root,
        ...(options.home ? { home: options.home } : {})
      }).transcript
    } catch (error) {
      writer?.release()
      throw error
    }
  }
  // SP006 §7：每个请求前重读项目指令，文件改动下一回合生效；读取失败只告警不中断。
  const instructionHome = options.home ?? homedir()
  const seenInstructionWarnings = new Set<string>()
  function keepInstructionWarnings(messages: string[]): void {
    for (const message of messages) {
      if (seenInstructionWarnings.has(message)) continue
      seenInstructionWarnings.add(message)
      warnings.push(message)
    }
  }
  let availableSkills: SkillEntry[] | undefined
  function allowProjectFile(path: string): boolean {
    const target = workspace.isInside(path) ? relative(workspace.root, path).replaceAll('\\', '/') : path
    return policy.decide({ tool: 'Read', capability: 'read', path: target }).action === 'allow'
  }
  const skillCatalog = {
    list: () => availableSkills ??= discoverSkills({ homeDir: instructionHome, workspaceDir: workspace.root }),
    reload: () => availableSkills = discoverSkills({ homeDir: instructionHome, workspaceDir: workspace.root }),
    activate: (skill: SkillEntry, invocation: 'manual' | 'model') => activateSkill(skill, invocation, (path) =>
      skill.scope === 'user' || allowProjectFile(path)
    )
  }
  tools.push({
    name: 'Skill',
    summary: 'Activate an available local skill by name for the current turn.',
    parameters: {
      type: 'object', properties: { name: { type: 'string' } },
      required: ['name'], additionalProperties: false
    },
    describe: () => 'Activate a local skill',
    async execute(input, context) {
      const name = (input as { name?: unknown })?.name
      const skill = typeof name === 'string' ? findSkill(skillCatalog.list(), name) : undefined
      if (!skill) throw new Error('Unknown skill')
      const activation = skillCatalog.activate(skill, 'model')
      if (!activation.ok) throw new Error(activation.error)
      if (!context.activateSkill) throw new Error('Skill activation is unavailable')
      context.activateSkill({ name: skill.name, ...activation })
      return `Skill "${skill.name}" activated.`
    }
  })
  // SP007：快照解析器供主会话与子代理 registry 复用（协议/能力一致）。
  const resolveSnapshot = (): TurnSnapshot => {
    const config = options.getConfig()
    const profile = options.configStore.load().models.find((p) => p.id === config.profileId)
    return {
      modelId: config.profileId ?? 'session',
      model: config.model,
      baseUrlHost: new URL(config.baseUrl).host,
      capabilities: {
        tools: profile?.capabilities.tools ?? false,
        // SP007 MM-08：vision 缺省 undefined＝未知（错误驱动降级）；false＝前置拒绝。
        ...(profile?.capabilities.vision !== undefined ? { vision: profile.capabilities.vision } : {})
      }
    }
  }
  const disposers: (() => void)[] = [() => { for (const item of runners.values()) item.dispose?.() }]
  const unsubscribeMcp = options.mcp?.subscribe?.(() => {
    for (let index = tools.length - 1; index >= 0; index--) {
      if (tools[index].name.startsWith('mcp__')) tools.splice(index, 1)
    }
    tools.push(...(options.mcp?.tools ?? []))
  })
  if (unsubscribeMcp) disposers.push(unsubscribeMcp)
  if (sessionStore) disposers.push(() => writer?.release())
  // SP009 0.9.1 LC-03/04：上下文窗口按模型动态解析，交互默认接入预算（自动压缩常开）。
  // 用 getter 让会话/状态栏每次读取都拿到当前模型的最新窗口，切换模型即生效。
  // 优先级：宿主显式预算 > 环境变量 > 档案 contextWindow（含服务端发现值）> 默认。
  const contextBudgetLive = {
    get maxTokens(): number {
      if (options.contextBudget?.maxTokens !== undefined) return options.contextBudget.maxTokens
      const config = options.getConfig()
      const profile = options.configStore.load().models.find((p) => p.id === config.profileId)
      return resolveContextWindow({
        envWindow: Number(process.env.BUDINGX_CONTEXT_WINDOW),
        profileWindow: typeof profile?.contextWindow === 'number' ? profile.contextWindow : undefined
      })
    },
    ...(options.contextBudget?.reservedOutputTokens !== undefined
      ? { reservedOutputTokens: options.contextBudget.reservedOutputTokens }
      : {})
  }
  // SP007 RD-12：ToolSearch 延迟加载门控（MCP 工具恒延迟，核心工具恒加载）。
  const contextWindow = contextBudgetLive.maxTokens
  const toolSearch = createToolSearch({
    tools,
    contextWindow,
    env: process.env,
    mcpPending: options.mcp?.statuses?.some((s) => !s.connected && !s.error) ?? false
  })
  if (toolSearch.tool) tools.push(toolSearch.tool)
  function readInstructions(targetDir?: string) {
    const rules = loadProjectInstructionsSync({
      workspaceDir: workspace.root, homeDir: instructionHome, targetDir,
      allowImport: (path, fromUserConfig) => {
        if (!fromUserConfig) return allowProjectFile(path)
        const parts = relative(dataRoot(instructionHome), path).split(/[\\/]/)
        // User rule documents may import nearby Markdown or text, separate from product state.
        return /\.(?:md|txt)$/i.test(path) && (parts.length === 1 || parts[0] === 'rules')
      }
    })
    keepInstructionWarnings(rules.warnings)
    return rules
  }
  function resolveProjectContext(): string | undefined {
    const instructions = readInstructions()
    const modelSkills = skillCatalog.list()
      .filter((skill) => skill.valid && skill.meta?.disableModelInvocation !== true)
      .slice(0, 100)
      .map((skill) => `- ${skill.name}: ${skill.description.replace(/\s+/g, ' ').slice(0, 240)}`)
    const catalog = modelSkills.length ? 'Available skills (use the Skill tool by name):\n' + modelSkills.join('\n') : ''
    return [instructions.content, catalog].filter(Boolean).join('\n\n') || undefined
  }
  const resolveLocalInstructions: NonNullable<SessionOptions['resolveLocalInstructions']> = (target) => {
    try {
      const resolved = workspace.resolve(target.path)
      const directory = target.kind === 'directory' || resolved.isDirectory ? resolved.real : dirname(resolved.real)
      if (directory === workspace.root || !workspace.isInside(directory)) return undefined
      const rules = readInstructions(directory)
      return rules.scopedContent ? { key: relative(workspace.root, directory), content: rules.scopedContent } : undefined
    } catch {
      return undefined
    }
  }
  const session = new Session({
    id: sessionId,
    resolveReasoningEffort: () => reasoningEffort,
    resolveSystemContext: resolveProjectContext,
    resolveLocalInstructions,
    provider: provider(),
    resolveProvider: provider,
    approval: options.approval,
    tools,
    planMode,
    ...(options.hooks ? { hooks: options.hooks } : {}),
    disposers,
    permissionPolicy: policy,
    ...(toolSearch.enabled ? { toolSearch } : {}),
    ...(tracing.tracer ? { tracer: tracing.tracer } : {}),
    ...(transcript ? { transcript } : {}),
    // SP009 0.9.1 LC-04：始终接入活预算，交互默认启用自动压缩。
    contextBudget: contextBudgetLive,
    ...(options.maxIterations !== undefined ? { maxIterations: options.maxIterations } : {}),
    resolveSnapshot
  })
  // 追问与计划模式工具需要 Session 实例本身，因此在构造后追加（数组引用共享）。
  routePlanDraftTools(tools, session, planMode.draftPath, planMode.draftWorkspace)
  tools.push(createAskUserQuestionTool(session), ...createPlanModeTools(session, planMode.draftPath))
  // SP007 T9：子代理 registry＋Agent/TaskOutput/TaskStop 工具（构造后追加，数组引用共享）。
  const agentLoad = loadAgentDefinitions({ cwd: workspace.root, home: instructionHome })
  for (const line of agentLoad.warnings) warnings.push(line)
  const agentDefinitions: AgentDefinition[] = agentLoad.agents
  const registry = createAgentRegistry({
    parentSession: session,
    tools,
    provider: provider(),
    resolveProvider: provider,
    resolveSnapshot,
    approval: options.approval,
    policy,
    redactDiagnostic: (value) => JSON.parse(redactValue(value, [options.getConfig().apiKey])),
    resolveProjectContext,
    resolveLocalInstructions,
    // 子政策＝min(父,定义)：宿主以父规则快照＋目标档位重建（core 禁 import workspace，D14）。
    createChildPolicy: (mode) =>
      createPermissionPolicy({
        workspace,
        rules: policy.listRules(),
        mode,
        managedWorkspaceRoot: () => activeWorktree ? activeWorkspace.root : undefined,
        ...(options.home ? { dataRootOverride: dataRoot(options.home) } : {})
      }),
    ...(persistence
      ? {
          createTranscript: (agentId: string) =>
            createSubagentTranscript({
              parentSessionId: session.id,
              agentId,
              ...(options.home ? { home: options.home } : {})
            })
        }
      : {}),
    contextBudget: contextBudgetLive
  })
  tools.push(...createAgentTools(registry, agentDefinitions))
  disposers.push(() => registry.dispose())
  let cacheId = session.id
  let activeImageCache = createImageCache({ sessionId: cacheId, home: options.home })
  function currentImageCache(): ImageCache {
    if (cacheId !== session.id) {
      cacheId = session.id
      activeImageCache = createImageCache({ sessionId: cacheId, home: options.home })
    }
    return activeImageCache
  }
  const imageCache: ImageCache = {
    get directory() { return currentImageCache().directory },
    get size() { return currentImageCache().size },
    put: (...args) => currentImageCache().put(...args),
    get: (id) => currentImageCache().get(id),
    nextId: () => currentImageCache().nextId?.() ?? 1
  }
  session.on((event) => {
    if (event.type === 'denial_recorded') denials.push(event.denial)
  })
  function setPermissionMode(mode: PermissionMode): boolean {
    policy.setMode(mode)
    try {
      transcript?.append({ type: 'permission_mode', ts: new Date().toISOString(), mode })
      if (options.persistPermissionMode) savePermissionMode(mode, options.home)
      return true
    } catch {
      return false
    }
  }

  function canSwitchSession(): boolean {
    return !session.isBusy && session.queuedInputs.length === 0 && !session.planMode.active &&
      !registry.list().some((agent) => agent.state === 'running' || agent.state === 'backgrounded') &&
      !runner.list().some((task) => task.outcome === 'running')
  }

  function prepareWorkspace(targetId: string, binding: SessionWorktreeBinding | undefined) {
    const targetWorkspace = binding ? makeWorkspace(verifyWorktreeSessionSync(binding, originWorkspace.root)) : originWorkspace
    const targetRunner = runners.get(targetId) ?? runnerFor(targetId, targetWorkspace.root)
    const targetTools = workspaceToolsFor(targetWorkspace)
    const exec = createExecTools({ runner: targetRunner, defaultCwd: targetWorkspace.root, sandboxPolicy })
    const plan = createPlanModeHost({ sessionId: targetId, workspace: targetWorkspace, home: options.home })
    const replacements = [...targetTools.tools, ...exec]
    routePlanDraftTools(replacements, session, plan.draftPath, plan.draftWorkspace)
    return () => {
      policy.clearRemembered()
      activeWorkspace = targetWorkspace
      activeWorktree = binding
      runner = targetRunner
      runners.set(targetId, targetRunner)
      workspaceTools = targetTools
      availableSkills = undefined
      session.replacePlanModeHost(plan)
      tools.splice(0, workspaceToolCount, ...replacements)
      workspaceToolCount = replacements.length
      for (const planTool of createPlanModeTools(session, plan.draftPath)) {
        const index = tools.findIndex((entry) => entry.name === planTool.name)
        if (index >= 0) tools[index] = planTool
      }
    }
  }

  async function getWorktreeOrigin() {
    originBranch ??= await getWorktreeBranch(originWorkspace.root)
    if (!originBranch) throw new Error('Worktree operations require a named origin branch')
    return { cwd: originWorkspace.root, branch: originBranch }
  }
  async function bindWorktree(binding?: SessionWorktreeBinding): Promise<void> {
    if (!writer || !transcript) throw new Error('An owned saved session is required')
    if (!canSwitchSession()) throw new Error('Wait for the active plan, turn, or task before changing worktrees')
    const origin = await getWorktreeOrigin()
    if (!canSwitchSession()) throw new Error('A plan, turn, or task started during the worktree change')
    if (binding && binding.baseBranch !== origin.branch) throw new Error('The worktree uses a different origin branch')
    const apply = prepareWorkspace(session.id, binding)
    transcript.append({ type: 'worktree_binding', ts: new Date().toISOString(), binding, originBranch: origin.branch })
    apply()
  }

  function resumeSession(target: string): ReturnType<NonNullable<AgentRuntime['sessions']>['resume']> {
    if (!sessionStore) return { ok: false, message: 'Session storage is unavailable' }
    if (!canSwitchSession()) return { ok: false, message: 'Wait for the active plan, turn, or task before switching sessions' }
    const switching = target !== session.id
    if (switching && !writer) return { ok: false, message: 'This host owns a fixed session ID' }
    // A read-only first pass rejects unknown or foreign sessions without creating their directories.
    let restored = sessionStore.restore(target)
    if (restored.status !== 'restored') return { ok: false, message: restored.message ?? restored.status }
    let acquired: SessionWriterLock | undefined
    if (switching) {
      const claim = sessionStore.acquire(target)
      if (!claim.acquired) return { ok: false, message: claim.reason }
      try {
        restored = sessionStore.restore(target)
        if (restored.status !== 'restored' || !restored.transcript) {
          claim.lock.release()
          return { ok: false, message: restored.message ?? restored.status }
        }
      } catch (error) {
        claim.lock.release()
        throw error
      }
      acquired = claim.lock
    }
    try {
      if (switching || restored.worktree || activeWorktree) prepareWorkspace(target, restored.worktree)()
    } catch (error) {
      acquired?.release()
      return { ok: false, message: error instanceof Error ? error.message : 'Cannot restore the saved worktree' }
    }
    originBranch = restored.worktreeOriginBranch
    if (acquired && restored.transcript) {
      const previous = writer
      writer = acquired
      transcript = restored.transcript
      session.adoptIdentity({ id: target, transcript })
      previous?.release()
    }
    session.restorePermissionMode(restored.summary?.permissionMode)
    const messages = restored.messages as unknown as Parameters<typeof session.restoreHistory>[0]
    session.restoreHistory(messages)
    return { ok: true, messages: [...messages], sessionId: session.id, needsReview: restored.needsReview, warnings: restored.warnings }
  }

  const sessionsSurface = sessionStore
    ? {
        list: () =>
          sessionStore!.list().map((entry) => ({
            sessionId: entry.sessionId,
            title: entry.title,
            updatedAt: entry.updatedAt,
            turns: entry.turns
          })),
        resume: resumeSession,
        searchIndex: () => sessionStore!.searchIndex(),
        fork: (target = session.id) => {
          if (!writer || !canSwitchSession()) return { ok: false as const, message: 'Wait for the active session work before branching' }
          const branch = sessionStore!.fork(target, {
            permissionMode: policy.getMode(),
            ...(target === session.id ? { messages: session.history } : {})
          })
          if (!branch.ok) return branch
          const resumed = resumeSession(branch.sessionId)
          if (!resumed.ok) {
            return { ok: false as const, message: `Created branch ${branch.sessionId}, but could not switch: ${resumed.message}` }
          }
          return { ...branch, warnings: resumed.warnings }
        },
        rename: (title: string) => writer
          ? sessionStore!.rename(session.id, title, writer)
          : { ok: false as const, message: 'This host does not own the session writer' },
        // SP009：只读读取某个会话，不切换身份、不写盘（/export 选择会话用）。
        read: (target: string) => {
          const restored = sessionStore!.restore(target)
          if (restored.status !== 'restored')
            return { ok: false, message: restored.message ?? restored.status }
          return {
            ok: true,
            messages: restored.messages,
            title: restored.summary?.title,
            changes: restored.changes
          }
        }
      }
    : undefined
  // SP005 §4：/context 的预算构成（网格视图归 SP006）。
  // SP009 0.9.1 LC-04：预算常开，/context 始终可用，窗口取活预算。
  const contextSurface = {
    budget: () => {
      const history = session.history
      // 与会话循环使用同一个归一化预算与阈值工厂，
      // 避免 /context 展示的预留额与实际行为不一致（SP005 review M3）。
      const shape = normalizeBudget(
        contextBudgetLive.maxTokens,
        contextBudgetLive.reservedOutputTokens
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
                sessionId: session.id,
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
                sessionId: session.id,
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
      // SP009 0.9.1：窗口取活预算（按模型动态解析），阈值与会话循环同源。
      const providerUsage = session.usage
      const usedTokens = providerUsage?.inputTokens
      const window = contextBudgetLive.maxTokens
      const reserved = normalizeBudget(window, contextBudgetLive.reservedOutputTokens).reservedOutputTokens
      return {
        ...(usedTokens === undefined ? {} : { usedTokens }),
        maxTokens: window,
        reservedOutputTokens: reserved,
        triggerTokens: triggerTokens({ messages: [], maxTokens: window, reservedOutputTokens: reserved }),
        ...(usedTokens === undefined || window <= 0
          ? {}
          : { percentUsed: Math.min(100, Math.round((usedTokens / window) * 1000) / 10) }),
        source: usedTokens === undefined ? 'none' as const : 'provider' as const
      }
    }
  }

  // SP006 波次 G：输入框下一句建议。只在用户空闲时按需生成，失败静默。
  const suggestionsSurface = process.env.BUDINGX_PROMPT_SUGGESTIONS === '0'
    ? undefined
    : {
        generate: async (signal: AbortSignal): Promise<string | undefined> => {
          if (session.isBusy) return undefined
          const config = options.getConfig()
          return generatePromptSuggestion({
            provider: provider(),
            model: config.model,
            history: session.history,
            signal
          })
        }
      }

  const taskPanel: TasksPanelPort = {
    list: () => [
      ...runner.list().flatMap((result) => result.taskId ? [{
        kind: 'shell' as const, id: result.taskId,
        title: result.command ?? result.taskId,
        status: result.outcome,
        exitCode: result.exitCode,
        exitReason: result.reason
      }] : []),
      ...registry.list().filter((agent) => agent.parentSessionId === session.id).map((agent) => ({
        kind: 'agent' as const, id: agent.agentId, title: agent.description,
        status: agent.state, exitReason: agent.error
      }))
    ],
    stop(row) {
      if (row.kind === 'shell') {
        const task = runner.status(row.id)
        if (!task) return { result: 'unavailable' }
        return { result: runner.cancel(row.id) ? 'requested' : 'already-finished' }
      }
      const agent = registry.get(row.id)
      if (agent?.parentSessionId !== session.id) return { result: 'unavailable' }
      return { result: registry.stop(row.id).ok ? 'requested' : 'already-finished' }
    },
    readLog(row) {
      const cap = 32 * 1024
      function preview(text: string) {
        const bytes = Buffer.from(text)
        return { text: bytes.subarray(Math.max(0, bytes.length - cap)).toString(), truncated: bytes.length > cap }
      }
      let logPath: string | undefined
      let fallback: string | undefined
      if (row.kind === 'shell') {
        const task = runner.status(row.id)
        if (!task) return { reason: 'unavailable' }
        const expected = resolveTaskOutputPath(session.id, row.id, options.home)
        if (task.persistedOutputPath === expected) logPath = expected
        fallback = task.output
      } else {
        const agent = registry.get(row.id)
        if (agent?.parentSessionId !== session.id) return { reason: 'unavailable' }
        fallback = agent.result ?? agent.error
      }
      if (logPath) {
        try {
          const canonical = realpathSync(logPath)
          const privateRoot = realpathSync(dataRoot(options.home))
          if (relative(join(privateRoot, 'sessions', session.id, 'tasks', basename(logPath)), canonical) !== '') {
            return { reason: 'unavailable' }
          }
          const descriptor = openSync(canonical, 'r')
          try {
            const info = fstatSync(descriptor)
            if (!info.isFile()) return { reason: 'unavailable' }
            const buffer = Buffer.alloc(Math.min(cap, info.size))
            const length = readSync(descriptor, buffer, 0, buffer.length, info.size - buffer.length)
            return { text: buffer.toString('utf8', 0, length), truncated: info.size > cap }
          } finally {
            closeSync(descriptor)
          }
        } catch {
          return fallback ? preview(fallback) : { reason: 'unavailable' }
        }
      }
      return fallback ? preview(fallback) : { reason: 'no-log' }
    }
  }

  return {
    session, workspace, policy, setPermissionMode, permissionStore, denials, warnings, taskPanel, skillCatalog,
    get checkpoint() { return workspaceTools.checkpoint },
    worktree: { origin: getWorktreeOrigin, enter: bindWorktree, exit: () => bindWorktree(), idle: canSwitchSession },
    get toolNames() { return tools.map((tool) => tool.name) },
    tasks: {
      list: () =>
        runner.list().map((result) => ({
          id: result.taskId ?? 'task',
          title: result.command ?? result.taskId ?? 'task',
          status:
            result.outcome === 'completed'
              ? 'completed'
              : result.outcome === 'running'
                ? 'running'
                : result.outcome === 'cancelled'
                  ? 'cancelled'
                  : 'failed',
          ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
          ...(result.persistedOutputPath ? { outputPath: result.persistedOutputPath } : {}),
          startedAt: result.startedAt ?? Date.now(),
          ...(result.outcome === 'running' ? {} : { endedAt: (result.startedAt ?? Date.now()) + result.durationMs })
        }))
    },
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
    ...(memorySurface ? { memory: memorySurface } : {}),
    ...(suggestionsSurface ? { suggestions: suggestionsSurface } : {}),
    ...(options.mcp ? { mcp: options.mcp } : {}),
    agents: registry,
    toolSearch,
    imageCache
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
        capabilities: {
          tools: profile?.capabilities.tools ?? false,
          // SP007 MM-08：vision 缺省 undefined＝未知（错误驱动降级）；false＝前置拒绝。
          ...(profile?.capabilities.vision !== undefined ? { vision: profile.capabilities.vision } : {})
        }
      }
    }
  })
}
