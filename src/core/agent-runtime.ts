// Subagent runtime (SP007 design §4.1, AC SA-03…10/14/16).
//
// Each subagent is an independent Session with its own history, trimmed
// tools and a permission policy that can never exceed the parent's mode.
// Core stays IO-free: the child policy factory and the sidechain transcript
// are host-injected ports (D14). The registry is deliberately separate from
// the background-command TaskRegistry (SA-14).
import { randomUUID } from 'node:crypto'
import { Session, type SessionOptions } from './session.js'
import type { AgentDefinition } from './agent-definitions.js'
import type { ErrorInfo, TurnOutcome, TurnSnapshot } from './events.js'
import type { ModelProvider } from './provider.js'
import type { PermissionMode, PermissionPolicy } from './permissions.js'
import { sliceToolOutput } from './tools.js'
import type { ApprovalDecision, ApprovalGateway, ApprovalRequest, ToolHandler } from './tools.js'
import type { SessionTranscript } from './transcript.js'

/** Global concurrency gate for running subagents (reference default). */
export const MAX_CONCURRENT_AGENTS = 10
/** 旧版子代理默认迭代上限（0.9.1 起不再作为默认；保留导出兼容历史引用）。 */
export const SUBAGENT_MAX_TURNS = 30
/** 旧版子代理默认 token 预算（0.9.1 起不再作为默认；保留导出兼容历史引用）。 */
export const SUBAGENT_TOKEN_LIMIT = 100_000
/** Final-answer character cap; longer results are truncated with a note. */
export const AGENT_RESULT_CHAR_LIMIT = 100_000

/** Tools a subagent may never call, regardless of its definition. */
const ALWAYS_DENY = ['Agent', 'TaskOutput', 'TaskStop', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode']
/** Background agents cannot ask the user, so only unattended-safe tools remain. */
const BACKGROUND_ALLOWED = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Bash', 'PowerShell', 'Write', 'Edit', 'TodoWrite', 'Skill']

const MODE_RANK: Record<PermissionMode, number> = { read_only: 0, workspace_edit: 1, full_access: 2 }
const DIAGNOSTIC_TOOL_LIMIT = 3
const DIAGNOSTIC_TEXT_LIMIT = 800

type ToolDiagnostic = {
  name: string
  arguments: string
  output: string
  errorCode?: string
}

export type AgentState = 'running' | 'completed' | 'failed' | 'cancelled' | 'backgrounded'

export interface AgentRecord {
  agentId: string
  parentSessionId: string
  agentType: string
  description: string
  color?: string
  callId: string
  turnId: string
  state: AgentState
  background: boolean
  toolUses: number
  tokens: number
  /** Last three tool names, for the progress card. */
  lastTools: string[]
  startedAt: number
  finishedAt?: number
  /** Final answer text (truncated, without the usage footer). */
  result?: string
  error?: string
  notified: boolean
  stopped: boolean
  session: Session
}

export type AgentSpawnResult =
  | { status: 'async_launched'; agentId: string; outputFile?: string }
  | {
      status: 'completed' | 'max_turns'
      agentId: string
      text: string
      toolUses: number
      tokens: number
      durationMs: number
    }
  | {
      status: 'failed' | 'cancelled' | 'budget'
      agentId: string
      text: string
      code: 'AGENT_FAILED' | 'AGENT_CANCELLED' | 'AGENT_BUDGET'
      toolUses: number
      tokens: number
      durationMs: number
    }

export interface SpawnAgentOptions {
  definition: AgentDefinition
  prompt: string
  description: string
  callId: string
  turnId: string
  model?: string
  maxTurns?: number
  runInBackground?: boolean
  /** Sync agents abort with the parent turn; background agents survive it. */
  parentSignal?: AbortSignal
  allowedToolNames?: readonly string[]
}

export interface AgentRegistryOptions {
  parentSession: Session
  /** Parent tool table (live reference); children receive trimmed copies. */
  tools: readonly ToolHandler[]
  provider: ModelProvider
  resolveProvider?: () => ModelProvider
  resolveSnapshot: () => TurnSnapshot
  approval: ApprovalGateway
  policy: PermissionPolicy
  /** Host port (D14): fresh isolated policy at the capped mode. */
  createChildPolicy: (mode: PermissionMode) => PermissionPolicy
  /** Host port (D14): sidechain JSONL transcript for one subagent. */
  createTranscript?: (agentId: string) => (SessionTranscript & { outputFile?: string }) | undefined
  /** Environment details (cwd/platform/date) appended to the agent prompt. */
  environment?: string
  contextBudget?: { maxTokens: number; reservedOutputTokens?: number }
  maxConcurrent?: number
  tokenLimit?: number
  resultCharLimit?: number
  redactDiagnostic?: (value: unknown) => unknown
  resolveProjectContext?: () => string | undefined
  resolveLocalInstructions?: SessionOptions['resolveLocalInstructions']
}

export interface TaskOutputResult {
  status: 'completed' | 'failed' | 'cancelled' | 'running'
  text?: string
  message?: string
}

export interface AgentRegistry {
  spawn(options: SpawnAgentOptions): Promise<AgentSpawnResult>
  /** Convert a running sync agent to background (ctrl+b); resolves its wait. */
  background(callId: string): boolean
  stop(agentId: string): { ok: boolean; state?: AgentState }
  taskOutput(agentId: string, options?: { block?: boolean; timeoutMs?: number }): Promise<TaskOutputResult>
  list(): AgentRecord[]
  get(agentId: string): AgentRecord | undefined
  dispose(): void
}

interface AgentInternal {
  budgetExceeded: boolean
  finished: boolean
  deferred: { promise: Promise<AgentSpawnResult>; resolve: (result: AgentSpawnResult) => void }
  terminal: { promise: Promise<void>; resolve: () => void }
  detachParentSignal: () => void
  outputFile?: string
}

function isTerminal(record: AgentRecord): boolean {
  return record.state === 'completed' || record.state === 'failed' || record.state === 'cancelled'
}

function minMode(a: PermissionMode, b: PermissionMode): PermissionMode {
  return MODE_RANK[a] <= MODE_RANK[b] ? a : b
}

function trimTools(tools: readonly ToolHandler[], definition: AgentDefinition, background: boolean): ToolHandler[] {
  const deny = new Set(ALWAYS_DENY)
  for (const name of definition.disallowedTools ?? []) deny.add(name)
  return tools.filter((tool) => {
    if (deny.has(tool.name)) return false
    if (background && !BACKGROUND_ALLOWED.includes(tool.name) && !tool.name.startsWith('mcp__')) return false
    if (definition.tools && !definition.tools.includes(tool.name)) return false
    return true
  })
}

/** Last assistant text, walking back over tool-only messages (reference behaviour). */
function finalTextOf(session: Session): string {
  const history = session.history
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index]
    if (!message || message.role !== 'assistant') continue
    const text = message.blocks
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()
    if (text) return text
  }
  return ''
}

function escapeXmlText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function createAgentRegistry(options: AgentRegistryOptions): AgentRegistry {
  const records = new Map<string, AgentRecord>()
  const internals = new Map<string, AgentInternal>()
  const byCallId = new Map<string, AgentRecord>()
  const maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT_AGENTS
  // SP009 0.9.1：对齐参考仓——子代理默认无 token 预算上限，不再因预算中断；
  // 仅当显式传入 tokenLimit 时才设预算（保留可选能力）。
  const tokenLimit = options.tokenLimit ?? Number.POSITIVE_INFINITY
  const resultLimit = options.resultCharLimit ?? AGENT_RESULT_CHAR_LIMIT
  let running = 0
  let disposed = false
  const waiters: { resolve: () => void; reject: (error: Error) => void; signal?: AbortSignal; onAbort?: () => void }[] = []

  function diagnosticText(value: unknown): string {
    try {
      const safe = options.redactDiagnostic ? options.redactDiagnostic(value) : value
      const text = typeof safe === 'string' ? safe : (JSON.stringify(safe) ?? '')
      return sliceToolOutput(text, DIAGNOSTIC_TEXT_LIMIT)
    } catch {
      return '(diagnostic unavailable)'
    }
  }

  // Sync agents share the parent approval gateway, but only one approval may
  // be on screen at a time: parallel agents queue behind each other.
  let approvalChain: Promise<unknown> = Promise.resolve()
  const serializedApproval: ApprovalGateway = {
    request(request: ApprovalRequest): Promise<ApprovalDecision> {
      const run = approvalChain.then(() => options.approval.request(request))
      approvalChain = run.catch(() => undefined)
      return run
    }
  }

  function acquire(signal?: AbortSignal): Promise<void> {
    if (disposed) return Promise.reject(new Error('agent registry disposed'))
    if (signal?.aborted) return Promise.reject(new Error('aborted'))
    if (running < maxConcurrent) {
      running++
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: { resolve: () => void; reject: (error: Error) => void; signal?: AbortSignal; onAbort?: () => void } = { resolve, reject, signal }
      if (signal) {
        waiter.onAbort = () => {
          const index = waiters.indexOf(waiter)
          if (index >= 0) waiters.splice(index, 1)
          reject(new Error('aborted'))
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      waiters.push(waiter)
    })
  }

  function release(): void {
    const waiter = waiters.shift()
    if (waiter) {
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort)
      waiter.resolve()
    } else {
      running = Math.max(0, running - 1)
    }
  }

  async function spawn(spawnOptions: SpawnAgentOptions): Promise<AgentSpawnResult> {
    const { definition, prompt, description, callId, turnId } = spawnOptions
    const background = spawnOptions.runInBackground === true || definition.background === true
    const agentId = randomUUID()
    try {
      await acquire(spawnOptions.parentSignal)
    } catch {
      return {
        status: 'cancelled', agentId, text: 'Subagent was cancelled before launch.',
        code: 'AGENT_CANCELLED', toolUses: 0, tokens: 0, durationMs: 0
      }
    }

    const modelOverride =
      spawnOptions.model ?? (definition.model && definition.model !== 'inherit' ? definition.model : undefined)
    const childTools = trimTools(options.tools, definition, background).filter(
      (tool) => !spawnOptions.allowedToolNames || spawnOptions.allowedToolNames.includes(tool.name)
    )
    const parentMode = options.policy.getMode()
    const childPolicy = options.createChildPolicy(minMode(parentMode, definition.permissionMode ?? parentMode))
    const transcript = options.createTranscript?.(agentId)
    const systemContext =
      `You are a budingx subagent (type: ${definition.name}). Complete the delegated task using the ` +
      `available tools, then reply with a concise final answer for the parent agent. Do not ask the user questions.\n\n` +
      definition.body +
      (options.environment ? `\n\nEnvironment:\n${options.environment}` : '')

    const record: AgentRecord = {
      agentId,
      parentSessionId: options.parentSession.id,
      agentType: definition.name,
      description,
      ...(definition.color ? { color: definition.color } : {}),
      callId,
      turnId,
      state: 'running',
      background,
      toolUses: 0,
      tokens: 0,
      lastTools: [],
      startedAt: Date.now(),
      notified: false,
      stopped: false,
      session: undefined as unknown as Session
    }

    let resolveDeferred!: (result: AgentSpawnResult) => void
    const deferredPromise = new Promise<AgentSpawnResult>((resolve) => { resolveDeferred = resolve })
    let resolveTerminal!: () => void
    const terminalPromise = new Promise<void>((resolve) => { resolveTerminal = resolve })
    const internal: AgentInternal = {
      budgetExceeded: false,
      finished: false,
      deferred: { promise: deferredPromise, resolve: resolveDeferred },
      terminal: { promise: terminalPromise, resolve: resolveTerminal },
      detachParentSignal: () => {},
      ...(transcript?.outputFile ? { outputFile: transcript.outputFile } : {})
    }

    const childApproval: ApprovalGateway = {
      request(request: ApprovalRequest): Promise<ApprovalDecision> {
        if (record.background || record.stopped) {
          return Promise.resolve({
            outcome: 'deny',
            via: 'policy',
            feedback: 'Background subagents cannot request interactive approval.'
          })
        }
        return serializedApproval.request(request)
      }
    }

    const child = new Session({
      provider: options.resolveProvider?.() ?? options.provider,
      ...(options.resolveProvider ? { resolveProvider: options.resolveProvider } : {}),
      approval: childApproval,
      resolveSnapshot: () => {
        const parent = options.resolveSnapshot()
        return modelOverride ? { ...parent, model: modelOverride, modelId: modelOverride } : parent
      },
      tools: childTools,
      id: agentId,
      permissionPolicy: childPolicy,
      // SP009 0.9.1 LF-03：对齐参考仓常规子代理 `maxTurns ?? definition.maxTurns`，
      // 不再硬编码默认迭代上限；未显式设置时子代理与主循环一样无迭代上限，
      // 由失败熔断 / token 预算 / 父信号中断承担安全网。
      maxIterations: spawnOptions.maxTurns ?? definition.maxTurns,
      ...(transcript ? { transcript } : {}),
      ...(options.contextBudget ? { contextBudget: options.contextBudget } : {}),
      resolveSystemContext: () => [systemContext, options.resolveProjectContext?.()].filter(Boolean).join('\n\n'),
      resolveLocalInstructions: options.resolveLocalInstructions,
      disposers: [() => { internal.detachParentSignal(); unsubscribe() }]
    })
    record.session = child
    records.set(agentId, record)
    internals.set(agentId, internal)
    byCallId.set(callId, record)

    function publishProgress(): void {
      if (internal.finished) return
      options.parentSession.publishAgentEvent({
        type: 'agent_progress',
        agentId,
        toolUses: record.toolUses,
        tokens: record.tokens,
        lastTools: [...record.lastTools],
        state: record.state === 'backgrounded' ? 'backgrounded' : 'running'
      })
    }

    const pendingTools = new Map<string, { name: string; input: unknown }>()
    const completedTools: ToolDiagnostic[] = []
    const failedTools = new Map<string, ToolDiagnostic>()

    function finish(outcome: TurnOutcome, errorInfo?: ErrorInfo): void {
      if (internal.finished) return
      internal.finished = true
      record.finishedAt = Date.now()
      const durationMs = record.finishedAt - record.startedAt
      const plain = finalTextOf(child)
      const truncated = plain.length > resultLimit
        ? plain.slice(0, resultLimit) + `\n\n[truncated: result exceeded ${resultLimit} characters]`
        : plain
      record.result = truncated || '(subagent produced no text output)'

      let result: AgentSpawnResult
      if (internal.budgetExceeded) {
        record.state = 'cancelled'
        record.error = 'token budget exceeded'
        result = { status: 'budget', agentId, text: 'Subagent stopped: token budget exceeded.', code: 'AGENT_BUDGET', toolUses: record.toolUses, tokens: record.tokens, durationMs }
      } else if (outcome === 'completed') {
        record.state = 'completed'
        result = { status: 'completed', agentId, text: record.result, toolUses: record.toolUses, tokens: record.tokens, durationMs }
      } else if (outcome === 'max_turns') {
        record.state = 'completed'
        result = { status: 'max_turns', agentId, text: record.result + '\n\n[note: reached the maxTurns limit before a final answer]', toolUses: record.toolUses, tokens: record.tokens, durationMs }
      } else if (outcome === 'cancelled') {
        record.state = 'cancelled'
        record.error = 'cancelled'
        result = { status: 'cancelled', agentId, text: 'Subagent was cancelled.', code: 'AGENT_CANCELLED', toolUses: record.toolUses, tokens: record.tokens, durationMs }
      } else {
        record.state = 'failed'
        record.error = diagnosticText(errorInfo?.message ?? outcome)
        const failureCause = errorInfo?.toolFailure
        const failedTool = failureCause
          ? failedTools.get(failureCause.callId)
          : Array.from(failedTools.values()).at(-1)
        const failure = {
          agentId,
          code: errorInfo?.code ?? 'AGENT_FAILED',
          message: record.error,
          ...(failedTool ? { failedTool: { ...failedTool, errorCode: failureCause?.code ?? failedTool.errorCode } } : {}),
          completedTools,
          ...(plain ? { partialAnswer: diagnosticText(plain) } : {}),
          suggestion: 'Use the available partial results and try a different tool, source, or approach before delegating again.'
        }
        result = { status: 'failed', agentId, text: `Subagent failed: ${record.error}\n${JSON.stringify(failure)}`, code: 'AGENT_FAILED', toolUses: record.toolUses, tokens: record.tokens, durationMs }
      }
      const footer = `\n\n<usage>total_tokens: ${record.tokens}\ntool_uses: ${record.toolUses}\nduration_ms: ${durationMs}</usage>`
      result = { ...result, text: result.text + footer } as AgentSpawnResult

      options.parentSession.publishAgentEvent({
        type: 'agent_finished',
        agentId,
        outcome,
        toolUses: record.toolUses,
        tokens: record.tokens,
        durationMs,
        background: record.background
      })
      if (record.background && !record.stopped && !record.notified) {
        record.notified = true
        const xml =
          `<task-notification>\n<task-id>${agentId}</task-id>\n<status>${result.status}</status>\n` +
          `<summary>${escapeXmlText(description)}</summary>\n` +
          (record.error ? `<error>${escapeXmlText(record.error)}</error>\n` : '') +
          `<result>${escapeXmlText(record.result)}</result>\n` +
          `<usage>total_tokens: ${record.tokens}\ntool_uses: ${record.toolUses}\nduration_ms: ${durationMs}</usage>\n</task-notification>`
        options.parentSession.enqueueNotification(xml, `子代理「${description}」已结束（${result.status}）`)
      }
      pendingTools.clear()
      completedTools.length = 0
      failedTools.clear()
      internal.detachParentSignal()
      release()
      internal.terminal.resolve()
      internal.deferred.resolve(result)
    }

    const unsubscribe = child.on((event) => {
      if (event.type === 'tool_call_completed') {
        pendingTools.set(event.callId, { name: event.name, input: event.input })
        record.toolUses++
        record.lastTools.push(event.name)
        if (record.lastTools.length > 3) record.lastTools.shift()
        publishProgress()
      } else if (event.type === 'tool_result') {
        const call = pendingTools.get(event.callId)
        pendingTools.delete(event.callId)
        if (!call) return
        const diagnostic = {
          name: call.name,
          arguments: diagnosticText(call.input),
          output: diagnosticText(event.content),
          ...(event.errorCode ? { errorCode: event.errorCode } : {})
        }
        if (event.isError) {
          failedTools.set(event.callId, diagnostic)
          if (failedTools.size > DIAGNOSTIC_TOOL_LIMIT) {
            const oldest = failedTools.keys().next()
            if (!oldest.done) failedTools.delete(oldest.value)
          }
        } else {
          completedTools.push(diagnostic)
          if (completedTools.length > DIAGNOSTIC_TOOL_LIMIT) completedTools.shift()
        }
      } else if (event.type === 'message_completed' && event.usage) {
        record.tokens += (event.usage.inputTokens ?? 0) + (event.usage.outputTokens ?? 0)
        publishProgress()
        if (record.tokens >= tokenLimit && !internal.budgetExceeded && !internal.finished) {
          internal.budgetExceeded = true
          child.interrupt('user')
        }
      } else if (event.type === 'turn_finalized') {
        finish(event.outcome, event.error)
      } else if (event.type === 'notice' && event.code === 'stream_fallback' && !internal.finished) {
        finish('error', { class: 'unknown', code: 'AGENT_FAILED', message: event.text, retryable: false })
      }
    })

    if (spawnOptions.parentSignal && !background) {
      const signal = spawnOptions.parentSignal
      const onAbort = () => { child.interrupt('user') }
      if (!signal.aborted) signal.addEventListener('abort', onAbort, { once: true })
      internal.detachParentSignal = () => signal.removeEventListener('abort', onAbort)
    }

    options.parentSession.publishAgentEvent({
      type: 'agent_started',
      turnId,
      callId,
      agentId,
      agentType: definition.name,
      description,
      ...(definition.color ? { color: definition.color } : {}),
      background
    })

    const firstPrompt = definition.initialPrompt ? `${definition.initialPrompt}\n\n${prompt}` : prompt
    child.submit(firstPrompt)
    if (spawnOptions.parentSignal?.aborted && !background) child.interrupt('user')

    if (background) {
      return { status: 'async_launched', agentId, ...(internal.outputFile ? { outputFile: internal.outputFile } : {}) }
    }
    return await internal.deferred.promise
  }

  function background(callId: string): boolean {
    const record = byCallId.get(callId)
    if (record?.parentSessionId !== options.parentSession.id) return false
    const internal = internals.get(record.agentId)
    if (!internal || internal.finished || record.background) return false
    record.background = true
    record.state = 'backgrounded'
    internal.detachParentSignal()
    internal.detachParentSignal = () => {}
    options.parentSession.publishAgentEvent({
      type: 'agent_progress',
      agentId: record.agentId,
      toolUses: record.toolUses,
      tokens: record.tokens,
      lastTools: [...record.lastTools],
      state: 'backgrounded'
    })
    internal.deferred.resolve({
      status: 'async_launched',
      agentId: record.agentId,
      ...(internal.outputFile ? { outputFile: internal.outputFile } : {})
    })
    return true
  }

  function get(agentId: string): AgentRecord | undefined {
    const record = records.get(agentId)
    return record?.parentSessionId === options.parentSession.id ? record : undefined
  }

  function stop(agentId: string): { ok: boolean; state?: AgentState } {
    const record = get(agentId)
    if (!record) return { ok: false }
    if (isTerminal(record)) return { ok: false, state: record.state }
    record.stopped = true
    record.session.interrupt('user')
    return { ok: true, state: record.state }
  }

  async function taskOutput(agentId: string, outputOptions: { block?: boolean; timeoutMs?: number } = {}): Promise<TaskOutputResult> {
    const record = get(agentId)
    if (!record) throw new Error(`Unknown agent id: ${agentId}`)
    function terminalOutput(record: AgentRecord): TaskOutputResult {
      const text = record.state === 'failed' ? [record.error, record.result].filter(Boolean).join('\n\n') : record.result
      return { status: record.state as TaskOutputResult['status'], text }
    }
    if (isTerminal(record)) return terminalOutput(record)
    if (outputOptions.block === false) return { status: 'running', message: 'agent is still running' }
    const internal = internals.get(agentId)
    if (!internal) return { status: 'running', message: 'agent is still running' }
    const timeout = Math.min(Math.max(outputOptions.timeoutMs ?? 30000, 0), 600000)
    let timer: NodeJS.Timeout | undefined
    const timeoutPromise = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), timeout) })
    const raced = await Promise.race([internal.terminal.promise.then(() => 'done' as const), timeoutPromise])
    if (timer) clearTimeout(timer)
    if (raced === 'timeout' && !isTerminal(record)) {
      return { status: 'running', message: `timed out after ${timeout}ms; agent is still running` }
    }
    return terminalOutput(record)
  }

  function dispose(): void {
    disposed = true
    for (const record of records.values()) {
      if (!isTerminal(record)) {
        record.stopped = true
        record.session.interrupt('user')
      }
      record.session.dispose()
    }
    for (const waiter of waiters.splice(0)) waiter.reject(new Error('agent registry disposed'))
  }

  return {
    spawn,
    background,
    stop,
    taskOutput,
    list: () => [...records.values()]
      .filter((record) => record.parentSessionId === options.parentSession.id)
      .sort((a, b) => a.startedAt - b.startedAt),
    get,
    dispose
  }
}
