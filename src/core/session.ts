// Session, turn and event engine (SP002 design §3.2/§3.3, AC SL-01 … SL-08).
// Core owns the behaviour; hosts only subscribe to events.
import { randomUUID } from 'node:crypto'
import {
  CANCEL_BUDGET_MS,
  ERROR_CODES,
  MAX_ITERATIONS,
  MAX_REPEATED_TOOL_FAILURES,
  MAX_TOOL_FAILURE_STREAK,
  QUEUE_AUTOSTART_MS,
  TOOL_OUTPUT_CAP
} from './constants.js'
import type {
  ErrorInfo,
  Message,
  SessionEvent,
  SessionState,
  TurnOutcome,
  TurnSnapshot,
  Usage
} from './events.js'
import { normalizeForApi } from './normalize.js'
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
import type { SessionTranscript, TranscriptRecord } from './transcript.js'
import { appendTranscript } from './session-persistence.js'
import type {
  ChatRequest,
  FinishReason,
  ModelProvider,
  ToolFragment
} from './provider.js'
import { assembleToolCalls, parseToolArguments } from './tool-calls.js'
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
}

type QueuedInput = { id: string; text: string; options?: SubmitOptions }

type ActiveTurn = {
  provider: ModelProvider
  id: string
  controller: AbortController
  finalized: boolean
  userText: string
  messageIds: string[]
  assistant?: Message
  cancelTimer?: NodeJS.Timeout
  /** SP004 agent-observability：本回合根观测句柄。 */
  traceRoot?: TraceHandle
}

const ALLOWED_TRANSITIONS: Record<SessionState, SessionState[]> = {
  idle: ['requesting', 'cancelling'],
  requesting: ['streaming', 'tool_running', 'awaiting_approval', 'cancelling', 'idle'],
  streaming: ['tool_running', 'awaiting_approval', 'requesting', 'cancelling', 'idle'],
  tool_running: ['requesting', 'awaiting_approval', 'cancelling', 'idle'],
  awaiting_approval: ['tool_running', 'requesting', 'cancelling', 'idle'],
  cancelling: ['idle']
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
  /** 会话标识（SP004 §4.4 后台输出与 §6.1 计划文件的隔离键）。 */
  readonly id: string
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
   * SP005 FR-05：同一工具 + 同一参数的连续失败计数。
   * 达到上限后熔断，避免模型在同一个失败调用上空转。
   */
  private readonly repeatedToolFailures = new Map<string, number>()
  /** SP005 FR-05：同一工具 + 同一错误码的连续失败计数（捕捉换参数瞎试）。 */
  private readonly toolFailureStreaks = new Map<string, number>()

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
    this.id = options.id ?? randomUUID()
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
   */
  restoreHistory(messages: readonly Message[]): void {
    this.messages.splice(0, this.messages.length, ...messages)
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
  async exitPlanMode(context: { turnId?: string; callId?: string } = {}): Promise<PlanModeExitResult> {
    const host = this.options.planMode
    const policy = this.options.permissionPolicy
    const state = this.planModeState
    if (!host || !policy) return { ok: false, message: '宿主未提供计划模式集成，无法退出计划模式' }
    if (!state) return { ok: false, message: '当前不在计划模式' }
    if (state.phase === 'pending') return { ok: false, message: '计划审批仍在等待处理，请先批准或拒绝' }
    const text = (await host.readPlanText().catch(() => undefined))?.trim()
    if (!text) return { ok: false, message: '会话计划文件缺失或为空：请先写入计划再退出计划模式' }
    const plan = host.store.current()
    if (!plan) return { ok: false, message: '当前没有计划：请先写入会话计划文件' }
    const drift = host.diff(state.baseline, host.snapshot())
    if (drift.length > 0) {
      return {
        ok: false,
        message: `工作区在研究期间发生漂移，计划未获批准：${describeDrift(drift)}`,
        drift
      }
    }
    if (plan.approval === 'none' || plan.approval === 'rejected') host.store.requestApproval(text)
    state.phase = 'pending'
    this.emit({ type: 'plan_mode_changed', active: true, phase: 'pending', originalMode: state.originalMode })
    const pending = host.store.current() ?? plan
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
      summary: `批准计划：${pending.goal}`,
      preview: text.split('\n').slice(0, 40),
      planId: pending.id,
      planVersion: pending.updatedAt
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
    if (decision.outcome === 'cancelled') {
      state.phase = 'research'
      this.emit({
        type: 'plan_mode_changed',
        active: true,
        phase: 'research',
        originalMode: state.originalMode
      })
      return { ok: false, message: '计划审批已取消，仍停留在调研阶段', cancelled: true }
    }
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
      const feedback = decision.feedback?.trim() ? `：${decision.feedback.trim()}` : ''
      return { ok: false, message: `计划未获批准${feedback}` }
    }
    let approved: Plan
    try {
      approved = host.store.approve(decision.editedText?.trim() ? decision.editedText : text)
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
      edited: !!decision.editedText
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
    const trimmed = text.trim()
    if (!trimmed) return
    if (this.state !== 'idle') {
      const item: QueuedInput = { id: randomUUID(), text: trimmed, ...(options ? { options } : {}) }
      this.queue.push(item)
      this.emit({ type: 'input_queued', queueId: item.id, preview: previewOf(trimmed) })
      return
    }
    void this.startTurn(trimmed, undefined, options).catch((error) => {
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
    if (this.activeTurn) this.activeTurn.controller.abort()
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
        boundary: 'inter_turn'
      })
    }
    const snapshot = this.options.resolveSnapshot()
    this.emit({ type: 'turn_started', turnId: turn.id, snapshot, userText, startedAt: Date.now() })
    this.setState('requesting')
    const userMessage = this.userMessage(userText, options)
    turn.messageIds.push(userMessage.id)
    this.messages.push(userMessage)
    this.recordMessage(userMessage)
    await this.runTurn(turn, snapshot)
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
  private recordMessage(message: Message, parentId?: string): void {
    if (!this.options.transcript) return
    this.writeTranscript({
      type: 'message',
      ts: new Date().toISOString(),
      id: message.id,
      ...(parentId ? { parentId } : {}),
      role: message.role,
      blocks: message.blocks
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
    return items
  }

  /**
   * SP005 §4：按预算压缩上下文。
   * 压缩保留用户约束、已批准计划与未完成工具状态；连续失败达到熔断上限
   * 时停止压缩并交给调用方明确报错（CB-06）。
   */
  private compactIfNeeded(turn: ActiveTurn): { messages: Message[]; compacted: boolean } {
    const budget = this.budget
    if (!budget) return { messages: this.messages, compacted: false }
    const shape = normalizeBudget(
      this.options.contextBudget?.maxTokens ?? 0,
      this.options.contextBudget?.reservedOutputTokens
    )
    const estimate = budget.estimate({ messages: this.messages, ...shape })
    // 触发阈值取自 context-budget 的单一常量，避免与 /context 展示的数字不一致。
    const trigger = triggerTokens({ messages: this.messages, ...shape })
    if (estimate <= trigger) {
      this.compactionFailures = 0
      return { messages: this.messages, compacted: false }
    }
    if (this.compactionFailures >= COMPACTION_CIRCUIT_LIMIT) {
      this.emit({
        type: 'notice',
        level: 'error',
        code: 'context_overflow',
        text: `context compaction stopped after ${this.compactionFailures} consecutive failures`
      })
      return { messages: this.messages, compacted: false }
    }
    const preserved = this.preservedItems()
    const result = budget.compact({ messages: this.messages, ...shape }, preserved)
    if (!result.compacted) {
      this.compactionFailures++
      this.emit({
        type: 'notice',
        level: 'error',
        code: 'context_overflow',
        text: `context is over the budget and cannot be compacted (${result.overflowReason ?? 'unknown'})`
      })
      return { messages: this.messages, compacted: false }
    }
    this.compactionFailures = 0
    if (!result.withinBudget) {
      // 压缩后仍然超预算时明确报出，不静默把超限请求发出去。
      this.emit({
        type: 'notice',
        level: 'error',
        code: 'context_overflow',
        text: `context is still over the budget after compaction (${result.overflowReason ?? 'unknown'})`
      })
    }
    this.applyCompaction(turn, result, estimate)
    return { messages: result.messages, compacted: true }
  }

  /**
   * 把一次压缩同时写回会话内存与转录（SP005 review H5）。
   * 只写内存会让跨进程恢复退回压缩前的历史，等于把压缩静默撤销。
   */
  private applyCompaction(turn: ActiveTurn, result: CompactionResult, estimatedBefore: number): void {
    this.messages.splice(0, this.messages.length, ...result.messages)
    this.emit({
      type: 'context_compacted',
      turnId: turn.id,
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
      turnId: turn.id,
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
    this.applyCompaction(turn, result, estimatedBefore)
    return true
  }

  private buildRequest(snapshot: TurnSnapshot, turn: ActiveTurn): ChatRequest {
    const budgeted = this.compactIfNeeded(turn)
    const source = budgeted.messages
    const request: ChatRequest = {
      model: snapshot.model,
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
    request.messages.unshift({
      role: 'system',
      content: '你是 budingx，一款在终端运行的编程助手。用户询问你的身份时，介绍 budingx。' +
        '用户询问底层模型时，按本次请求配置的模型 ID 回答：' + snapshot.model +
        '。根据本轮实际提供的工具说明能力，使用用户的语言回答。'
    })
    if (this.tools.length > 0 && snapshot.capabilities.tools) {
      request.tools = this.tools.map((tool) => ({
        name: tool.name,
        parameters: tool.parameters ?? { type: 'object', properties: {} },
        description: tool.summary ?? tool.describe({})
      }))
    }
    return request
  }

  private async runTurn(turn: ActiveTurn, snapshot: TurnSnapshot): Promise<void> {
    const maxIterations = this.options.maxIterations ?? MAX_ITERATIONS
    let outcome: TurnOutcome = 'unknown'
    let error: ErrorInfo | undefined
    let usage: Usage | undefined
    let iteration = 0
    // SP005 FR-08：上下文溢出后最多再试一次（先压缩再重试）。
    let overflowRetried = false
    // 熔断计数只在一个回合内有效：跨回合累积会让不相关的失败把后续回合误判成空转。
    this.repeatedToolFailures.clear()
    this.toolFailureStreaks.clear()

    while (iteration < maxIterations) {
      iteration++
      if (turn.controller.signal.aborted) {
        outcome = 'cancelled'
        break
      }
      if (iteration > 1) this.injectQueued(turn)
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

      try {
        for await (const event of turn.provider.stream(
          this.buildRequest(snapshot, turn)
        )) {
          if (turn.finalized) break
          switch (event.type) {
            case 'text_delta':
              assistant.blocks.push({ type: 'text', text: event.text })
              this.emit({
                type: 'text_delta',
                turnId: turn.id,
                messageId: assistant.id,
                text: event.text
              })
              this.setState('streaming')
              break
            case 'thinking_delta':
              assistant.blocks.push({ type: 'thinking', text: event.text })
              this.emit({
                type: 'thinking_delta',
                turnId: turn.id,
                messageId: assistant.id,
                text: event.text
              })
              break
            case 'tool_call_delta':
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
        } else {
          outcome = 'error'
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
        this.recordMessage(assistant)
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
        const claim = this.options.codingTask?.canClaimDone()
        if (claim && !claim.ok && this.options.codingTask?.get()) {
          const reason = claim.reason ?? '未运行测试'
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
    for (const call of calls) {
      if (turn.controller.signal.aborted) return { cancelled: true }
      try {
        JSON.parse(call.arguments || '{}')
      } catch {
        this.pushToolResult(
          turn,
          call.id,
          'Tool arguments are not valid JSON',
          true,
          ERROR_CODES.providerToolArgumentsInvalid
        )
        continue
      }
      const input = parseToolArguments(call)
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
        this.pushToolResult(
          turn,
          call.id,
          `Unknown tool: ${call.name}`,
          true,
          ERROR_CODES.coreToolUnknown
        )
        continue
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
        permissionRequest = {
          tool: call.name,
          capability: handler.capability?.(input) ?? 'read',
          path: handler.target?.(input)?.path
        }
        let verdict = policy.decide(permissionRequest)
        const capability = permissionRequest.capability
        if (verdict.action === 'deny') {
          this.traceEnd(toolTrace, 'blocked')
          this.pushToolResult(
            turn,
            call.id,
            `Denied: ${verdict.reason}`,
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
          continue
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
              this.pushToolResult(
                turn,
                call.id,
                `Plan drifted before execution: ${describeDrift(check.drift)}`,
                true,
                ERROR_CODES.permissionDenied
              )
              continue
            }
          }
          this.approvedPlanCheck.rechecked = true
        }
        if (this.planModeState) {
          if (this.planModeState.phase === 'pending' && capability !== 'read') {
            this.traceEnd(toolTrace, 'blocked')
            this.pushToolResult(
              turn,
              call.id,
              'Plan approval pending: only read-only tools may run until the plan is approved',
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
            continue
          }
          // 调研期：底层已准许的只读照常执行，其余非只读一律一次性批准。
          if (this.planModeState.phase === 'research' && capability !== 'read') {
            verdict = { action: 'ask', reason: 'Plan mode: this step needs a one-time approval' }
            planModeSingleUse = true
          }
        }
        needsApproval = verdict.action === 'ask'
      }
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
          this.pushToolResult(
            turn,
            call.id,
            error instanceof Error ? error.message : 'Could not preview tool operation',
            true,
            typeof (error as { code?: unknown } | null)?.code === 'string'
              ? (error as { code: string }).code
              : undefined
          )
          continue
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
          this.pushToolResult(
            turn,
            call.id,
            (decision.outcome === 'cancelled'
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
          continue
        }
        approved = true
      }
      this.setState('tool_running')
      let content = ''
      let isError = false
      let errorCode: string | undefined
      let startedAt: number | undefined
      try {
        const toolContext: ToolContext = {
          signal: turn.controller.signal,
          changes: (records) => this.emit({ type: 'change_set', changes: records }),
          turnId: turn.id,
          callId: call.id,
          emit: (event) => this.emit(event),
          approved,
          ...(this.options.codingTask
            ? {
                onCommandResult: (command: string, result: CommandResult) =>
                  this.options.codingTask?.observeCommand(command, result)
              }
            : {})
        }
        if (permissionRequest && policy?.decide(permissionRequest).action === 'deny') {
          this.traceEnd(toolTrace, 'blocked')
          this.pushToolResult(turn, call.id, 'Permission changed before execution', true, ERROR_CODES.permissionDenied)
          continue
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
      if (content.length > TOOL_OUTPUT_CAP) {
        // SP005 FR-03：截断必须带显式标记，模型与人都能看出结果不完整，
        // 不能把一段被砍掉的内容当成完整结果。
        const omitted = content.length - TOOL_OUTPUT_CAP
        content = content.slice(0, TOOL_OUTPUT_CAP) +
          `\n[truncated] ${omitted} characters were omitted because the tool output exceeded ` +
          `${TOOL_OUTPUT_CAP} characters (${ERROR_CODES.coreToolOutputTooLong})`
        isError = true
        errorCode = errorCode ?? ERROR_CODES.coreToolOutputTooLong
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
      const streakKey = `${call.name}:${errorCode ?? 'unknown'}`
      if (isError) {
        const count = (this.repeatedToolFailures.get(signature) ?? 0) + 1
        this.repeatedToolFailures.set(signature, count)
        const streak = (this.toolFailureStreaks.get(streakKey) ?? 0) + 1
        this.toolFailureStreaks.set(streakKey, streak)
        const tripped =
          count >= MAX_REPEATED_TOOL_FAILURES
            ? `failed ${count} times with the same arguments`
            : streak >= MAX_TOOL_FAILURE_STREAK
              ? `failed ${streak} times in a row with the same error (${errorCode ?? 'unknown'})`
              : undefined
        if (tripped) {
          this.repeatedToolFailures.delete(signature)
          this.toolFailureStreaks.delete(streakKey)
          this.traceEnd(toolTrace, 'error')
          this.pushToolResult(
            turn,
            call.id,
            `Tool "${call.name}" ${tripped}; retrying it again cannot add information. ` +
              `Stop and report the reason instead. (${ERROR_CODES.coreToolLoopDetected})`,
            true,
            ERROR_CODES.coreToolLoopDetected
          )
          return {
            error: {
              class: 'unknown',
              code: ERROR_CODES.coreToolLoopDetected,
              message:
                `Tool "${call.name}" ${tripped} ` +
                `(${ERROR_CODES.coreToolLoopDetected})`,
              retryable: false
            }
          }
        }
      } else {
        this.repeatedToolFailures.delete(signature)
        this.toolFailureStreaks.delete(streakKey)
      }
      try {
        this.pushToolResult(turn, call.id, content, isError, errorCode, toolTrace)
      } finally {
        this.lastToolElapsed = undefined
      }
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
      isError
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
        { type: 'text', text }
      ]
    }
  }

  private injectQueued(turn: ActiveTurn): void {
    if (this.queue.length === 0) return
    const items = this.queue.splice(0, this.queue.length)
    for (const item of items) {
      const message = this.userMessage(item.text, item.options)
      turn.messageIds.push(message.id)
      this.messages.push(message)
      this.emit({
        type: 'input_injected',
        turnId: turn.id,
        queueId: item.id,
        text: item.text,
        boundary: 'intra_turn'
      })
    }
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
