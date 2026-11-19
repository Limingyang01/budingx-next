// Session, turn and event engine (SP002 design §3.2/§3.3, AC SL-01 … SL-08).
// Core owns the behaviour; hosts only subscribe to events.
import { randomUUID } from 'node:crypto'
import {
  CANCEL_BUDGET_MS,
  ERROR_CODES,
  MAX_ITERATIONS,
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
    this.options.permissionPolicy?.onModeChanged?.((mode: PermissionMode) => {
      this.emit({ type: 'permission_changed', mode })
    })
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
    if (plan.approval === 'approved') {
      return { ok: false, message: '旧计划已获批准：请用 WritePlan 写入新草稿再申请审批' }
    }
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
      planVersion: pending.updatedAt,
      planText: text
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

  commandFinished(event: Extract<SessionEvent, { type: 'command_finished' }>): void {
    this.emit(event)
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
    await this.runTurn(turn, snapshot)
  }

  private buildRequest(snapshot: TurnSnapshot, turn: ActiveTurn): ChatRequest {
    const request: ChatRequest = {
      model: snapshot.model,
      messages: normalizeForApi(this.messages, turn.provider.preserveToolReasoning?.(snapshot.model)
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
        if (providerFailure.class === 'aborted' || turn.controller.signal.aborted) {
          outcome = 'cancelled'
        } else {
          outcome = 'error'
          error = providerFailure
        }
        break
      }

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
        const codingTask = this.options.codingTask?.get()
        if (claim && !claim.ok && codingTask) {
          if (codingTask.lastTest?.errorCode === ERROR_CODES.execSandboxUnavailable) {
            outcome = 'error'
            error = {
              class: 'tool_unsupported',
              code: ERROR_CODES.execSandboxUnavailable,
              message: '当前没有已验证的执行隔离后端，无法运行测试或证明编码任务完成。',
              retryable: false
            }
            break
          }
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

    this.finalize(turn, outcome, error)
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
      this.emit({
        type: 'tool_call_completed',
        turnId: turn.id,
        callId: call.id,
        name: call.name,
        input
      })
      if (!handler) {
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
      const explicitApproval = handler.requiresExplicitApproval?.(input) ?? false
      let needsApproval = explicitApproval || (handler.requiresApproval?.(input) ?? false)
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
        needsApproval = explicitApproval || verdict.action === 'ask'
      }
      let prepared: PreparedTool | undefined
      let remember = false
      if (needsApproval) {
        try {
          prepared = await handler.prepareApproval?.(input)
        } catch (error) {
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
        if (permissionRequest && !explicitApproval) {
          this.approvalForMemory = { id: requestId, target: permissionRequest }
        }
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
        const accepted = explicitApproval
          ? decision.outcome === 'allow' && decision.via === 'user'
          : decision.outcome === 'allow' || decision.outcome === 'allow_session'
        if (!accepted) {
          const feedback =
            decision.feedback && decision.feedback.trim()
              ? `\nUser feedback: ${decision.feedback.trim()}`
              : ''
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
          onCommandResult: (command: string, result: CommandResult) => {
            this.options.codingTask?.observeCommand(command, result)
            if (result.outcome !== 'completed' && result.outcome !== 'running') {
              isError = true
              errorCode = result.errorCode ?? ERROR_CODES.coreToolFailed
            }
          }
        }
        if (permissionRequest && policy?.decide(permissionRequest).action === 'deny') {
          this.pushToolResult(turn, call.id, 'Permission changed before execution', true, ERROR_CODES.permissionDenied)
          continue
        }
        startedAt = performance.now()
        content = await (prepared ? prepared.execute(toolContext) : handler.execute(input, toolContext))
        if (!isError && remember && permissionRequest) policy?.remember(permissionRequest)
      } catch (error) {
        content = error instanceof Error ? error.message : 'Tool execution failed'
        isError = true
        // Stable machine readable codes from WorkspaceError survive to the
        // model so it can self-correct (SP003 AC WT-14).
        const candidate = (error as { code?: unknown } | null)?.code
        if (typeof candidate === 'string') errorCode = candidate
      }
      if (content.length > TOOL_OUTPUT_CAP) {
        content = content.slice(0, TOOL_OUTPUT_CAP)
        isError = true
      }
      if (startedAt !== undefined) {
        this.lastToolElapsed = { turnId: turn.id, callId: call.id, ms: performance.now() - startedAt }
      }
      try {
        this.pushToolResult(turn, call.id, content, isError, errorCode)
      } finally {
        this.lastToolElapsed = undefined
      }
    }
    return {}
  }

  private pushToolResult(
    turn: ActiveTurn,
    callId: string,
    content: string,
    isError: boolean,
    code?: string
  ): void {
    const message: Message = {
      id: randomUUID(),
      role: 'tool',
      blocks: [{ type: 'tool_result', callId, content, isError }]
    }
    turn.messageIds.push(message.id)
    this.messages.push(message)
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

  private finalize(turn: ActiveTurn, outcome: TurnOutcome, error?: ErrorInfo): void {
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
    this.emit({
      type: 'turn_finalized',
      finishedAt: Date.now(),
      turnId: turn.id,
      outcome,
      ...(error ? { error } : {}),
      ...(restoreText ? { restoreText } : {})
    })
    this.scheduleQueueDrain()
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
