// Session, turn and event engine (SP002 design §3.2/§3.3, AC SL-01 … SL-08).
// Core owns the behaviour; hosts only subscribe to events.
import { randomUUID } from 'node:crypto'
import {
  CANCEL_BUDGET_MS,
  ERROR_CODES,
  MAX_COMPLETION_CLAIM_REJECTIONS,
  MAX_REPEATED_TOOL_FAILURES,
  MAX_TOOL_FAILURE_STREAK,
  QUEUE_AUTOSTART_MS,
  TOOL_OUTPUT_CAP
} from './constants.js'
import type {
  ErrorInfo,
  Message,
  MessageBlock,
  SessionEvent,
  SessionState,
  TurnOutcome,
  TurnSnapshot,
  Usage
} from './events.js'
import { normalizeForApi } from './normalize.js'
import { isImageUnsupportedError } from './image-errors.js'
import {
  COMPACTION_CIRCUIT_LIMIT,
  collectConstraintItems,
  createContextBudgetManager,
  normalizeBudget,
  triggerTokens,
  unfinishedToolCalls,
  type CompactionResult,
  type ContextBudgetManager,
  type PreservedItem
} from './context-budget.js'
import {
  buildSummaryPrompt,
  extractSummary,
  renderMessagesForSummary
} from './compact-summary.js'
import type { HookRunResult, SessionHookEvent, SessionHooks } from './hooks.js'
import type { SessionTranscript, TranscriptRecord } from './transcript.js'
import { appendTranscript } from './session-persistence.js'
import type {
  ChatRequest,
  FinishReason,
  ModelProvider,
  ReasoningEffort,
  ToolFragment
} from './provider.js'
import { assembleToolCalls, parseToolArguments } from './tool-calls.js'
import type { ToolSearchController } from './tool-search.js'
import { sliceToolOutput } from './tools.js'
import type {
  ApprovalDecision,
  ApprovalGateway,
  ApprovalRequest,
  PreparedTool,
  ToolContext,
  ToolHandler
} from './tools.js'
import type { CommandResult } from './exec.js'
import type { CodingTaskTracker } from './coding.js'
import type { TraceHandle, Tracer } from './observability.js'
import type {
  PermissionMode,
  PermissionPolicy,
  PermissionRequest
} from './permissions.js'
import type {
  PendingQuestion,
  Plan,
  PlanDriftItem,
  PlanModeExitResult,
  PlanModeHost,
  PlanModePhase,
  PlanModeSnapshot,
  Question,
  QuestionAnswers,
  QuestionAnnotations
} from './plan.js'

export type SessionOptions = {
  provider: ModelProvider
  resolveProvider?: () => ModelProvider
  approval: ApprovalGateway
  resolveSnapshot: () => TurnSnapshot
  tools?: ToolHandler[]
  /**
   * SP004 §4.4/§6.1：会话标识，用于后台输出目录与会话计划文件的隔离。
   * 宿主未提供时自动生成，保证同一进程内不同会话不互相覆盖。
   */
  id?: string
  /** SP003: when present, tool calls are decided by the policy. */
  permissionPolicy?: PermissionPolicy
  /** SP004 §6.2: host integration for plan mode (research/pending/approve). */
  planMode?: PlanModeHost
  /**
   * SP004 §5.2: coding-task goal state machine. When present, command results
   * become completion evidence and unsupported "done" claims are rejected (CT-07).
   */
  codingTask?: CodingTaskTracker
  maxIterations?: number
  cancelBudgetMs?: number
  queueAutostartMs?: number
  /** Host resources to release on dispose, e.g. the foreground/background command runner (SP004 §4.4). */
  disposers?: (() => void)[]
  /** SP004 agent-observability §4.2：可选追踪端口。未注入时跳过埋点。 */
  tracer?: Tracer
  /**
   * SP005 §5：会话转录端口。未注入时不落盘；注入后每条消息、回合与工具步骤
   * 都会追加到转录，跨进程恢复只读取，不重放任何副作用。
   */
  transcript?: SessionTranscript
  /**
   * SP005 §4：上下文预算上限（模型上下文窗口的 token 数）。
   * 未注入时不压缩，保持 SP002 起的既有行为。
   */
  contextBudget?: {
    maxTokens: number
    /** 为模型输出预留的 token 数，默认按 1/4 上限估算。 */
    reservedOutputTokens?: number
  }
  /**
   * SP005 §5 SR-10：恢复会话时的权限上限。恢复不会提升权限档位，
   * 目标档位高于上限时被降到上限并发出 notice。
   */
  permissionModeCeiling?: PermissionMode
  /**
   * SP005 §4：读取当前已批准计划文本，压缩时作为保留项。
   */
  resolvePlanText?: () => string | undefined
  /**
   * 0.5.2：当前推理强度。每次请求读取一次，`/effort` 修改后立即生效。
   */
  resolveReasoningEffort?: () => ReasoningEffort | undefined
  /**
   * SP006 §7.2：每个模型请求前读取的附加系统上下文（项目指令等）。
   * 每次请求重新读取，因此文件改动在下一回合生效。
   */
  resolveSystemContext?: () => string | undefined
  resolveLocalInstructions?: (target: { path: string; kind?: string }) => { key: string; content: string } | undefined
  /** SP006 §9：hooks 宿主端口；未注入时所有 hook 事件为空操作。 */
  hooks?: SessionHooks
  /** SP007 §4.2：ToolSearch 延迟加载控制器；未注入时全部工具恒加载（既有行为）。 */
  toolSearch?: ToolSearchController
  onEvent?: (event: SessionEvent) => void
}

export type SubmitOptions = {
  /** File references brought in with @ (SP003 AC FC-04). */
  context?: { source: string; content: string }[]
  /** Resolve at the model boundary so queued prompts see current files and rules. */
  resolveContext?: () => {
    context: NonNullable<SubmitOptions['context']>
    notices: string[]
  }
  /** SP007 MM-07：随本条用户消息附带的图片（base64），按能力传递或降级。 */
  images?: { id: number; mediaType: string; data: string; width?: number; height?: number }[]
  allowedSkillTools?: readonly string[]
  preserveWhitespace?: boolean
}

type QueuedInput = { id: string; text: string; options?: SubmitOptions; notification?: boolean; notice?: string }

type ActiveTurn = {
  provider: ModelProvider
  /** SP007 RD-16：本回合快照，转录按模型归属消息。 */
  snapshot?: TurnSnapshot
  id: string
  controller: AbortController
  finalized: boolean
  userText: string
  messageIds: string[]
  allowedSkillTools?: Set<string>
  skillContexts?: NonNullable<SubmitOptions['context']>
  localRuleScopes?: Map<string, string>
  assistant?: Message
  cancelTimer?: NodeJS.Timeout
  /** SP004 agent-observability：本回合根观测句柄。 */
  traceRoot?: TraceHandle
}

/** SP007 SA-05：并行派发组内缓冲的工具结果，按调用原序回灌。 */
type DispatchResult = {
  content: string
  isError: boolean
  code?: string
  trace?: TraceHandle
}

/** SP007 RD-04：/status Usage 页的本地性能聚合形状。 */
export type SessionPerformance = {
  requests: number
  requestMs: { p50: number; p95: number; last: number }
  firstTokenMs?: { p50: number; p95: number; last: number }
  inputTokens: number
  outputTokens: number
  elapsedMs: number
  memoryRssBytes: number
}

/** SP007 §4.1：注册表可发布的代理生命周期事件。 */
export type AgentSessionEvent = Extract<
  SessionEvent,
  { type: 'agent_started' | 'agent_progress' | 'agent_finished' }
>

/** 最近秩百分位（sorted 升序非空）：p50/p95 取 ceil 秩，避免插值造出不存在的样本。 */
function percentileOf(sorted: number[], percentile: number): number {
  const rank = Math.max(1, Math.ceil((percentile / 100) * sorted.length))
  return sorted[Math.min(rank, sorted.length) - 1]!
}

const ALLOWED_TRANSITIONS: Record<SessionState, SessionState[]> = {
  idle: ['requesting', 'cancelling'],
  requesting: ['streaming', 'tool_running', 'awaiting_approval', 'cancelling', 'idle'],
  streaming: ['tool_running', 'awaiting_approval', 'requesting', 'cancelling', 'idle'],
  tool_running: ['requesting', 'awaiting_approval', 'cancelling', 'idle'],
  awaiting_approval: ['tool_running', 'requesting', 'cancelling', 'idle'],
  cancelling: ['idle']
}

/**
 * SP006 波次 F：把流式增量并进同一个内容块。
 *
 * 一条助手消息只保留一个 text 块（thinking 同理）。协议按片段推送增量，
 * 若每个增量各建一个块，落盘转录会碎成上百段短块：恢复会话时每段各自
 * 成行、塌成一列窄字，模型上下文也要拼接上百次。参考实现一条助手消息
 * 只有一个文本块，本仓对齐该数据模型。
 */
function appendStreamBlock(
  blocks: MessageBlock[],
  kind: 'text' | 'thinking',
  text: string
): void {
  const last = blocks.at(-1)
  if (kind === 'text') {
    if (last && last.type === 'text') {
      last.text += text
      return
    }
    blocks.push({ type: 'text', text })
    return
  }
  if (last && last.type === 'thinking') {
    last.text += text
    return
  }
  blocks.push({ type: 'thinking', text })
}

function previewOf(text: string): string {
  const firstLine = text.split('\n')[0]
  return firstLine.length > 40 ? firstLine.slice(0, 39) + '…' : firstLine
}

function describeDrift(drift: PlanDriftItem[]): string {
  return drift.map((item) => `${item.item}（期望 ${item.expected}，实际 ${item.actual}）`).join('；')
}

type QuestionOutcome =
  | { status: 'answered'; answers: QuestionAnswers; annotations?: QuestionAnnotations }
  | { status: 'cancelled' }

/** 追问结果文本：按题目文本关联答案，并保留用户备注（design §6.4）。 */
function formatQuestionResult(
  questions: Question[],
  answers: QuestionAnswers,
  annotations?: QuestionAnnotations
): string {
  const lines = ['用户已回答以下问题：']
  for (const question of questions) {
    lines.push(`${question.question} ${answers[question.question] ?? ''}`.trim())
    const annotation = annotations?.[question.question]
    if (annotation?.notes?.trim()) lines.push(`  备注：${annotation.notes.trim()}`)
  }
  return lines.join('\n')
}

/** 稳定序列化：忽略对象键序与空白，用于工具调用签名。 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    )
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export class Session {
  /**
   * 会话标识（SP004 §4.4 后台输出与 §6.1 计划文件的隔离键）。
   * SP006：/resume 之后可以切换到被恢复会话，因此不是只读常量。
   */
  private currentId: string
  private state: SessionState = 'idle'
  private readonly messages: Message[] = []
  private readonly reasoningSource = new WeakMap<Message, TurnSnapshot>()
  private readonly listeners = new Set<(event: SessionEvent) => void>()
  private readonly toolPreviewListeners = new Set<(names: readonly string[]) => void>()
  private readonly tools: ToolHandler[]
  private readonly queue: QueuedInput[] = []
  private activeTurn?: ActiveTurn
  private approvalForMemory?: { id: string; target: PermissionRequest }
  private lastToolElapsed?: { turnId: string; callId: string; ms: number }
  private pendingApproval?: { requestId: string; resolve: (d: ApprovalDecision) => void }
  /**
   * 计划审批可能由宿主 UI 在回合之外发起（ExitPlanMode 工具之外的手动入口），
   * 因此与单次工具批准分开记录：回合结束不得取消会话级计划审批。
   */
  private pendingPlanDecision?: { requestId: string; resolve: (d: ApprovalDecision) => void }
  private queueTimer?: NodeJS.Timeout
  private queuePaused = false
  /** 计划模式单一状态（SP004 §6.2）：调研/待批与原权限档位。 */
  private planModeState?: {
    phase: PlanModePhase
    approving?: boolean
    originalMode: PermissionMode
    baseline: PlanModeSnapshot
  }
  /** 已批准计划是否已在首次副作用前重查（§6.3）。 */
  private approvedPlanCheck?: { planId: string; rechecked: boolean }
  /** 追问挂起（§6.4）：复用 awaiting_approval 状态，配 question_* 事件。 */
  private pendingQuestionState?: {
    question: PendingQuestion
    resolve: (outcome: QuestionOutcome) => void
  }
  /** SP005 §4：上下文预算管理器。未注入预算时为 undefined（不压缩）。 */
  private readonly budget?: ContextBudgetManager
  /** SP005 §4：压缩熔断计数，连续失败达到上限后停止压缩并明确报错。 */
  private compactionFailures = 0
  /** SP005 §5：本回合已派发但结果未知的工具调用（不自动重放）。 */
  private readonly pendingToolCalls = new Map<string, { turnId: string; name: string }>()
  /** SP005 FR-07：本轮转录写入失败的位置，随 turn_finalized 一起报出。 */
  private persistenceError?: { code: string; message: string }
  /**
   * Token usage reported by the provider for the most recent request.
   * It is the only authoritative context figure we have: the local
   * estimator is a heuristic. Exposed so the UI can show how much of the
   * context window is in use (0.5.2 context usage display).
   */
  private lastUsage?: Usage
  // 0.5.4 /cost：会话累计用量（跨回合），清空会话时重置。
  private totalUsage = { inputTokens: 0, outputTokens: 0, requests: 0 }
  // SP007 RD-04：请求计时样本（首 token / 完整请求），上限 500 条逐旧淘汰。
  private readonly perfSamples: { requestMs: number; firstTokenMs?: number }[] = []
  // 0.5.4 /rewind：回合顺序日志，用于把文件撤销对齐到对话检查点。
  private turnLog: { turnId: string }[] = []
  private readonly startedAt = Date.now()
  /**
   * SP005 FR-05：同一工具 + 同一参数的连续失败计数。
   * 达到上限后熔断，避免模型在同一个失败调用上空转。
   */
  private readonly repeatedToolFailures = new Map<string, number>()
  /** SP005 FR-05：同一工具 + 同一错误码的连续失败计数（捕捉换参数瞎试）。 */
  private readonly toolFailureStreaks = new Map<string, { code: string | undefined; count: number }>()
  /** SP006 §9：hook 注入的附加上下文，只作用于下一次请求。 */
  private readonly hookContext: string[] = []
  private sessionStartHooked = false

  /** Hosts pause auto-start while boundary commands or credential entry run. */
  setQueuePaused(paused: boolean): void {
    this.queuePaused = paused
    if (paused && this.queueTimer) {
      clearTimeout(this.queueTimer)
      this.queueTimer = undefined
    }
    if (!paused && !this.isBusy) this.scheduleQueueDrain()
  }

  constructor(private readonly options: SessionOptions) {
    this.currentId = options.id ?? randomUUID()
    this.tools = options.tools ?? []
    if (options.contextBudget) {
      this.budget = createContextBudgetManager()
    }
    this.options.permissionPolicy?.onModeChanged?.((mode: PermissionMode) => {
      this.emit({ type: 'permission_changed', mode })
    })
  }

  /**
   * SP005 §5：把恢复出来的历史装入会话（跨进程恢复入口）。
   * 只装载历史，绝不重放任何工具步骤。
   *
   * SP006 回归修复：同时发出 conversation_restored，让宿主把同一段历史
   * 渲染进可见转录。此前历史只进模型上下文，用户看到的是一片空白。
   */
  restoreHistory(messages: readonly Message[]): void {
    this.messages.splice(0, this.messages.length, ...messages)
    this.emit({ type: 'conversation_restored', messages: [...messages] })
  }

  /** 会话标识（可被 /resume 切换，见 adoptIdentity）。 */
  get id(): string {
    return this.currentId
  }

  /**
   * SP006：/resume 之后切换会话身份，让后续回合继续写入被恢复会话的转录。
   * 对齐参考实现的 switchSession：会话 id 与转录端口一起换，
   * 被恢复会话的转录因此保持完整（原历史 + 续写）。
   * 只换身份，绝不重放任何工具步骤。
   */
  adoptIdentity(next: { id: string; transcript?: SessionTranscript }): void {
    this.currentId = next.id
    if (next.transcript) this.options.transcript = next.transcript
  }

  replacePlanModeHost(host: PlanModeHost): void {
    if (this.isBusy || this.planMode.active) throw new Error('A plan or turn is active')
    this.options.planMode = host
    this.approvedPlanCheck = undefined
  }

  /** 0.5.4 /rewind：对话检查点（用户消息）列表，供选择面板使用。 */
  get rewindCheckpoints(): { id: string; text: string; index: number }[] {
    const out: { id: string; text: string; index: number }[] = []
    this.messages.forEach((message, index) => {
      if (message.role !== 'user') return
      const text = message.blocks.map((block) => (block as { text?: string }).text ?? '').join(' ').trim()
      if (text) out.push({ id: message.id, text, index })
    })
    return out
  }

  /**
   * 0.5.4 /rewind：把对话回滚到指定用户消息之前（不含该消息），
   * 返回需撤销文件的回合数。只回滚转录与内存历史，不回滚外部副作用（D4）。
   */
  rewindTo(messageId: string): { ok: boolean; removedTurns: number; removedMessages: number } {
    const index = this.messages.findIndex((message) => message.id === messageId)
    if (index < 0) return { ok: false, removedTurns: 0, removedMessages: 0 }
    const kept = this.messages.slice(0, index)
    const removedMessages = this.messages.length - kept.length
    this.messages.splice(0, this.messages.length, ...kept)
    const entries = kept
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({
        kind: message.role as 'user' | 'assistant',
        text: message.blocks.map((block) => (block as { text?: string }).text ?? '').join('')
      }))
      .filter((entry) => entry.text.trim().length > 0)
    this.emit({ type: 'conversation_rewound', entries, removedCount: removedMessages })
    const userIndex = kept.filter((message) => message.role === 'user').length
    const removedTurns = Math.max(0, this.turnLog.length - userIndex)
    this.turnLog.splice(userIndex)
    return { ok: true, removedTurns, removedMessages }
  }

  /**
   * 0.5.4 /compact：手动压缩（忽略触发阈值），可附自定义摘要指令。
   * 空闲时用模型摘要已结束的历史，指令作为压缩后的保留约束。
   */
  async compactNow(instruction?: string): Promise<{ ok: boolean; before: number; after: number; message?: string }> {
    const budget = this.budget
    if (!budget) return { ok: false, before: 0, after: 0, message: '上下文预算未接入' }
    const shape = normalizeBudget(
      this.options.contextBudget?.maxTokens ?? 0,
      this.options.contextBudget?.reservedOutputTokens
    )
    const messages = [...this.messages]
    const before = budget.estimate({ messages, ...shape })
    if (this.isBusy) return { ok: false, before, after: before, message: '请等待当前回合结束后再压缩' }
    if (messages.length === 0) return { ok: false, before, after: before, message: '没有可压缩的历史' }
    const preserved = this.preservedItems()
    if (instruction && instruction.trim()) {
      preserved.push({ kind: 'constraint', id: 'compact-instruction', text: instruction.trim(), reason: '用户自定义压缩指令' })
    }
    const snapshot = shape.maxTokens > 0 ? this.options.resolveSnapshot?.() : undefined
    const input = { messages, ...shape, force: true, includeCompletedHistory: snapshot !== undefined }
    const probe = budget.compact(input, preserved)
    if (!probe.compacted || !probe.replacedRange) {
      return { ok: false, before, after: before, message: '没有可压缩的历史' }
    }

    const turnId = `manual-${Date.now()}`
    let result = probe
    if (snapshot) {
      const summaryText = await this.generateCompactionSummary({
        provider: this.options.resolveProvider?.() ?? this.options.provider,
        model: snapshot.model,
        dropped: messages.slice(probe.replacedRange.from, probe.replacedRange.to + 1),
        signal: new AbortController().signal,
        instruction,
        turnId
      })
      if (!summaryText) return { ok: false, before, after: before, message: '未能生成完整的历史摘要' }
      if (this.isBusy || this.messages.length !== messages.length ||
          this.messages.some((message, index) => message !== messages[index])) {
        return { ok: false, before, after: before, message: '会话在压缩期间已变化，请重试' }
      }
      result = budget.compact({ ...input, summaryText }, preserved)
      if (!result.withinBudget) {
        return { ok: false, before, after: before, message: '摘要超出上下文预算' }
      }
    }
    this.applyCompaction(turnId, result, before)
    return { ok: true, before, after: result.estimatedTokens }
  }

  /**
   * SP005 §5 SR-10：恢复时的权限上限。目标档位高于上限则降到上限，
   * 绝不因恢复而提升权限。
   */
  applyPermissionCeiling(mode: PermissionMode): PermissionMode {
    const ceiling = this.options.permissionModeCeiling
    if (!ceiling) return mode
    const rank: Record<PermissionMode, number> = { read_only: 0, workspace_edit: 1, full_access: 2 }
    if (rank[mode] <= rank[ceiling]) return mode
    this.options.permissionPolicy?.setMode?.(ceiling)
    this.emit({ type: 'permission_changed', mode: ceiling })
    return ceiling
  }

  /**
   * 恢复会话时应用其记录下来的权限模式（SR-10）：沿用原模式，但绝不升权。
   * 旧会话没有记录模式时保持当前模式不变。
   */
  restorePermissionMode(recorded: PermissionMode | undefined): PermissionMode | undefined {
    if (!recorded) return undefined
    const rank: Record<PermissionMode, number> = { read_only: 0, workspace_edit: 1, full_access: 2 }
    const current = this.options.permissionPolicy?.getMode?.()
    const target = current && rank[current] < rank[recorded] ? current : recorded
    if (target !== current) {
      this.options.permissionPolicy?.setMode?.(target)
      this.emit({ type: 'permission_changed', mode: target })
    }
    return target
  }

  /** UI-only query. No approval payload or session event shape changes. */
  canRememberApproval(requestId: string): boolean {
    const record = this.approvalForMemory
    const policy = this.options.permissionPolicy
    return !!record && record.id === requestId && !!policy &&
      (policy.canRemember?.(record.target) ?? true)
  }

  toolElapsedMs(turnId: string, callId: string): number | undefined {
    const elapsed = this.lastToolElapsed
    return elapsed?.turnId === turnId && elapsed.callId === callId ? elapsed.ms : undefined
  }

  get currentState(): SessionState {
    return this.state
  }

  /** Provider-reported usage of the last request, when it sent one. */
  get usage(): Usage | undefined {
    return this.lastUsage
  }

  /** 0.5.4 /cost：累计 token 与会话时长。 */
  get usageTotals(): { inputTokens: number; outputTokens: number; requests: number; elapsedMs: number } {
    return { ...this.totalUsage, elapsedMs: Date.now() - this.startedAt }
  }

  /**
   * SP007 RD-04：本地性能采样（/status Usage 页）。只存聚合所需的最小样本，
   * 不记录提示词内容；默认不上传（隐私边界见 design §4.2）。
   */
  get performance(): SessionPerformance {
    const requestSorted = this.perfSamples.map((sample) => sample.requestMs).sort((a, b) => a - b)
    const firstSorted = this.perfSamples
      .map((sample) => sample.firstTokenMs)
      .filter((value): value is number => value !== undefined)
      .sort((a, b) => a - b)
    const stats = (sorted: number[]) => sorted.length === 0 ? undefined : {
      p50: percentileOf(sorted, 50),
      p95: percentileOf(sorted, 95),
      last: sorted[sorted.length - 1]!
    }
    return {
      requests: this.totalUsage.requests,
      requestMs: stats(requestSorted) ?? { p50: 0, p95: 0, last: 0 },
      ...(firstSorted.length > 0 ? { firstTokenMs: stats(firstSorted)! } : {}),
      inputTokens: this.totalUsage.inputTokens,
      outputTokens: this.totalUsage.outputTokens,
      elapsedMs: Date.now() - this.startedAt,
      memoryRssBytes: process.memoryUsage.rss()
    }
  }

  /**
   * SP007 §4.1：子代理终态通知入队。复用既有 queue/drain 机制：
   * 空闲时自动开启回合，回合内按 intra_turn 注入；notification 标记
   * 让宿主把它渲染成系统消息而不是用户输入。
   */
  enqueueNotification(text: string, notice?: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    const item: QueuedInput = { id: randomUUID(), text: trimmed, notification: true, ...(notice ? { notice } : {}) }
    this.queue.push(item)
    // SP009 0.9.1：队列预览用简洁通知文本，不把原始 XML 首行展示给用户。
    this.emit({ type: 'input_queued', queueId: item.id, preview: notice ?? previewOf(trimmed), notification: true })
    if (notice) this.emit({ type: 'notice', level: 'info', code: 'agent_notification', text: notice })
    this.scheduleQueueDrain()
  }

  /** SP007 §4.1：子代理注册表向父会话发布 agent_* 生命周期事件。 */
  publishAgentEvent(event: AgentSessionEvent): void {
    this.emit(event)
  }

  get history(): readonly Message[] {
    return this.messages
  }

  get queuedInputs(): readonly QueuedInput[] {
    return this.queue
  }

  get isBusy(): boolean {
    return this.state !== 'idle'
  }

  /** 计划模式 UI-only 查询：active/phase/originalMode（SP004 §6.2）。 */
  get planMode(): { active: boolean; phase?: PlanModePhase; originalMode?: PermissionMode } {
    const state = this.planModeState
    if (!state) return { active: false }
    return { active: true, phase: state.phase, originalMode: state.originalMode }
  }

  get canReadPlanDraft(): boolean {
    return this.planModeState !== undefined || this.approvedPlanCheck !== undefined
  }

  /**
   * 普通模式进入计划模式：记录原权限档位与研究基线，切换到工作区档位。
   * 底层硬拒绝仍然优先；调研期非只读工具要一次性批准（§6.2）。
   */
  enterPlanMode(): { ok: boolean; reason?: string } {
    const host = this.options.planMode
    const policy = this.options.permissionPolicy
    if (!host) return { ok: false, reason: '宿主未提供计划模式集成' }
    if (!policy) return { ok: false, reason: '没有权限策略，无法进入计划模式' }
    if (this.planModeState) return { ok: false, reason: '已经处于计划模式' }
    const originalMode = policy.getMode()
    this.planModeState = { phase: 'research', originalMode, baseline: host.snapshot() }
    this.approvedPlanCheck = undefined
    policy.setMode('workspace_edit')
    this.emit({ type: 'plan_mode_changed', active: true, phase: 'research', originalMode })
    return { ok: true }
  }

  /**
   * 用户在调研期显式退出：恢复原权限档位，丢弃待批请求（§6.2）。
   */
  leavePlanMode(): { ok: boolean; reason?: string } {
    const state = this.planModeState
    if (!state) return { ok: false, reason: '当前不在计划模式' }
    if (this.pendingApproval) {
      this.pendingApproval.resolve({ outcome: 'cancelled', via: 'user' })
      this.pendingApproval = undefined
    }
    if (this.pendingPlanDecision) {
      this.pendingPlanDecision.resolve({ outcome: 'cancelled', via: 'user' })
      this.pendingPlanDecision = undefined
    }
    try {
      const host = this.options.planMode
      const plan = host?.store.current()
      if (host && plan && plan.approval === 'pending') host.store.reject('用户退出计划模式')
    } catch {
      // Rejecting an already-consumed plan must not block leaving plan mode.
    }
    this.options.permissionPolicy?.setMode(state.originalMode)
    this.planModeState = undefined
    this.approvedPlanCheck = undefined
    this.emit({ type: 'plan_mode_changed', active: false, originalMode: state.originalMode })
    return { ok: true }
  }

  /**
   * 退出计划模式并提交计划审批（§6.2/§6.3）：读取会话计划文件、
   * 校验研究基线未漂移，再经 ApprovalGateway 取得批准或拒绝。
   */
  async exitPlanMode(context: {
    turnId?: string
    callId?: string
    permissionIntents?: readonly string[]
  } = {}): Promise<PlanModeExitResult> {
    const host = this.options.planMode
    const policy = this.options.permissionPolicy
    const state = this.planModeState
    if (!host || !policy) return { ok: false, message: '宿主未提供计划模式集成，无法退出计划模式' }
    if (!state) return { ok: false, message: '当前不在计划模式' }
    if (state.approving) return { ok: false, message: '计划审批仍在等待处理，请先批准或拒绝' }
    state.approving = true
    try {
      return await this.approvePlanMode(host, policy, state, context)
    } finally {
      state.approving = false
    }
  }

  private async approvePlanMode(
    host: PlanModeHost,
    policy: PermissionPolicy,
    state: NonNullable<Session['planModeState']>,
    context: { turnId?: string; callId?: string; permissionIntents?: readonly string[] }
  ): Promise<PlanModeExitResult> {
    const draft = host.readDraft?.()
    const text = (draft ?? await host.readPlanText().catch(() => undefined))?.trim()
    if (this.planModeState !== state) return { ok: false, message: '计划模式已结束', cancelled: true }
    if (!text) return { ok: false, message: '会话计划文件缺失或为空：请先写入计划再退出计划模式' }
    const approvalSnapshot = host.snapshot()
    const drift = host.diff(state.baseline, approvalSnapshot)
    if (drift.length > 0) {
      return {
        ok: false,
        message: `工作区在研究期间发生漂移，计划未获批准：${describeDrift(drift)}`,
        drift
      }
    }
    let plan = host.store.current()
    const goal = draft === undefined ? undefined : text.split('\n', 1)[0].replace(/^#+\s+/, '').trim()
    if (goal !== undefined && (!plan || plan.approval === 'approved')) {
      plan = host.store.create(goal || '实施计划', [{ title: '实施获批的会话计划' }])
    }
    if (!plan) return { ok: false, message: '当前没有计划：请先写入会话计划文件' }
    if (plan.approval === 'none' || plan.approval === 'rejected') host.store.requestApproval(text)
    state.phase = 'pending'
    this.emit({ type: 'plan_mode_changed', active: true, phase: 'pending', originalMode: state.originalMode })
    const pending = host.store.current() ?? plan
    const pendingVersion = pending.updatedAt
    this.emit({ type: 'plan_updated', plan: pending })
    const turn = this.activeTurn
    const inTurn = !!turn && (context.turnId === undefined || context.turnId === turn.id)
    const turnId = context.turnId ?? turn?.id ?? 'plan-mode'
    const callId = context.callId ?? 'exit-plan-mode'
    const requestId = randomUUID()
    const request: ApprovalRequest = {
      requestId,
      turnId,
      callId,
      name: 'ExitPlanMode',
      summary: [
        `批准计划：${goal || pending.goal}`,
        ...(context.permissionIntents ?? []).map((intent) => `权限意图：${intent}`)
      ].join('\n'),
      preview: text.split('\n'),
      planId: pending.id,
      planVersion: pendingVersion
    }
    this.emit({
      type: 'approval_requested',
      turnId,
      requestId,
      callId,
      name: request.name,
      summary: request.summary,
      ...(request.preview ? { preview: request.preview } : {}),
      ...(request.planId !== undefined ? { planId: request.planId } : {}),
      ...(request.planVersion !== undefined ? { planVersion: request.planVersion } : {})
    })
    if (inTurn) this.setState('awaiting_approval')
    const decision = await this.awaitPlanDecision(inTurn ? turn : undefined, request)
    if (inTurn) this.setState('tool_running')
    this.emit({
      type: 'approval_resolved',
      turnId,
      requestId,
      outcome: decision.outcome,
      via: decision.via
    })
    if (this.planModeState !== state) return { ok: false, message: '计划模式已结束', cancelled: true }
    if (decision.outcome !== 'allow' && decision.outcome !== 'allow_session') {
      state.phase = 'research'
      try {
        host.store.reject(decision.feedback)
        this.emit({ type: 'plan_updated', plan: host.store.current() ?? pending })
      } catch {
        // A rejected plan may already be consumed; staying in research is enough.
      }
      this.emit({
        type: 'plan_mode_changed',
        active: true,
        phase: 'research',
        originalMode: state.originalMode
      })
      if (decision.outcome === 'cancelled') {
        return { ok: false, message: '计划审批已取消，仍停留在调研阶段', cancelled: true }
      }
      const feedback = decision.feedback?.trim() ? `：${decision.feedback.trim()}` : ''
      return { ok: false, message: `计划未获批准${feedback}` }
    }
    let approved: Plan
    const editedText = decision.editedText?.trim()
    const approvedText = editedText || text
    try {
      const current = host.store.current()
      if (current !== pending || current.updatedAt !== pendingVersion || current.approval !== 'pending') {
        throw new Error('计划版本在审批期间发生变化，请重新提交')
      }
      if (host.readDraft && host.readDraft() !== draft) {
        throw new Error('计划草稿在审批期间发生变化，请重新提交')
      }
      const approvalDrift = host.diff(approvalSnapshot, host.snapshot())
      if (approvalDrift.length) {
        throw new Error(`工作区在审批期间发生漂移，请重新提交：${describeDrift(approvalDrift)}`)
      }
      if (draft === undefined || editedText) host.writeDraft?.(approvedText)
      approved = host.store.approve(approvedText)
    } catch (error) {
      state.phase = 'research'
      this.emit({
        type: 'plan_mode_changed',
        active: true,
        phase: 'research',
        originalMode: state.originalMode
      })
      return {
        ok: false,
        message: error instanceof Error ? error.message : '批准计划失败'
      }
    }
    const check = host.validate(approved)
    if (!check.ok) {
      state.phase = 'research'
      this.emit({
        type: 'plan_mode_changed',
        active: true,
        phase: 'research',
        originalMode: state.originalMode
      })
      return {
        ok: false,
        message: `计划批准后校验失败：${describeDrift(check.drift)}`,
        drift: check.drift
      }
    }
    policy.setMode(state.originalMode)
    this.planModeState = undefined
    this.approvedPlanCheck = { planId: approved.id, rechecked: false }
    this.emit({ type: 'plan_updated', plan: approved })
    this.emit({ type: 'plan_mode_changed', active: false, originalMode: state.originalMode })
    return {
      ok: true,
      message: `计划已批准（${approved.id}），已恢复权限档位 ${state.originalMode}`,
      planId: approved.id,
      version: approved.updatedAt,
      edited: !!editedText,
      text: approvedText
    }
  }

  /** UI-only 查询：当前待回答的追问（design §6.4）。 */
  get pendingQuestion(): PendingQuestion | undefined {
    return this.pendingQuestionState?.question
  }

  /**
   * 在活动回合内挂起并追问用户（§6.4）。复用 awaiting_approval 状态，
   * 由宿主通过 answerQuestion/cancelQuestion 结束等待；中断回合同样结束等待。
   */
  async askQuestion(
    questions: Question[],
    context: { turnId?: string; callId?: string } = {}
  ): Promise<string> {
    const turn = this.activeTurn
    if (!turn) throw new Error('追问必须在进行中的回合内发起')
    if (this.pendingQuestionState) throw new Error('已有待回答的追问，不能并发发起')
    const questionId = randomUUID()
    const callId = context.callId ?? ''
    const pending: PendingQuestion = {
      questionId,
      callId,
      questions,
      allowFreeText: true,
      createdAt: Date.now()
    }
    this.emit({ type: 'question_requested', turnId: turn.id, callId, question: pending })
    this.setState('awaiting_approval')
    const outcome = await new Promise<QuestionOutcome>((resolve) => {
      const finish = (next: QuestionOutcome) => {
        if (this.pendingQuestionState?.question.questionId === questionId) {
          this.pendingQuestionState = undefined
        }
        resolve(next)
      }
      const onAbort = () => finish({ status: 'cancelled' })
      turn.controller.signal.addEventListener('abort', onAbort, { once: true })
      this.pendingQuestionState = { question: pending, resolve: finish }
    })
    if (this.state === 'awaiting_approval') this.setState('tool_running')
    if (outcome.status === 'cancelled') {
      this.emit({ type: 'question_cancelled', turnId: turn.id, callId, questionId })
      return 'The question was cancelled; continue without the user answer.'
    }
    this.emit({
      type: 'question_answered',
      turnId: turn.id,
      callId,
      questionId,
      answers: outcome.answers,
      ...(outcome.annotations ? { annotations: outcome.annotations } : {})
    })
    return formatQuestionResult(questions, outcome.answers, outcome.annotations)
  }

  /**
   * 宿主提交回答：校验待处理请求与原始 call ID，返回单一 tool_result
   * 所需文本（§6.4）。重复、过期与跨回合响应一律无效。
   */
  answerQuestion(
    questionId: string,
    answers: QuestionAnswers,
    annotations?: QuestionAnnotations
  ): { ok: boolean; reason?: string } {
    const pending = this.pendingQuestionState
    if (!pending) return { ok: false, reason: '没有待回答的追问' }
    if (pending.question.questionId !== questionId) {
      return { ok: false, reason: '追问标识不匹配或已过期' }
    }
    if (typeof answers !== 'object' || answers === null) {
      return { ok: false, reason: '答案必须按题目文本关联的对象' }
    }
    const normalized: QuestionAnswers = {}
    for (const question of pending.question.questions) {
      const answer = answers[question.question]
      if (typeof answer !== 'string' || answer.trim() === '') {
        return { ok: false, reason: `题目缺少答案：${question.question}` }
      }
      normalized[question.question] = answer.trim()
    }
    pending.resolve({ status: 'answered', answers: normalized, ...(annotations ? { annotations } : {}) })
    return { ok: true }
  }

  /** 取消待回答的追问：发 question_cancelled，以同一 call ID 返回取消结果。 */
  cancelQuestion(questionId?: string): boolean {
    const pending = this.pendingQuestionState
    if (!pending) return false
    if (questionId !== undefined && pending.question.questionId !== questionId) return false
    pending.resolve({ status: 'cancelled' })
    return true
  }

  private awaitPlanDecision(
    turn: ActiveTurn | undefined,
    request: ApprovalRequest
  ): Promise<ApprovalDecision> {
    if (turn) return this.requestApproval(turn, request)
    return new Promise<ApprovalDecision>((resolve) => {
      const finish = (decision: ApprovalDecision) => {
        if (this.pendingPlanDecision?.requestId === request.requestId) {
          this.pendingPlanDecision = undefined
        }
        resolve(decision)
      }
      this.pendingPlanDecision = { requestId: request.requestId, resolve: finish }
      this.options.approval.request(request).then(finish, () =>
        finish({ outcome: 'cancelled', via: 'policy' })
      )
    })
  }

  /** 已批准计划在执行前漂移：重建计划并回到待批（§6.3）。 */
  private async reopenPlanForApproval(plan: Plan, drift: PlanDriftItem[]): Promise<void> {
    const host = this.options.planMode
    if (!host) return
    const originalMode =
      this.planModeState?.originalMode ?? this.options.permissionPolicy?.getMode() ?? 'read_only'
    const text = (await host.readPlanText().catch(() => undefined))?.trim() || plan.goal
    let next: Plan = plan
    try {
      next = host.store.create(plan.goal, plan.steps.map((step) => ({ title: step.title })))
      host.store.requestApproval(text)
    } catch {
      // Without a writable plan store we still keep the session in pending.
    }
    this.planModeState = { phase: 'pending', originalMode, baseline: host.snapshot() }
    this.approvedPlanCheck = undefined
    this.emit({ type: 'plan_updated', plan: host.store.current() ?? next })
    this.emit({ type: 'plan_mode_changed', active: true, phase: 'pending', originalMode })
    this.emit({
      type: 'notice',
      level: 'warning',
      code: 'plan_mode',
      text: `计划执行前校验发现漂移，需重新批准：${describeDrift(drift)}`
    })
  }

  /** In-process display subscription. The public session event stream is unchanged. */
  onToolPreview(handler: (names: readonly string[]) => void): () => void {
    this.toolPreviewListeners.add(handler)
    return () => { this.toolPreviewListeners.delete(handler) }
  }

  on(handler: (event: SessionEvent) => void): () => void {
    this.listeners.add(handler)
    return () => this.listeners.delete(handler)
  }

  /** Submit user input. While a turn is running the input is queued. */
  submit(text: string, options?: SubmitOptions): void {
    if (!text.trim()) return
    const submitted = options?.preserveWhitespace ? text : text.trim()
    if (this.state !== 'idle') {
      const item: QueuedInput = { id: randomUUID(), text: submitted, ...(options ? { options } : {}) }
      this.queue.push(item)
      this.emit({ type: 'input_queued', queueId: item.id, preview: previewOf(submitted) })
      return
    }
    void this.startTurn(submitted, undefined, options).catch((error) => {
      this.emit({
        type: 'notice',
        level: 'error',
        code: 'stream_fallback',
        text: error instanceof Error ? error.message : 'Session failed to start'
      })
    })
  }

  /** Interrupt the running turn (SP002 AC SL-04). */
  interrupt(reason: 'user'): void {
    const turn = this.activeTurn
    if (!turn || turn.finalized) return
    this.setState('cancelling')
    turn.controller.abort()
    const budget = this.options.cancelBudgetMs ?? CANCEL_BUDGET_MS
    const timer = setTimeout(() => {
      if (!turn.finalized) this.finalize(turn, 'cancelled')
    }, budget)
    if (typeof timer.unref === 'function') timer.unref()
    turn.cancelTimer = timer
  }

  /** Clear the conversation. Only allowed at a turn boundary. */
  clearHistory(): void {
    this.lastUsage = undefined
    this.totalUsage = { inputTokens: 0, outputTokens: 0, requests: 0 }
    this.perfSamples.length = 0
    if (this.state !== 'idle') return
    this.messages.length = 0
    this.emit({ type: 'conversation_cleared' })
  }

  /** Move queued input back to the host (SP002 design §3.3 idle Esc). */
  recycleQueued(): string[] {
    if (this.queueTimer) {
      clearTimeout(this.queueTimer)
      this.queueTimer = undefined
    }
    const texts = this.queue.map((item) => item.text)
    if (texts.length > 0) {
      this.queue.length = 0
      this.emit({
        type: 'notice',
        level: 'info',
        code: 'queue_recycled',
        text: 'Queued input returned to the prompt'
      })
    }
    return texts
  }

  dispose(): void {
    if (this.queueTimer) clearTimeout(this.queueTimer)
    this.pendingQuestionState?.resolve({ status: 'cancelled' })
    if (this.pendingPlanDecision) {
      this.pendingPlanDecision.resolve({ outcome: 'cancelled', via: 'policy' })
      this.pendingPlanDecision = undefined
    }
    if (this.planModeState) {
      // 会话销毁时恢复原权限档位，避免把计划模式档位留在宿主策略上（§6.2）。
      this.options.permissionPolicy?.setMode(this.planModeState.originalMode)
      this.planModeState = undefined
      this.approvedPlanCheck = undefined
    }
    if (this.activeTurn) {
      const turn = this.activeTurn
      this.queue.length = 0
      turn.controller.abort()
      this.finalize(turn, 'cancelled')
    }
    // Host-owned resources: the command runner terminates any background task tree (SP004 §4.4).
    for (const dispose of this.options.disposers ?? []) {
      try {
        dispose()
      } catch {
        // Disposal is best effort; one failing resource must not block the rest.
      }
    }
    this.listeners.clear()
    this.toolPreviewListeners.clear()
  }

  private emit(event: SessionEvent): void {
    this.options.onEvent?.(event)
    for (const listener of this.listeners) listener(event)
  }

  /**
   * SP006 §9：运行一个 hook 事件。hooks 是旁路能力：任何异常都降级为提示，
   * 绝不能让 hook 的故障改变回合或工具的结局（HK-07）。
   */
  private async runHook(
    event: SessionHookEvent,
    input: Record<string, unknown>
  ): Promise<HookRunResult | undefined> {
    const hooks = this.options.hooks
    if (!hooks) return undefined
    let result: HookRunResult
    try {
      result = await hooks.run(event, {
        session_id: this.id,
        cwd: process.cwd(),
        ...input
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emit({
        type: 'notice',
        level: 'warning',
        code: 'hook_warning',
        text: `hook 执行失败，已跳过（${event}）：${message}`
      })
      return undefined
    }
    for (const text of result.systemMessages ?? []) {
      this.emit({ type: 'notice', level: 'info', code: 'hook_output', text })
    }
    for (const text of result.warnings ?? []) {
      this.emit({ type: 'notice', level: 'warning', code: 'hook_warning', text })
    }
    if (result.additionalContext?.length) {
      this.hookContext.push(...result.additionalContext)
    }
    if (result.blocked) {
      this.emit({
        type: 'notice',
        level: 'warning',
        code: 'hook_blocked',
        text: `${event} hook 阻断了本回合：${result.reason ?? '未给出原因'}`
      })
    }
    return result
  }

  private traceBegin(
    name: string,
    attributes: Record<string, string | number | boolean>,
    parent?: TraceHandle
  ): TraceHandle | undefined {
    const tracer = this.options.tracer
    if (!tracer) return undefined
    try {
      return tracer.begin(name, attributes, parent)
    } catch {
      return undefined
    }
  }

  private traceEnd(
    handle: TraceHandle | undefined,
    outcome: 'success' | 'error' | 'cancelled' | 'blocked',
    error?: unknown
  ): void {
    const tracer = this.options.tracer
    if (!tracer || !handle) return
    try {
      tracer.end(handle, outcome, error)
    } catch {
      /* 观测不得改变业务结果 */
    }
  }

  private traceAttributes(
    handle: TraceHandle | undefined,
    attributes: Record<string, string | number | boolean>
  ): void {
    const tracer = this.options.tracer
    if (!tracer || !handle) return
    try {
      tracer.setAttributes(handle, attributes)
    } catch {
      /* 观测不得改变业务结果 */
    }
  }

  private tracePayload(
    handle: TraceHandle | undefined,
    key: 'input' | 'output',
    value: unknown
  ): void {
    const tracer = this.options.tracer
    if (!tracer || !handle) return
    try {
      tracer.setPayload(handle, key, value)
    } catch {
      /* 观测不得改变业务结果 */
    }
  }

  private traceUsage(handle: TraceHandle | undefined, usage: Usage): void {
    const input = usage.inputTokens ?? 0
    const output = usage.outputTokens ?? 0
    this.traceAttributes(handle, {
      'langfuse.observation.usage_details': JSON.stringify({ input, output })
    })
  }


  private setState(next: SessionState): void {
    if (next === this.state) return
    if (!ALLOWED_TRANSITIONS[this.state].includes(next)) {
      this.emit({
        type: 'notice',
        level: 'warning',
        code: 'late_event_dropped',
        text: `Rejected invalid state transition ${this.state} → ${next}`
      })
      return
    }
    this.state = next
    this.emit({ type: 'status', state: next })
  }

  private async startTurn(
    userText: string,
    queued?: QueuedInput,
    options?: SubmitOptions
  ): Promise<void> {
    const turn: ActiveTurn = {
      provider: this.options.resolveProvider?.() ?? this.options.provider,
      id: randomUUID(),
      controller: new AbortController(),
      finalized: false,
      userText,
      messageIds: []
    }
    this.activeTurn = turn
    this.turnLog.push({ turnId: turn.id })
    turn.traceRoot = this.traceBegin('agent.run', {
      'session.id': this.id,
      'turn.id': turn.id,
      'langfuse.trace.metadata.runId': randomUUID(),
      'langfuse.observation.type': 'agent',
      'langfuse.trace.name': 'agent.run'
    })
    this.tracePayload(turn.traceRoot, 'input', [{ role: 'user', content: userText }])
    if (queued) {
      this.emit({
        type: 'input_injected',
        turnId: turn.id,
        queueId: queued.id,
        text: userText,
        boundary: 'inter_turn',
        ...(queued.notification ? { notification: true } : {}),
        ...(queued.notice ? { display: queued.notice } : {})
      })
    }
    const snapshot = this.options.resolveSnapshot()
    turn.snapshot = snapshot
    // SP007 MM-08：明确不支持图片（vision===false）→ 前置拒绝，不发起请求。
    if (options?.images?.length && snapshot.capabilities.vision === false) {
      this.emit({
        type: 'notice',
        level: 'warning',
        code: 'image_rejected',
        text: '当前模型不支持图片输入，图片未发送。请切换到支持视觉的模型，或移除图片后重试。'
      })
      this.traceEnd(turn.traceRoot, 'blocked')
      turn.finalized = true
      this.activeTurn = undefined
      return
    }
    this.emit({
      type: 'turn_started',
      turnId: turn.id,
      snapshot,
      userText,
      startedAt: Date.now(),
      ...(queued?.notification ? { notification: true } : {}),
      ...(queued?.notice ? { display: queued.notice } : {})
    })
    this.setState('requesting')
    const userMessage = this.userMessage(userText, options)
    this.limitSkillTools(turn, options?.allowedSkillTools)
    if (queued?.notification) userMessage.notificationDisplay = queued.notice ?? 'Background task finished'
    turn.messageIds.push(userMessage.id)
    this.messages.push(userMessage)
    this.recordMessage(userMessage)
    await this.runTurn(turn, snapshot)
  }

  /**
   * SP006 §6.3 /btw：旁路问答。复制当前上下文向模型单独提问，回答不写回
   * 会话历史、不触发工具与审批，因此不会污染主回合语义（CMD-06）。
   */
  async submitSideQuestion(question: string, signal = new AbortController().signal): Promise<{ ok: boolean; text?: string; error?: string }> {
    if (signal.aborted) return { ok: false }
    const trimmed = question.trim()
    if (!trimmed) return { ok: false, error: '旁路问题不能为空' }
    const provider = this.options.resolveProvider?.() ?? this.options.provider
    const snapshot = this.options.resolveSnapshot()
    const messages = normalizeForApi(this.messages as Message[])
    messages.unshift({
      role: 'system',
      content:
        '你是 budingx，一款在终端运行的编程助手。这是一次不影响主会话的旁路问答：' +
        '回答简短、不要调用工具、不要修改文件，也不要假装已经执行任何操作。'
    })
    messages.push({ role: 'user', content: trimmed })
    try {
      let text = ''
      for await (const event of provider.stream({ model: snapshot.model, messages, signal })) {
        if (signal.aborted) return { ok: false }
        if (event.type === 'text_delta') text += event.text
        else if (event.type === 'failed') return { ok: false, error: event.error.message }
        else if (event.type === 'message_completed') break
      }
      const answer = text.trim()
      return answer ? { ok: true, text: answer } : { ok: false, error: '模型没有返回内容' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '旁路请求失败' }
    }
  }

  /**
   * SP005 §5：把一条记录写入转录。写入失败不会影响本轮业务结果，
   * 只会记录错误位置（FR-07）。
   */
  private writeTranscript(record: TranscriptRecord): void {
    const result = appendTranscript(this.options.transcript, record)
    if (result.ok) return
    this.persistenceError = { code: result.code, message: result.message }
    this.emit({
      type: 'notice',
      level: 'error',
      code: 'storage_write_failed',
      text: `session transcript write failed (${result.code}): ${result.message}`
    })
  }

  /** SP005 §5：记录一条消息（用户、助手或工具结果）。 */
  private recordMessage(message: Message, parentId?: string, usage?: Usage): void {
    if (!this.options.transcript) return
    // SP007 RD-16：消息归属模型，/stats 按模型聚合（旧转录缺省 unknown 桶）。
    const model = this.activeTurn?.snapshot?.model
    this.writeTranscript({
      type: 'message',
      ts: new Date().toISOString(),
      id: message.id,
      ...(parentId ? { parentId } : {}),
      role: message.role,
      blocks: message.blocks,
      ...(message.notificationDisplay ? { notificationDisplay: message.notificationDisplay } : {}),
      ...(model ? { model } : {}),
      ...(usage ? { usage } : {})
    })
  }

  /**
   * SP005 §4：收集压缩必须保留的结构化事实。
   * 保留项来自状态本身（用户约束 / 已批准计划 / 未完成工具调用），
   * 不依赖对历史做文本摘要，因此压缩后约束与工具状态不会丢。
   */
  private preservedItems(): PreservedItem[] {
    const maxTokens = this.options.contextBudget?.maxTokens ?? 0
    const reserved = this.options.contextBudget?.reservedOutputTokens ?? Math.floor(maxTokens / 4)
    // 单条保留项最多占目标预算的 1/4，避免保留项本身把预算占满。
    const itemLimit = Math.max(1, Math.floor((maxTokens - reserved) / 4))
    const items: PreservedItem[] = collectConstraintItems(this.messages, itemLimit)
    const planText = this.options.resolvePlanText?.()
    if (planText && planText.trim()) {
      items.push({
        kind: 'plan',
        id: 'plan',
        text: planText.trim(),
        reason: '已批准计划在压缩后必须仍然可读'
      })
    }
    for (const call of unfinishedToolCalls(this.messages)) {
      items.push({
        kind: 'tool_state',
        id: call.callId,
        text: `工具 ${call.name}（${call.callId}）在压缩前未完成，结果未知。`,
        reason: '未完成的工具调用必须显式标记，不能伪造成功'
      })
    }
    // SP007 RD-13：已发现的延迟工具跨压缩存活（同参考 preCompactDiscoveredTools）。
    const discovered = this.options.toolSearch?.state.discovered
    if (this.options.toolSearch?.enabled && discovered && discovered.size > 0) {
      items.push({
        kind: 'tool_state',
        id: 'tool-search-discovered',
        text: '<discovered-tools>' + [...discovered].sort().join(',') + '</discovered-tools>',
        reason: '已发现的延迟工具在压缩后必须仍可调用'
      })
    }
    return items
  }

  /**
   * SP005 §4：按预算压缩上下文。
   * 压缩保留用户约束、已批准计划与未完成工具状态；连续失败达到熔断上限
   * 时停止压缩并交给调用方明确报错（CB-06）。
   */
  /**
   * SP009 0.9.1 LC-06：自动压缩对齐参考仓「模型摘要」手段。
   * 超过触发阈值时，先探测将被裁剪的回合，调用模型把这些回合浓缩成摘要，
   * 再带着摘要执行压缩（摘要作为一条消息保留在压缩边界）。模型摘要失败时
   * 回退到确定性裁剪，保证绝不卡死。压缩仍保留约束/计划/工具状态。
   */
  private async autoCompact(turn: ActiveTurn, snapshot: TurnSnapshot): Promise<void> {
    const budget = this.budget
    if (!budget) return
    const shape = normalizeBudget(
      this.options.contextBudget?.maxTokens ?? 0,
      this.options.contextBudget?.reservedOutputTokens
    )
    // 没有真实预算（宿主未接入窗口）时不压缩：此时阈值恒为 1，任何历史都会
    // 触发一次「压缩」，既无意义又会反复消耗模型摘要请求。
    if (!(shape.maxTokens > 0)) return
    const estimate = budget.estimate({ messages: this.messages, ...shape })
    const trigger = triggerTokens({ messages: this.messages, ...shape })
    if (estimate <= trigger) {
      this.compactionFailures = 0
      return
    }
    if (this.compactionFailures >= COMPACTION_CIRCUIT_LIMIT) {
      this.emit({
        type: 'notice',
        level: 'error',
        code: 'context_overflow',
        text: `context compaction stopped after ${this.compactionFailures} consecutive failures`
      })
      return
    }
    const preserved = this.preservedItems()
    // 探测将被裁剪的区间，交给模型生成摘要（对齐参考仓先摘要后压缩）。
    const probe = budget.compact({ messages: this.messages, ...shape }, preserved)
    let summaryText: string | undefined
    if (probe.compacted && probe.replacedRange) {
      const dropped = this.messages.slice(probe.replacedRange.from, probe.replacedRange.to + 1)
      summaryText = await this.generateCompactionSummary({
        provider: turn.provider,
        model: snapshot.model,
        dropped,
        signal: turn.controller.signal,
        traceParent: turn.traceRoot,
        turnId: turn.id
      })
    }
    const result = budget.compact(
      { messages: this.messages, ...shape, ...(summaryText ? { summaryText } : {}) },
      preserved
    )
    if (!result.compacted) {
      this.compactionFailures++
      this.emit({
        type: 'notice',
        level: 'error',
        code: 'context_overflow',
        text: `context is over the budget and cannot be compacted (${result.overflowReason ?? 'unknown'})`
      })
      return
    }
    this.compactionFailures = 0
    if (!result.withinBudget) {
      this.emit({
        type: 'notice',
        level: 'error',
        code: 'context_overflow',
        text: `context is still over the budget after compaction (${result.overflowReason ?? 'unknown'})`
      })
    }
    this.applyCompaction(turn.id, result, estimate)
  }

  /**
   * 调用模型把被裁剪的回合浓缩成续作摘要。独立撰写的提示词（compact-summary），
   * 机制对齐参考仓。失败 / 中断返回 undefined，由调用方回退确定性裁剪。
   * 以 Langfuse generation 观测，便于回查压缩质量。
   */
  private async generateCompactionSummary(opts: {
    provider: ModelProvider
    model: string
    dropped: Message[]
    signal: AbortSignal
    instruction?: string
    traceParent?: TraceHandle
    turnId: string
  }): Promise<string | undefined> {
    const transcript = renderMessagesForSummary(opts.dropped)
    if (!transcript.trim()) return undefined
    const trace = this.traceBegin(
      'context.compact',
      {
        'langfuse.observation.type': 'generation',
        'gen_ai.request.model': opts.model,
        'session.id': this.id,
        'turn.id': opts.turnId
      },
      opts.traceParent
    )
    this.tracePayload(trace, 'input', [{ role: 'user', content: transcript }])
    try {
      const request: ChatRequest = {
        model: opts.model,
        messages: [{ role: 'user', content: buildSummaryPrompt(transcript, opts.instruction) }],
        signal: opts.signal
      }
      let raw = ''
      let completed = false
      for await (const event of opts.provider.stream(request)) {
        if (opts.signal.aborted) {
          this.traceEnd(trace, 'cancelled')
          return undefined
        }
        if (event.type === 'failed') {
          this.traceEnd(trace, 'error', event.error)
          return undefined
        }
        if (event.type === 'text_delta') raw += event.text
        if (event.type === 'message_completed') completed = event.finishReason === 'stop'
      }
      const summary = completed ? extractSummary(raw) : ''
      this.tracePayload(trace, 'output', summary)
      this.traceEnd(trace, summary ? 'success' : 'error')
      return summary || undefined
    } catch (error) {
      this.traceEnd(trace, 'error', error)
      return undefined
    }
  }

  /**
   * 把一次压缩同时写回会话内存与转录（SP005 review H5）。
   * 只写内存会让跨进程恢复退回压缩前的历史，等于把压缩静默撤销。
   */
  private applyCompaction(turnId: string, result: CompactionResult, estimatedBefore: number): void {
    this.messages.splice(0, this.messages.length, ...result.messages)
    this.emit({
      type: 'context_compacted',
      turnId,
      replacedRange: result.replacedRange ?? { from: 0, to: 0 },
      replacedCount: result.replacedCount,
      preserved: result.preserved,
      estimatedBefore,
      estimatedAfter: result.estimatedTokens,
      withinBudget: result.withinBudget
    })
    this.writeTranscript({
      type: 'compaction',
      ts: new Date().toISOString(),
      turnId,
      droppedIds: result.artifacts?.droppedIds ?? [],
      order: result.artifacts?.order ?? result.messages.map((message) => message.id),
      synthetic: result.artifacts?.synthetic ?? []
    })
  }

  /**
   * SP005 FR-08：上下文溢出时的强制压缩。
   * 压缩失败或压缩后仍然超预算时返回 false，由调用方给出明确失败原因。
   */
  private compactForOverflow(turn: ActiveTurn): boolean {
    const budget = this.budget
    if (!budget) return false
    const shape = normalizeBudget(
      this.options.contextBudget?.maxTokens ?? 0,
      this.options.contextBudget?.reservedOutputTokens
    )
    const preserved = this.preservedItems()
    const estimatedBefore = budget.estimate({ messages: this.messages, ...shape })
    // force：模型已明确报告溢出，本地估算可能因分词器差异而看起来正常，
    // 因此这里忽略触发阈值，强制尝试裁剪一次。
    const result = budget.compact({ messages: this.messages, ...shape, force: true }, preserved)
    if (!result.compacted) {
      this.emit({
        type: 'notice',
        level: 'error',
        code: 'context_overflow',
        text: `the model reported a context overflow and the history cannot be compacted ` +
          `(${result.overflowReason ?? 'unknown'})`
      })
      return false
    }
    this.applyCompaction(turn.id, result, estimatedBefore)
    return true
  }

  private buildRequest(snapshot: TurnSnapshot, turn: ActiveTurn): ChatRequest {
    // SP009 0.9.1：压缩已在 runTurn 里以异步 autoCompact 完成（模型摘要），
    // 这里直接取当前消息，不再做同步压缩。
    const source = this.messages
    const effort = this.options.resolveReasoningEffort?.()
    const request: ChatRequest = {
      model: snapshot.model,
      // 0.5.2：每次请求重新读取，/effort 修改后立即生效。
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
      messages: normalizeForApi(source, turn.provider.preserveToolReasoning?.(snapshot.model)
        ? (message) => {
            const source = this.reasoningSource.get(message)
            return source?.modelId === snapshot.modelId &&
              source.model === snapshot.model &&
              source.baseUrlHost === snapshot.baseUrlHost
          }
        : undefined),
      signal: turn.controller.signal
    }
    // SP007 MM-09：单请求媒体上限 100，超出丢最旧并可见提示（不静默丢弃）。
    {
      const MAX_MEDIA = 100
      let total = 0
      for (const message of request.messages) {
        if (message.role === 'user' && Array.isArray(message.content)) {
          total += message.content.filter((part) => part.type === 'image_url').length
        }
      }
      if (total > MAX_MEDIA) {
        let drop = total - MAX_MEDIA
        for (const message of request.messages) {
          if (drop <= 0) break
          if (message.role !== 'user' || !Array.isArray(message.content)) continue
          message.content = message.content.filter((part) => {
            if (part.type === 'image_url' && drop > 0) {
              drop--
              return false
            }
            return true
          })
        }
        this.emit({
          type: 'notice',
          level: 'warning',
          code: 'image_rejected',
          text: `图片数量超过单请求上限 ${MAX_MEDIA}，已丢弃最旧的 ${total - MAX_MEDIA} 张。`
        })
      }
    }
    const systemContext = this.options.resolveSystemContext?.()
    // hook 上下文只注入一次（本次请求），避免同一回合后续迭代重复堆叠。
    const hookContext = this.hookContext.splice(0, this.hookContext.length).join('\n\n')
    // SP007 RD-13：每次请求前从历史标记重建发现集（覆盖 /resume），并公告当前延迟池。
    const toolSearch = this.options.toolSearch
    toolSearch?.scanHistory(this.messages)
    const deferredNotice = turn.allowedSkillTools ? undefined : toolSearch?.notice()
    const extraContext = [systemContext, hookContext, deferredNotice].filter(Boolean).join('\n\n')
    request.messages.unshift({
      role: 'system',
      content: '你是 budingx，一款在终端运行的编程助手。用户询问你的身份时，介绍 budingx。' +
        '用户询问底层模型时，按本次请求配置的模型 ID 回答：' + snapshot.model +
        '。根据本轮实际提供的工具说明能力，使用用户的语言回答。' +
        (extraContext ? '\n\n' + extraContext : '')
    })
    if (this.tools.length > 0 && snapshot.capabilities.tools) {
      // SP007 RD-12：启用 ToolSearch 时只发送非延迟＋已发现＋ToolSearch 本身。
      const visible = toolSearch?.enabled ? toolSearch.filter(this.tools) : this.tools
      request.tools = visible.filter((tool) => !turn.allowedSkillTools || turn.allowedSkillTools.has(tool.name)).map((tool) => ({
        name: tool.name,
        parameters: tool.parameters ?? { type: 'object', properties: {} },
        description: tool.summary ?? tool.describe({})
      }))
    }
    return request
  }

  private async runTurn(turn: ActiveTurn, snapshot: TurnSnapshot): Promise<void> {
    // SP009 0.9.1 LF-01：交互主循环默认无回合上限（对齐参考仓交互模式不传
    // maxTurns）。只要模型持续返回工具调用就继续；显式传入 maxIterations
    // （无头 --max-turns / 子代理预算）时才设上限。安全网由失败熔断、上下文
    // 溢出恢复与用户中断承担，而不是一个固定的迭代计数。
    const maxIterations = this.options.maxIterations ?? Number.POSITIVE_INFINITY
    let outcome: TurnOutcome = 'unknown'
    let error: ErrorInfo | undefined
    let usage: Usage | undefined
    let iteration = 0
    // SP009 0.9.1：完成声明缺证据的有界重试计数（工具真正执行后清零）。
    let completionRejections = 0
    // SP005 FR-08：上下文溢出后最多再试一次（先压缩再重试）。
    let overflowRetried = false
    // SP007 MM-08：图片不支持错误降级后最多再试一次（剥离图片重试）。
    let imageRetried = false
    // 熔断计数只在一个回合内有效：跨回合累积会让不相关的失败把后续回合误判成空转。
    this.repeatedToolFailures.clear()
    this.toolFailureStreaks.clear()

    // SP006 §9：会话首回合触发一次 SessionStart；UserPromptSubmit 每回合都要跑，
    // 并被允许在进入模型请求前阻断（HK-02/HK-03）。
    if (!this.sessionStartHooked) {
      this.sessionStartHooked = true
      await this.runHook('SessionStart', { source: 'startup' })
    }
    const submitted = await this.runHook('UserPromptSubmit', { prompt: turn.userText })
    if (submitted?.blocked) {
      this.finalize(turn, 'error', {
        class: 'unknown',
        code: 'BUDINGX_HOOK_BLOCKED',
        message: submitted.reason ?? 'UserPromptSubmit hook 阻断了本回合',
        retryable: false
      })
      return
    }

    while (iteration < maxIterations) {
      iteration++
      if (turn.controller.signal.aborted) {
        outcome = 'cancelled'
        break
      }
      if (iteration > 1) this.injectQueued(turn)
      // SP009 0.9.1：请求前按需自动压缩（模型摘要，对齐参考仓）。
      await this.autoCompact(turn, snapshot)
      if (turn.controller.signal.aborted) {
        outcome = 'cancelled'
        break
      }
      this.setState('requesting')

      const assistant: Message = {
        id: randomUUID(),
        role: 'assistant',
        blocks: []
      }
      if (turn.provider.preserveToolReasoning?.(snapshot.model)) this.reasoningSource.set(assistant, snapshot)
      turn.assistant = assistant
      const fragments: ToolFragment[] = []
      let finishReason: FinishReason = 'unknown'
      let providerFailure: ErrorInfo | undefined
      const modelTrace = this.traceBegin(
        'model.request',
        {
          'langfuse.observation.type': 'generation',
          'gen_ai.request.model': snapshot.model,
          'session.id': this.id,
          'turn.id': turn.id
        },
        turn.traceRoot
      )
      let modelUsage: Usage | undefined
      // SP007 RD-04：请求计时（含 provider 内部重试），首 token＝首个内容增量。
      const requestStartedAt = Date.now()
      let firstDeltaAt: number | undefined

      try {
        for await (const event of turn.provider.stream(
          this.buildRequest(snapshot, turn)
        )) {
          if (turn.finalized) break
          switch (event.type) {
            case 'text_delta':
              if (firstDeltaAt === undefined) firstDeltaAt = Date.now()
              appendStreamBlock(assistant.blocks, 'text', event.text)
              this.emit({
                type: 'text_delta',
                turnId: turn.id,
                messageId: assistant.id,
                text: event.text
              })
              this.setState('streaming')
              break
            case 'thinking_delta':
              if (firstDeltaAt === undefined) firstDeltaAt = Date.now()
              appendStreamBlock(assistant.blocks, 'thinking', event.text)
              this.emit({
                type: 'thinking_delta',
                turnId: turn.id,
                messageId: assistant.id,
                text: event.text
              })
              break
            case 'tool_call_delta':
              if (firstDeltaAt === undefined) firstDeltaAt = Date.now()
              fragments.push({
                index: event.index,
                callId: event.callId,
                nameDelta: event.nameDelta,
                argsDelta: event.argsDelta
              })
              if (this.toolPreviewListeners.size && (event.nameDelta || event.callId)) {
                const names = assembleToolCalls(fragments, true).calls.map((call) => call.name)
                for (const listener of this.toolPreviewListeners) listener(names)
              }
              break
            case 'message_completed':
              finishReason = event.finishReason
              usage = event.usage
              modelUsage = event.usage
              if (event.usage) {
                this.lastUsage = event.usage
                this.totalUsage.inputTokens += event.usage.inputTokens ?? 0
                this.totalUsage.outputTokens += event.usage.outputTokens ?? 0
                this.totalUsage.requests += 1
              }
              break
            case 'retry':
              this.emit({
                type: 'notice',
                level: 'info',
                code: 'api_retry',
                text: `Retrying request (attempt ${event.attempt}/${event.maxAttempts})`
              })
              break
            case 'failed':
              providerFailure = event.error
              break
          }
          if (providerFailure) break
        }
      } catch (error) {
        providerFailure = {
          class: turn.controller.signal.aborted ? 'aborted' : 'unknown',
          code: turn.controller.signal.aborted
            ? ERROR_CODES.providerAborted
            : ERROR_CODES.coreToolFailed,
          message: error instanceof Error ? error.message : 'Provider stream failed',
          retryable: false
        }
      } finally {
        if (this.activeTurn === turn && fragments.length) {
          for (const listener of this.toolPreviewListeners) listener([])
        }
        this.perfSamples.push({
          requestMs: Date.now() - requestStartedAt,
          ...(firstDeltaAt !== undefined ? { firstTokenMs: firstDeltaAt - requestStartedAt } : {})
        })
        if (this.perfSamples.length > 500) this.perfSamples.shift()
      }

      if (providerFailure) {
        if (modelUsage) this.traceUsage(modelTrace, modelUsage)
        this.traceEnd(
          modelTrace,
          providerFailure.class === 'aborted' || turn.controller.signal.aborted ? 'cancelled' : 'error',
          providerFailure
        )
        if (providerFailure.class === 'aborted' || turn.controller.signal.aborted) {
          outcome = 'cancelled'
        } else if (
          providerFailure.class === 'context_overflow' &&
          !overflowRetried &&
          this.budget &&
          this.compactForOverflow(turn)
        ) {
          // SP005 FR-08：压缩成功后再试一次；仍失败则明确报错，不静默重试。
          overflowRetried = true
          iteration--
          continue
        } else if (
          providerFailure.class === 'bad_request' &&
          isImageUnsupportedError(providerFailure.message) &&
          !imageRetried &&
          this.stripLatestUserImages()
        ) {
          // SP007 MM-08：错误驱动降级——剥离最近 user 图片后无图重试一次。
          this.emit({
            type: 'notice',
            level: 'warning',
            code: 'image_downgraded',
            text: '模型拒绝图片输入，已移除图片并以纯文本重试。'
          })
          imageRetried = true
          iteration--
          continue
        } else {
          // 降级重试仍因图片失败 → 明确 image_error，不静默吞错。
          outcome = imageRetried && isImageUnsupportedError(providerFailure.message)
            ? 'image_error'
            : 'error'
          error = providerFailure
        }
        break
      }

      if (modelUsage) this.traceUsage(modelTrace, modelUsage)
      this.traceEnd(modelTrace, 'success')

      const { calls, errors } = assembleToolCalls(fragments, true)
      const callErrors = errors.filter(
        (error) => error.code !== ERROR_CODES.providerToolArgumentsInvalid
      )
      if (callErrors.length > 0) {
        outcome = 'error'
        error = {
          class: 'invalid_stream',
          code: callErrors[0].code,
          message: callErrors[0].message,
          retryable: false
        }
        break
      }
      if (calls.length > 0) {
        for (const call of calls) {
          assistant.blocks.push({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: parseToolArguments(call)
          })
        }
      }
      if (assistant.blocks.length > 0) {
        this.messages.push(assistant)
        turn.messageIds.push(assistant.id)
        // SP007 RD-04：assistant 消息携带本次请求用量，供 /stats 按模型按日聚合。
        this.recordMessage(assistant, undefined, modelUsage)
        // SP005 §5：已派发的工具调用先登记，结果未知时只标记 needs_review。
        for (const block of assistant.blocks) {
          if (block.type === 'tool_use') {
            this.pendingToolCalls.set(block.id, { turnId: turn.id, name: block.name })
          }
        }
        this.emit({
          type: 'message_completed',
          turnId: turn.id,
          messageId: assistant.id,
          ...(usage ? { usage } : {})
        })
      }

      if (calls.length === 0) {
        if (finishReason === 'length') {
          outcome = 'length_capped'
          break
        }
        // CT-07：完成声明必须附带真实证据；无证据时回喂原因并继续迭代。
        // SP009 0.9.1：主循环不再有固定回合上限，因此这里必须有有界重试，
        // 否则模型持续给出无证据的「完成」声明会无限循环。
        const claim = this.options.codingTask?.canClaimDone()
        if (claim && !claim.ok && this.options.codingTask?.get()) {
          completionRejections++
          const reason = claim.reason ?? '未运行测试'
          if (completionRejections > MAX_COMPLETION_CLAIM_REJECTIONS) {
            this.emit({
              type: 'notice',
              level: 'warning',
              code: 'coding_task',
              text: `完成声明连续 ${completionRejections} 次缺少证据（${reason}），已停止追问；任务仍未验证。`
            })
            outcome = 'completed'
            break
          }
          this.emit({
            type: 'notice',
            level: 'warning',
            code: 'coding_task',
            text: `完成声明缺少证据：${reason}`
          })
          this.messages.push({
            id: randomUUID(),
            role: 'user',
            blocks: [
              {
                type: 'text',
                text: `在声称完成之前必须先提供真实执行证据：${reason}。请继续执行必要命令（包含测试）并修复失败，再声明完成。`
              }
            ]
          })
          continue
        }
        outcome = 'completed'
        break
      }

      const dispatched = await this.dispatchTools(turn, calls)
      if (dispatched.cancelled) {
        outcome = 'cancelled'
        break
      }
      if (dispatched.error) {
        outcome = 'error'
        error = dispatched.error
        break
      }
      if (turn.skillContexts?.length) {
        const context: Message = {
          id: randomUUID(), role: 'user',
          blocks: turn.skillContexts.map(({ source, content }) => ({ type: 'context', source, content }))
        }
        turn.messageIds.push(context.id)
        this.messages.push(context)
        this.recordMessage(context)
        turn.skillContexts = []
      }
      // 真正执行了工具（无论成败）就代表还在推进，完成声明的重试计数清零。
      completionRejections = 0
    }

    if (outcome === 'unknown') {
      outcome = 'max_turns'
      this.emit({
        type: 'notice',
        level: 'warning',
        code: 'model_limit_reached',
        text: `Stopped after ${maxIterations} iterations`
      })
    }

    this.finalize(turn, outcome, error, usage)
  }

  private async dispatchTools(
    turn: ActiveTurn,
    calls: { index: number; id: string; name: string; arguments: string }[]
  ): Promise<{ cancelled?: boolean; error?: ErrorInfo }> {
    let index = 0
    while (index < calls.length) {
      if (turn.controller.signal.aborted) return { cancelled: true }
      const call = calls[index]
      const handler = this.tools.find((tool) => tool.name === call.name)
      // SP007 SA-05/SA-15：连续且全部 concurrencySafe 的调用并行成组（D6 范围限定），
      // 其余工具保持顺序。结果按调用原序回灌；审批由串行队列保证弹窗不竞争。
      if (handler?.concurrencySafe) {
        const group = [call]
        let next = index + 1
        while (next < calls.length) {
          const nextHandler = this.tools.find((tool) => tool.name === calls[next].name)
          if (!nextHandler?.concurrencySafe) break
          group.push(calls[next])
          next += 1
        }
        if (group.length > 1) {
          const sinks: DispatchResult[][] = group.map(() => [])
          const outcomes = await Promise.all(
            group.map((member, position) =>
              this.dispatchOne(turn, member, (result) => sinks[position].push(result))
            )
          )
          for (let position = 0; position < group.length; position += 1) {
            for (const result of sinks[position]) {
              this.pushToolResult(turn, group[position].id, result.content, result.isError, result.code, result.trace)
            }
          }
          for (const outcome of outcomes) {
            if (outcome.error) return outcome
            if (outcome.cancelled) return { cancelled: true }
          }
          index = next
          continue
        }
      }
      const outcome = await this.dispatchOne(turn, call)
      if (outcome.error) return outcome
      if (outcome.cancelled) return { cancelled: true }
      index += 1
    }
    return {}
  }

  /**
   * SP007：单个工具调用的完整派发（审批/权限/hook/执行/熔断）。
   * sink 存在时结果先缓冲（并行组），由 dispatchTools 按原序回灌；
   * 否则立即 pushToolResult（顺序路径，行为与 SP003/SP005 一致）。
   */
  private async dispatchOne(
    turn: ActiveTurn,
    call: { index: number; id: string; name: string; arguments: string },
    sink?: (result: DispatchResult) => void
  ): Promise<{ cancelled?: boolean; error?: ErrorInfo }> {
    const pushResult = (content: string, isError: boolean, code?: string, trace?: TraceHandle): void => {
      if (sink) sink({ content, isError, code, trace })
      else this.pushToolResult(turn, call.id, content, isError, code, trace)
    }
    if (turn.controller.signal.aborted) return { cancelled: true }
    if (turn.allowedSkillTools && !turn.allowedSkillTools.has(call.name)) {
      pushResult(`Tool "${call.name}" is outside the active skill's allowed-tools scope`, true, ERROR_CODES.permissionDenied)
      return {}
    }
    try {
      JSON.parse(call.arguments || '{}')
    } catch {
      // SP007 PC-05：非法 JSON 以 InputValidationError 形状回灌，供模型自纠不中断。
      pushResult('<tool_use_error>InputValidationError: Tool arguments are not valid JSON</tool_use_error>',
        true,
        ERROR_CODES.providerToolArgumentsInvalid
      )
      return {}
    }
    let input = parseToolArguments(call)
    const handler = this.tools.find((tool) => tool.name === call.name)
    // 观测要能回答「工具被用什么参数调用」，否则无法判断调用是否合适。
    const toolTrace = this.traceBegin(
      `tool.${call.name}`,
      {
        'langfuse.observation.type': 'tool',
        'gen_ai.tool.call.id': call.id,
        'session.id': this.id,
        'turn.id': turn.id
      },
      turn.traceRoot
    )
    this.tracePayload(toolTrace, 'input', input)
    this.emit({
      type: 'tool_call_completed',
      turnId: turn.id,
      callId: call.id,
      name: call.name,
      input
    })
    if (!handler) {
      this.traceEnd(toolTrace, 'error')
      pushResult(`Unknown tool: ${call.name}`,
        true,
        ERROR_CODES.coreToolUnknown
      )
      return {}
    }
    // SP007 RD-14：调用尚未发现的延迟工具 → 明确引导先 ToolSearch 加载，不静默执行。
    const toolSearch = this.options.toolSearch
    if (toolSearch?.enabled && toolSearch.isDeferred(call.name) && !toolSearch.state.discovered.has(call.name)) {
      this.traceEnd(toolTrace, 'blocked')
      pushResult(
        'Tool "' + call.name + '" is not loaded yet. call ToolSearch with query "select:' +
          call.name + '", then retry',
        true,
        ERROR_CODES.coreToolUnknown
      )
      return {}
    }
    // SP006 §9：PreToolUse 在权限判定之前运行，可阻断、改写入参或给出审批意见。
    const preTool = await this.runHook('PreToolUse', {
      tool_name: call.name,
      tool_input: input,
      tool_use_id: call.id
    })
    if (preTool?.blocked || preTool?.permissionDecision === 'deny') {
      const reason = preTool.reason ?? preTool.permissionDecisionReason ?? 'hook 拒绝了该工具调用'
      this.traceEnd(toolTrace, 'blocked')
      pushResult(`Denied by hook: ${reason}`, true, ERROR_CODES.permissionDenied)
      this.emit({
        type: 'denial_recorded',
        denial: {
          tool: call.name,
          reason: `Denied by hook: ${reason}`,
          at: new Date().toISOString()
        }
      })
      return {}
    }
    if (preTool?.updatedInput !== undefined) {
      input = preTool.updatedInput as Record<string, unknown>
    }
    // SP003: with a policy the verdict decides; without one the SP002
    // requiresApproval hook keeps its exact behaviour.
    const policy = this.options.permissionPolicy
    const approvalHook = handler.requiresApproval?.(input) ?? false
    let needsApproval = approvalHook
    let permissionRequest: PermissionRequest | undefined
    // 计划模式的一次性批准：即使宿主勾选“本会话允许”，也不写入记忆（§6.2）。
    let planModeSingleUse = false
    if (policy) {
      const capability = handler.capability?.(input) ?? 'read'
      const target = handler.target?.(input)
      const managedPlanDraft =
        target?.kind === 'plan-draft' && target.path !== undefined &&
        target.path === this.options.planMode?.draftPath &&
        (capability === 'read'
          ? this.canReadPlanDraft
          : capability === 'write' && this.planModeState?.phase === 'research')
      permissionRequest = {
        tool: call.name,
        capability,
        path: target?.path,
        ...(managedPlanDraft ? { managedPlanDraft } : {})
      }
      let verdict = policy.decide(permissionRequest)
      if (verdict.action === 'deny') {
        this.traceEnd(toolTrace, 'blocked')
        pushResult(`Denied: ${verdict.reason}`,
          true,
          ERROR_CODES.permissionDenied
        )
        this.emit({
          type: 'denial_recorded',
          denial: {
            tool: call.name,
            ...(permissionRequest.path ? { path: permissionRequest.path } : {}),
            reason: verdict.reason,
            at: new Date().toISOString()
          }
        })
        return {}
      }
      if (target?.path && target.kind !== 'plan-draft') {
        const local = this.options.resolveLocalInstructions?.({ path: target.path, kind: target.kind })
        if (local && turn.localRuleScopes?.get(local.key) !== local.content) {
          turn.localRuleScopes ??= new Map()
          turn.localRuleScopes.set(local.key, local.content)
          this.traceEnd(toolTrace, 'blocked')
          pushResult(`Local project instructions for ${local.key}:\n${local.content}\nReview them, then retry or revise this operation.`, true)
          return {}
        }
      }
      // §6.3：已批准计划在首次副作用前重查目标与前像；漂移则回到待审，
      // 本次调用不执行任何副作用，也不消耗一次工具批准。
      if (
        this.approvedPlanCheck &&
        !this.approvedPlanCheck.rechecked &&
        capability !== 'read'
      ) {
        const host = this.options.planMode
        const plan = host?.store.current()
        if (host && plan) {
          const check = host.validate(plan)
          if (!check.ok) {
            await this.reopenPlanForApproval(plan, check.drift)
            this.traceEnd(toolTrace, 'blocked')
            pushResult(`Plan drifted before execution: ${describeDrift(check.drift)}`,
              true,
              ERROR_CODES.permissionDenied
            )
            return {}
          }
        }
        this.approvedPlanCheck.rechecked = true
      }
      if (this.planModeState) {
        if (this.planModeState.phase === 'pending' && capability !== 'read') {
          this.traceEnd(toolTrace, 'blocked')
          pushResult('Plan approval pending: only read-only tools may run until the plan is approved',
            true,
            ERROR_CODES.permissionDenied
          )
          this.emit({
            type: 'denial_recorded',
            denial: {
              tool: call.name,
              ...(permissionRequest.path ? { path: permissionRequest.path } : {}),
              reason: 'Plan approval pending',
              at: new Date().toISOString()
            }
          })
          return {}
        }
        // 调研期：底层已准许的只读照常执行，其余非只读一律一次性批准。
        if (this.planModeState.phase === 'research' && capability !== 'read' && !managedPlanDraft) {
          verdict = { action: 'ask', reason: 'Plan mode: this step needs a one-time approval' }
          planModeSingleUse = true
        }
      }
      needsApproval = verdict.action === 'ask'
    }
    // hook 的意见只在硬性审批之外生效：不得绕过 mandatoryApproval（T25）。
    if (preTool?.permissionDecision === 'allow') needsApproval = false
    else if (preTool?.permissionDecision === 'ask') needsApproval = true
    // 不可逆操作的硬性审批：即使档位允许也必须由宿主确认（T25）。
    if (!needsApproval && (handler.mandatoryApproval?.(input) ?? false)) {
      needsApproval = true
    }
    let prepared: PreparedTool | undefined
    let remember = false
    // 本次调用是否经审批通道允许；删除类工具据此确认宿主授权（T25）。
    let approved = false
    if (needsApproval) {
      try {
        prepared = handler.prepareApproval?.(input)
      } catch (error) {
        this.traceEnd(toolTrace, 'error', error)
        pushResult(error instanceof Error ? error.message : 'Could not preview tool operation',
          true,
          typeof (error as { code?: unknown } | null)?.code === 'string'
            ? (error as { code: string }).code
            : undefined
        )
        return {}
      }
      this.setState('awaiting_approval')
      const requestId = randomUUID()
      const request: ApprovalRequest = {
        requestId,
        turnId: turn.id,
        callId: call.id,
        name: call.name,
        summary: handler.describe(input),
        ...(prepared ? { preview: prepared.preview } : {})
      }
      if (permissionRequest) this.approvalForMemory = { id: requestId, target: permissionRequest }
      this.emit({
        type: 'approval_requested',
        turnId: turn.id,
        requestId,
        callId: call.id,
        name: call.name,
        summary: request.summary,
        ...(request.preview ? { preview: request.preview } : {}),
        ...(request.planId !== undefined ? { planId: request.planId } : {}),
        ...(request.planVersion !== undefined ? { planVersion: request.planVersion } : {})
      })
      // SP006 §9：审批等待属于可通知事件，hook 只能旁听、不能改变结局。
      void this.runHook('Notification', {
        notification_type: 'approval_requested',
        message: request.summary
      })
      const decision = await this.requestApproval(turn, request)
      remember =
        decision.outcome === 'allow_session' && !planModeSingleUse && this.canRememberApproval(requestId)
      if (this.approvalForMemory?.id === requestId) this.approvalForMemory = undefined
      this.emit({
        type: 'approval_resolved',
        turnId: turn.id,
        requestId,
        outcome: decision.outcome,
        via: decision.via
      })
      if (decision.outcome !== 'allow' && decision.outcome !== 'allow_session') {
        const feedback =
          decision.feedback && decision.feedback.trim()
            ? `\nUser feedback: ${decision.feedback.trim()}`
            : ''
        this.traceEnd(toolTrace, decision.outcome === 'cancelled' ? 'cancelled' : 'blocked')
        pushResult((decision.outcome === 'cancelled'
            ? `Cancelled: ${call.name}`
            : `Denied by ${decision.via}: ${call.name}`) + feedback,
          true,
          decision.outcome === 'cancelled'
            ? ERROR_CODES.coreApprovalCancelled
            : ERROR_CODES.permissionDenied
        )
        if (decision.outcome === 'deny') {
          this.emit({
            type: 'denial_recorded',
            denial: {
              tool: call.name,
              ...(permissionRequest?.path ? { path: permissionRequest.path } : {}),
              reason: `Denied by ${decision.via}`,
              at: new Date().toISOString()
            }
          })
        }
        return {}
      }
      approved = true
    }
    // 能走到执行即代表本次调用已获授权：审批通道放行，或权限档位自动放行。
    // 出网/删除类工具以 `approved` 确认宿主授权（0.5.4：此前仅审批通道置真，
    // 导致完全权限档位下自动放行的出网调用被工具自设闸门误拒）。
    approved = true
    this.setState('tool_running')
    let content = ''
    let isError = false
    let errorCode: string | undefined
    let startedAt: number | undefined
    try {
      const toolContext: ToolContext = {
        signal: turn.controller.signal,
        changes: (records) => {
          this.writeTranscript({ type: 'change_set', ts: new Date().toISOString(), changes: records })
          this.emit({ type: 'change_set', changes: records })
        },
        turnId: turn.id,
        callId: call.id,
        emit: (event) => this.emit(event),
        approved,
        allowedToolNames: turn.allowedSkillTools ? [...turn.allowedSkillTools] : undefined,
        activateSkill: ({ name, body, allowedTools }) => {
          this.limitSkillTools(turn, allowedTools)
          turn.skillContexts ??= []
          turn.skillContexts.push({ source: `skill:${name}`, content: body })
        },
        ...(this.options.codingTask
          ? {
              onCommandResult: (command: string, result: CommandResult) =>
                this.options.codingTask?.observeCommand(command, result)
            }
          : {})
      }
      if (permissionRequest && policy?.decide(permissionRequest).action === 'deny') {
        this.traceEnd(toolTrace, 'blocked')
        pushResult('Permission changed before execution', true, ERROR_CODES.permissionDenied)
        return {}
      }
      startedAt = performance.now()
      content = await (prepared ? prepared.execute(toolContext) : handler.execute(input, toolContext))
      if (remember && permissionRequest) policy?.remember(permissionRequest)
    } catch (error) {
      content = error instanceof Error ? error.message : 'Tool execution failed'
      isError = true
      // Stable machine readable codes from WorkspaceError survive to the
      // model so it can self-correct (SP003 AC WT-14).
      const candidate = (error as { code?: unknown } | null)?.code
      if (typeof candidate === 'string') errorCode = candidate
      // SP005 FR-06：工具失败必须带稳定错误码，失败位置才能被定位到具体步骤。
      errorCode = errorCode ?? ERROR_CODES.coreToolFailed
    }
    // SP006 §9：PostToolUse 只旁听执行结果，失败走 PostToolUseFailure。
    await this.runHook(isError ? 'PostToolUseFailure' : 'PostToolUse', {
      tool_name: call.name,
      tool_input: input,
      tool_use_id: call.id,
      tool_response: { content, is_error: isError }
    })
    if (content.length > TOOL_OUTPUT_CAP) {
      const notice = `\n[truncated] Tool output exceeded ${TOOL_OUTPUT_CAP} characters.`
      content = sliceToolOutput(content, TOOL_OUTPUT_CAP - notice.length) + notice
    }
    if (startedAt !== undefined) {
      this.lastToolElapsed = { turnId: turn.id, callId: call.id, ms: performance.now() - startedAt }
    }
    // SP005 FR-05：工具空转熔断，分两级。
    // 一级：同一工具 + 同一参数连续失败 —— 完全重复的调用。
    // 二级：同一工具 + 同一错误码连续失败 —— 模型换参数瞎试同一件事，
    //       参数签名变了但错误类型没变，同样不会带来新信息。
    // 两种情况都只会让长任务空转到最大迭代次数，因此必须显式停下并给出稳定原因。
    const signature = this.toolSignature(call.name, call.arguments)
    if (isError) {
      const count = (this.repeatedToolFailures.get(signature) ?? 0) + 1
      this.repeatedToolFailures.set(signature, count)
      const previous = this.toolFailureStreaks.get(call.name)
      const streak = previous && previous.code === errorCode ? previous.count + 1 : 1
      this.toolFailureStreaks.set(call.name, { code: errorCode, count: streak })
      const sameArguments = count >= MAX_REPEATED_TOOL_FAILURES
      const failure =
        sameArguments
          ? `failed ${count} times with the same arguments (${errorCode ?? 'unknown'})`
          : streak >= MAX_TOOL_FAILURE_STREAK
            ? `failed ${streak} times in a row with the same error (${errorCode ?? 'unknown'})`
            : undefined
      if (failure) {
        this.repeatedToolFailures.delete(signature)
        this.toolFailureStreaks.delete(call.name)
        const advice = sameArguments
          ? 'Stop retrying the same arguments and check the failure reason.'
          : 'Switch to a different tool or strategy.'
        const message = `Tool "${call.name}" ${failure}. ${advice} (${ERROR_CODES.coreToolLoopDetected})`
        pushResult(message, true, ERROR_CODES.coreToolLoopDetected, toolTrace)
        this.lastToolElapsed = undefined
        return {
          error: {
            class: 'unknown',
            code: ERROR_CODES.coreToolLoopDetected,
            message,
            retryable: false,
            toolFailure: { callId: call.id, code: errorCode ?? ERROR_CODES.coreToolFailed }
          }
        }
      }
    } else {
      this.repeatedToolFailures.delete(signature)
      this.toolFailureStreaks.delete(call.name)
    }
    try {
      pushResult(content, isError, errorCode, toolTrace)
    } finally {
      this.lastToolElapsed = undefined
    }
    return {}
  }

  /**
   * 稳定的工具调用签名：解析 JSON 后忽略键序与空白，
   * 避免模型换个写法就绕过「同参数空转」检测（SP005 review M5）。
   */
  private toolSignature(name: string, rawArguments: string | undefined): string {
    const raw = rawArguments ?? '{}'
    try {
      return `${name}:${stableStringify(JSON.parse(raw) as unknown)}`
    } catch {
      return `${name}:${raw.trim()}`
    }
  }

  private pushToolResult(
    turn: ActiveTurn,
    callId: string,
    content: string,
    isError: boolean,
    code?: string,
    toolTrace?: TraceHandle
  ): void {
    if (toolTrace) {
      this.tracePayload(toolTrace, 'output', content)
      this.traceEnd(toolTrace, isError ? 'error' : 'success')
    }
    const message: Message = {
      id: randomUUID(),
      role: 'tool',
      blocks: [{ type: 'tool_result', callId, content, isError }]
    }
    turn.messageIds.push(message.id)
    this.messages.push(message)
    this.recordMessage(message)
    // SP005 §5 SR-06：工具步骤落盘，成功与失败分别记录；
    // 未完成的调用保持 needs_review，恢复时只提示核对，绝不重放。
    this.writeTranscript({
      type: 'tool_step',
      ts: new Date().toISOString(),
      turnId: turn.id,
      callId,
      name: this.pendingToolCalls.get(callId)?.name ?? 'unknown',
      status: isError ? 'failed' : 'completed',
      ...(code ? { detail: code } : {})
    })
    this.pendingToolCalls.delete(callId)
    this.emit({
      type: 'tool_result',
      turnId: turn.id,
      callId,
      content: code ? `${content} (${code})` : content,
      isError,
      ...(code ? { errorCode: code } : {})
    })
  }

  private requestApproval(
    turn: ActiveTurn,
    request: ApprovalRequest
  ): Promise<ApprovalDecision> {
    if (turn.controller.signal.aborted) {
      return Promise.resolve({ outcome: 'cancelled', via: 'user' })
    }
    return new Promise<ApprovalDecision>((resolve) => {
      const finish = (decision: ApprovalDecision) => {
        if (this.pendingApproval?.requestId === request.requestId) {
          this.pendingApproval = undefined
        }
        resolve(decision)
      }
      const onAbort = () => {
        if (this.pendingApproval?.requestId === request.requestId) {
          this.pendingApproval = undefined
          resolve({ outcome: 'cancelled', via: 'user' })
        }
      }
      turn.controller.signal.addEventListener('abort', onAbort, { once: true })
      this.pendingApproval = { requestId: request.requestId, resolve: finish }
      this.options.approval.request(request).then(
        (decision) => finish(decision),
        () => finish({ outcome: 'cancelled', via: 'policy' })
      )
    })
  }

  private userMessage(text: string, options?: SubmitOptions): Message {
    const resolved = options?.resolveContext?.()
    for (const notice of resolved?.notices ?? []) {
      this.emit({ type: 'notice', level: 'info', code: 'file_context', text: notice })
    }
    return {
      id: randomUUID(),
      role: 'user',
      blocks: [
        ...(resolved?.context ?? options?.context ?? []).map((entry) => ({
          type: 'context' as const,
          ...entry
        })),
        { type: 'text', text },
        // SP007 MM-07：图片块随用户消息入史，normalize 按能力转 content parts。
        ...(options?.images ?? []).map((image) => ({ type: 'image' as const, ...image }))
      ]
    }
  }

  /**
   * SP007 MM-08：错误驱动降级——从最近一条含图片的 user 消息剥离 image 块
   * （保留 text/context），后续轮该消息无图。返回是否确有移除。
   */
  private stripLatestUserImages(): boolean {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i]
      if (message.role !== 'user') continue
      const before = message.blocks.length
      message.blocks = message.blocks.filter((block) => block.type !== 'image')
      if (message.blocks.length !== before) return true
    }
    return false
  }

  private injectQueued(turn: ActiveTurn): void {
    if (this.queue.length === 0) return
    const items = this.queue.splice(0, this.queue.length)
    for (const item of items) {
      this.limitSkillTools(turn, item.options?.allowedSkillTools)
      const message = this.userMessage(item.text, item.options)
      if (item.notification) message.notificationDisplay = item.notice ?? 'Background task finished'
      turn.messageIds.push(message.id)
      this.messages.push(message)
      this.recordMessage(message)
      this.emit({
        type: 'input_injected',
        turnId: turn.id,
        queueId: item.id,
        text: item.text,
        boundary: 'intra_turn',
        ...(item.notification ? { notification: true } : {}),
        ...(item.notice ? { display: item.notice } : {})
      })
    }
  }

  private limitSkillTools(turn: ActiveTurn, allowed: readonly string[] | undefined): void {
    if (!allowed) return
    const previous = turn.allowedSkillTools
    turn.allowedSkillTools = new Set(previous ? allowed.filter((name) => previous.has(name)) : allowed)
  }

  private canRestore(turn: ActiveTurn): boolean {
    if (this.queue.length > 0) return false
    const assistant = turn.assistant
    if (!assistant) return true
    return !assistant.blocks.some(
      (block) =>
        block.type === 'text' || block.type === 'thinking' || block.type === 'tool_use'
    )
  }

  private finalize(
    turn: ActiveTurn,
    outcome: TurnOutcome,
    error?: ErrorInfo,
    usage?: Usage
  ): void {
    if (turn.finalized) {
      this.emit({
        type: 'notice',
        level: 'warning',
        code: 'late_event_dropped',
        text: 'Ignored an event for an already finalized turn'
      })
      return
    }
    turn.finalized = true
    if (turn.traceRoot) {
      const assistantTexts = this.messages
        .filter((message) => message.role === 'assistant' && turn.messageIds.includes(message.id))
        .map((message) =>
          message.blocks
            .filter((block): block is Extract<Message['blocks'][number], { type: 'text' }> => block.type === 'text')
            .map((block) => block.text)
            .join('')
        )
        .filter((text) => text.length > 0)
      this.tracePayload(
        turn.traceRoot,
        'output',
        assistantTexts.map((content) => ({ role: 'assistant', content }))
      )
    }
    this.options.approval.cancelAll?.()
    this.approvalForMemory = undefined
    for (const listener of this.toolPreviewListeners) listener([])
    if (turn.cancelTimer) clearTimeout(turn.cancelTimer)
    if (this.pendingApproval) {
      this.pendingApproval.resolve({ outcome: 'cancelled', via: 'user' })
      this.pendingApproval = undefined
    }
    // 追问在回合结束时必须收敛，绝不让模型无限等待（§6.4 TP-08）。
    this.pendingQuestionState?.resolve({ status: 'cancelled' })

    let restoreText: string | undefined
    if (outcome === 'cancelled' && this.canRestore(turn)) {
      this.messages.splice(
        0,
        this.messages.length,
        ...this.messages.filter((message) => !turn.messageIds.includes(message.id))
      )
      restoreText = turn.userText
    } else if (outcome === 'cancelled') {
      this.keepCancelArtifacts(turn)
    } else if (outcome === 'error') {
      // A failed turn leaves the conversation untouched, like the 0.1.1
      // preview: the model never sees a prompt it could not answer.
      this.messages.splice(
        0,
        this.messages.length,
        ...this.messages.filter((message) => !turn.messageIds.includes(message.id))
      )
    }

    if (this.activeTurn === turn) this.activeTurn = undefined
    this.setState('idle')
    this.traceEnd(turn.traceRoot, this.traceOutcomeOf(outcome), error)
    // SP005 §5 SR-06：结果未知的工具调用标记为 needs_review，
    // 恢复时只提示人工核对，不会自动重放副作用。
    for (const [callId, pending] of this.pendingToolCalls) {
      if (pending.turnId !== turn.id) continue
      this.writeTranscript({
        type: 'tool_step',
        ts: new Date().toISOString(),
        turnId: turn.id,
        callId,
        name: pending.name,
        status: 'needs_review',
        detail: 'turn ended before the tool result was known'
      })
      this.pendingToolCalls.delete(callId)
    }
    this.writeTranscript({
      type: 'turn',
      ts: new Date().toISOString(),
      turnId: turn.id,
      outcome,
      ...(error ? { error } : {}),
      ...(usage ? { usage } : {})
    })
    this.emit({
      type: 'turn_finalized',
      finishedAt: Date.now(),
      turnId: turn.id,
      outcome,
      ...(error ? { error } : {}),
      ...(restoreText ? { restoreText } : {}),
      // SP005 FR-07：存储写失败与模型失败是两件事，
      // 本轮结果仍然有效，但要明确标出持久化出了问题。
      ...(this.persistenceError ? { persistenceError: this.persistenceError } : {})
    })
    this.persistenceError = undefined
    // SP006 §9：Stop/StopFailure 只旁听回合结局，不改变已交付的结果。
    void this.runHook(outcome === 'completed' ? 'Stop' : 'StopFailure', {
      stop_hook_active: false,
      outcome
    })
    this.scheduleQueueDrain()
  }

  private traceOutcomeOf(outcome: TurnOutcome): 'success' | 'error' | 'cancelled' {
    if (outcome === 'completed') return 'success'
    if (outcome === 'cancelled') return 'cancelled'
    return 'error'
  }

  private keepCancelArtifacts(turn: ActiveTurn): void {
    const assistant = turn.assistant
    if (assistant) {
      if (!this.messages.some((message) => message.id === assistant.id)) {
        this.messages.push(assistant)
        turn.messageIds.push(assistant.id)
      }
      for (const block of assistant.blocks) {
        if (block.type !== 'tool_use') continue
        const hasResult = this.messages.some(
          (message) =>
            message.role === 'tool' &&
            message.blocks.some(
              (entry) => entry.type === 'tool_result' && entry.callId === block.id
            )
        )
        if (!hasResult) {
          this.pushToolResult(
            turn,
            block.id,
            'Tool call was cancelled',
            true,
            ERROR_CODES.coreToolFailed
          )
        }
      }
      assistant.blocks.push({ type: 'interrupt_mark', reason: 'user' })
    }
  }

  private scheduleQueueDrain(): void {
    if (this.queuePaused) return
    if (this.queue.length === 0) return
    if (this.queueTimer) clearTimeout(this.queueTimer)
    const timer = setTimeout(() => {
      this.queueTimer = undefined
      this.drainQueue()
    }, this.options.queueAutostartMs ?? QUEUE_AUTOSTART_MS)
    // Keep the timer referenced: an unref'd timer lets the event loop drain,
    // so queued input would silently never start its own turn.
    this.queueTimer = timer
  }

  private drainQueue(): void {
    if (this.state !== 'idle') return
    const item = this.queue.shift()
    if (!item) return
    void this.startTurn(item.text, item, item.options).catch(() => {})
  }
}
