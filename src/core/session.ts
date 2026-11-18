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
import type {
  PermissionMode,
  PermissionPolicy,
  PermissionRequest
} from './permissions.js'

export type SessionOptions = {
  provider: ModelProvider
  resolveProvider?: () => ModelProvider
  approval: ApprovalGateway
  resolveSnapshot: () => TurnSnapshot
  tools?: ToolHandler[]
  /** SP003: when present, tool calls are decided by the policy. */
  permissionPolicy?: PermissionPolicy
  maxIterations?: number
  cancelBudgetMs?: number
  queueAutostartMs?: number
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

export class Session {
  private state: SessionState = 'idle'
  private readonly messages: Message[] = []
  private readonly reasoningSource = new WeakMap<Message, TurnSnapshot>()
  private readonly listeners = new Set<(event: SessionEvent) => void>()
  private readonly tools: ToolHandler[]
  private readonly queue: QueuedInput[] = []
  private activeTurn?: ActiveTurn
  private pendingApproval?: { requestId: string; resolve: (d: ApprovalDecision) => void }
  private queueTimer?: NodeJS.Timeout
  private queuePaused = false

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
    this.tools = options.tools ?? []
    this.options.permissionPolicy?.onModeChanged?.((mode: PermissionMode) => {
      this.emit({ type: 'permission_changed', mode })
    })
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
    if (this.activeTurn) this.activeTurn.controller.abort()
    this.listeners.clear()
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
        outcome = finishReason === 'length' ? 'length_capped' : 'completed'
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
      let needsApproval = handler.requiresApproval?.(input) ?? false
      let permissionRequest: PermissionRequest | undefined
      if (policy) {
        permissionRequest = {
          tool: call.name,
          capability: handler.capability?.(input) ?? 'read',
          path: handler.target?.(input)?.path
        }
        const verdict = policy.decide(permissionRequest)
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
        needsApproval = verdict.action === 'ask'
      }
      let prepared: PreparedTool | undefined
      let remember = false
      if (needsApproval) {
        try {
          prepared = handler.prepareApproval?.(input)
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
        this.emit({
          type: 'approval_requested',
          turnId: turn.id,
          requestId,
          callId: call.id,
          name: call.name,
          summary: request.summary,
          ...(request.preview ? { preview: request.preview } : {})
        })
        const decision = await this.requestApproval(turn, request)
        remember = decision.outcome === 'allow_session'
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
      try {
        const toolContext: ToolContext = {
          signal: turn.controller.signal,
          changes: (records) => this.emit({ type: 'change_set', changes: records }),
          turnId: turn.id
        }
        if (permissionRequest && policy?.decide(permissionRequest).action === 'deny') {
          this.pushToolResult(turn, call.id, 'Permission changed before execution', true, ERROR_CODES.permissionDenied)
          continue
        }
        content = await (prepared ? prepared.execute(toolContext) : handler.execute(input, toolContext))
        if (remember && permissionRequest) policy?.remember(permissionRequest)
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
      this.pushToolResult(turn, call.id, content, isError, errorCode)
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
    if (turn.cancelTimer) clearTimeout(turn.cancelTimer)
    if (this.pendingApproval) {
      this.pendingApproval.resolve({ outcome: 'cancelled', via: 'user' })
      this.pendingApproval = undefined
    }

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
