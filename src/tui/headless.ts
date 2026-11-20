// SP006 §11：无头事件协议（设计与参考仓 print.ts 的协议对齐，实现独立编写）。
// stdout 只承载协议数据；诊断一律走 stderr；退出码 0/1/2。
import { readFileSync } from 'node:fs'
import type { CredentialStore } from '../storage/credentials.js'
import type { ConfigStore } from '../storage/config-store.js'
import type { ResolvedConfig } from '../storage/profiles.js'
import type { SessionEvent, TurnFinalizedEvent, Usage } from '../core/events.js'
import { createAgentRuntime, workspacePromptOptions, type AgentRuntime } from './runtime.js'

export type HeadlessOutputFormat = 'text' | 'json' | 'stream-json'
export type HeadlessInputFormat = 'text' | 'stream-json'

/** 用法错误：调用方负责把消息写入 stderr 并以退出码 2 结束（HC-05）。 */
export class UsageError extends Error {
  readonly exitCode = 2
}

export type HeadlessOptions = {
  prompt?: string
  outputFormat: HeadlessOutputFormat
  inputFormat: HeadlessInputFormat
  inputFile?: string
  session?: string
  verbose: boolean
}

export type ParsedCli = {
  passthrough: string[]
  options: HeadlessOptions
  /** 是否显式给出无头参数（--verbose 本身不触发无头）。 */
  explicit: boolean
}

const OUTPUT_FORMATS: HeadlessOutputFormat[] = ['text', 'json', 'stream-json']
const INPUT_FORMATS: HeadlessInputFormat[] = ['text', 'stream-json']
const PASSTHROUGH_FLAGS = ['--base-url', '--model', '--timeout', '--prompt']

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index]
  if (value === undefined || value.length === 0 || value.startsWith('--'))
    throw new UsageError(`${flag} requires a value`)
  return value
}

/**
 * 解析 argv：无头专属参数由此消费，其余参数原样交给既有配置合并
 * （profiles.mergeSources 仍负责 --model/--base-url/--timeout/--prompt）。
 * 未知参数在这里就报用法错误，以便退出码固定为 2。
 */
export function parseCliArgs(argv: string[]): ParsedCli {
  const options: HeadlessOptions = {
    outputFormat: 'text',
    inputFormat: 'text',
    verbose: false
  }
  const passthrough: string[] = []
  let explicit = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--verbose') {
      options.verbose = true
      continue
    }
    if (arg === '--output-format') {
      explicit = true
      const value = requireValue(argv, ++i, arg)
      if (!OUTPUT_FORMATS.includes(value as HeadlessOutputFormat))
        throw new UsageError(
          `Invalid --output-format: ${value} (expected text, json or stream-json)`
        )
      options.outputFormat = value as HeadlessOutputFormat
      continue
    }
    if (arg === '--input-format') {
      explicit = true
      const value = requireValue(argv, ++i, arg)
      if (!INPUT_FORMATS.includes(value as HeadlessInputFormat))
        throw new UsageError(`Invalid --input-format: ${value} (expected text or stream-json)`)
      options.inputFormat = value as HeadlessInputFormat
      continue
    }
    if (arg === '--input-file') {
      explicit = true
      options.inputFile = requireValue(argv, ++i, arg)
      continue
    }
    if (arg === '--session') {
      explicit = true
      options.session = requireValue(argv, ++i, arg)
      continue
    }
    if (arg.startsWith('-') && !PASSTHROUGH_FLAGS.includes(arg))
      throw new UsageError(`Unknown option: ${arg}`)
    passthrough.push(arg)
    if (PASSTHROUGH_FLAGS.includes(arg)) {
      const value = requireValue(argv, ++i, arg)
      passthrough.push(value)
      if (arg === '--prompt') options.prompt = value
    }
  }
  if (options.prompt !== undefined && options.inputFile !== undefined)
    throw new UsageError('--prompt and --input-file are mutually exclusive')
  return { passthrough, options, explicit }
}

export type HeadlessEvent =
  | { type: 'system'; subtype: 'init'; session_id: string; model: string; tools: string[] }
  | {
      type: 'system'
      subtype: 'status'
      state: 'starting' | 'running' | 'waiting_permission' | 'stopping'
    }
  | { type: 'user'; message: { role: 'user'; content: string } }
  | { type: 'assistant'; message: { role: 'assistant'; content: string }; delta: boolean }
  | { type: 'tool_call'; tool_use_id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean }
  | {
      type: 'result'
      subtype: 'success' | 'error_during_execution' | 'error_max_turns'
      is_error: boolean
      duration_ms: number
      duration_api_ms: number
      num_turns: number
      stop_reason: string
      session_id: string
      total_cost_usd: number
      usage: Usage | null
      permission_denials: unknown[]
      errors?: { code: string; message: string }[]
    }

/**
 * 事件 → 输出文本。text 只保留助手增量；json 只输出终态 result（去掉 type 包装）；
 * stream-json 每行一个 JSON 对象。返回 undefined 表示该格式下不输出该事件。
 */
export function formatHeadlessEvent(
  event: HeadlessEvent,
  format: HeadlessOutputFormat
): string | undefined {
  if (format === 'text')
    return event.type === 'assistant' && event.delta ? event.message.content : undefined
  if (format === 'json') {
    if (event.type !== 'result') return undefined
    const { type: _type, ...rest } = event
    return JSON.stringify(rest)
  }
  return JSON.stringify(event)
}

function resultSubtype(
  outcome: string
): 'success' | 'error_during_execution' | 'error_max_turns' {
  if (outcome === 'completed') return 'success'
  if (outcome === 'max_turns') return 'error_max_turns'
  return 'error_during_execution'
}

export type HeadlessStores = {
  configStore: ConfigStore
  credentialStore: CredentialStore
}

export type HeadlessIo = {
  stdin?: AsyncIterable<string | Buffer>
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  cwd?: string
  home?: string
  env?: NodeJS.ProcessEnv
  now?: () => number
}

async function readStdinText(io: HeadlessIo): Promise<string> {
  const stream = io.stdin ?? process.stdin
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

/** 按输入格式把原始输入拆成回合文本；stream-json 行必须是 user 消息对象。 */
function parseTurns(raw: string, format: HeadlessInputFormat): string[] {
  const turns: string[] = []
  for (const line of raw.split('\n')) {
    const text = line.trim()
    if (!text) continue
    if (text === '/exit' || text === '/quit') break
    if (format === 'text') {
      turns.push(text)
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new UsageError(`Invalid stream-json input line: ${text.slice(0, 80)}`)
    }
    const object = parsed as { type?: unknown; message?: { role?: unknown; content?: unknown } }
    const content = object?.message?.content
    const blocks = Array.isArray(content)
      ? content
          .map((block) =>
            block && typeof block === 'object' && (block as { type?: string }).type === 'text'
              ? String((block as { text?: unknown }).text ?? '')
              : ''
          )
          .join('')
      : typeof content === 'string'
        ? content
        : undefined
    if (object?.type !== 'user' || !content || !blocks?.trim())
      throw new UsageError('stream-json input lines must be user messages with text content')
    turns.push(blocks.trim())
  }
  return turns
}

const STATUS_STATES: Record<
  string,
  'running' | 'waiting_permission' | 'stopping'
> = {
  requesting: 'running',
  streaming: 'running',
  tool_running: 'running',
  awaiting_approval: 'waiting_permission',
  cancelling: 'stopping'
}

/**
 * 运行无头回合并输出事件。返回值即进程退出码：is_error → 1，否则 0。
 * 无持久化调用时不写用户数据；显式 --session 才复用既有会话（HC-07）。
 */
export async function runHeadless(
  config: ResolvedConfig,
  stores: HeadlessStores,
  io: HeadlessIo,
  options: HeadlessOptions
): Promise<number> {
  const now = io.now ?? (() => Date.now())
  const startedAt = now()
  const writeEvent = (event: HeadlessEvent): void => {
    const text = formatHeadlessEvent(event, options.outputFormat)
    if (text === undefined) return
    io.stdout.write(
      options.outputFormat === 'stream-json' || options.outputFormat === 'json' ? `${text}\n` : text
    )
  }
  const diagnose = (message: string): void => {
    if (options.verbose) io.stderr.write(`[headless] ${message}\n`)
  }

  const raw = options.inputFile !== undefined
    ? readFileSync(options.inputFile, 'utf8')
    : options.prompt !== undefined
      ? options.prompt
      : await readStdinText(io)
  const turnsInput = parseTurns(raw, options.inputFormat)
  if (turnsInput.length === 0) {
    // 无输入：不启动会话，只给出终态，避免凭空写用户数据。
    writeEvent({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: Math.max(0, now() - startedAt),
      duration_api_ms: 0,
      num_turns: 0,
      stop_reason: 'completed',
      session_id: options.session ?? '',
      total_cost_usd: 0,
      usage: null,
      permission_denials: []
    })
    return 0
  }
  if (!config.model.trim()) {
    io.stderr.write(
      'Error: Set BUDINGX_MODEL or use /model <name> before sending a prompt\n'
    )
    return 1
  }

  const runtime: AgentRuntime = createAgentRuntime({
    cwd: io.cwd ?? process.cwd(),
    getConfig: () => config,
    approval: {
      async request() {
        return { outcome: 'deny', via: 'policy' }
      }
    },
    configStore: stores.configStore,
    mode: 'read_only',
    ...(io.home === undefined ? {} : { home: io.home }),
    ...(options.session === undefined
      ? {}
      : { sessionId: options.session, persistence: true })
  })
  const session = runtime.session
  if (options.session !== undefined) {
    const resumed = runtime.sessions?.resume(options.session)
    if (!resumed?.ok) {
      io.stderr.write(`Error: session not found: ${options.session}\n`)
      session.dispose()
      return 1
    }
  }

  writeEvent({
    type: 'system',
    subtype: 'init',
    session_id: session.id,
    model: config.model,
    tools: [...runtime.toolNames]
  })
  writeEvent({ type: 'system', subtype: 'status', state: 'starting' })

  let lastState: string | undefined
  let lastUsage: Usage | undefined
  let lastOutcome = 'completed'
  let turns = 0
  const errors: { code: string; message: string }[] = []
  let exitCode = 0

  const off = session.on((event: SessionEvent) => {
    if (event.type === 'status') {
      const state = STATUS_STATES[event.state]
      if (state && state !== lastState) {
        lastState = state
        writeEvent({ type: 'system', subtype: 'status', state })
      }
      return
    }
    if (event.type === 'text_delta') {
      writeEvent({
        type: 'assistant',
        message: { role: 'assistant', content: event.text },
        delta: true
      })
      return
    }
    if (event.type === 'tool_call_completed') {
      writeEvent({
        type: 'tool_call',
        tool_use_id: event.callId,
        name: event.name,
        input: event.input
      })
      return
    }
    if (event.type === 'notice' && event.code === 'file_context') {
      // 既有 --prompt 行为：附件提示走 stderr，不污染 stdout 协议。
      io.stderr.write(`${event.text}\n`)
      return
    }
    if (event.type === 'tool_result') {
      writeEvent({
        type: 'tool_result',
        tool_use_id: event.callId,
        content: event.content,
        is_error: event.isError
      })
    }
  })

  try {
    for (const text of turnsInput) {
      turns += 1
      writeEvent({ type: 'user', message: { role: 'user', content: text } })
      let assistantText = ''
      let settle: ((event: TurnFinalizedEvent) => void) | undefined
      const turnDone = new Promise<TurnFinalizedEvent>((resolve) => {
        settle = resolve
      })
      const turnOff = session.on((event: SessionEvent) => {
        if (event.type === 'text_delta') assistantText += event.text
        if (event.type === 'message_completed')
          writeEvent({
            type: 'assistant',
            message: { role: 'assistant', content: assistantText },
            delta: false
          })
        if (event.type === 'turn_finalized') {
          turnOff()
          settle?.(event)
        }
      })
      session.submit(text, workspacePromptOptions(text, runtime.workspace, runtime.policy))
      const finalized = await turnDone
      lastOutcome = finalized.outcome
      lastUsage = finalized.usage
      if (finalized.error) {
        errors.push({ code: finalized.error.code, message: finalized.error.message })
        exitCode = 1
      }
    }
  } finally {
    off()
  }
  const subtype = resultSubtype(lastOutcome)
  const isError = subtype !== 'success'
  writeEvent({
    type: 'result',
    subtype,
    is_error: isError,
    duration_ms: Math.max(0, now() - startedAt),
    duration_api_ms: 0,
    num_turns: turns,
    stop_reason: lastOutcome,
    session_id: session.id,
    total_cost_usd: 0,
    usage: lastUsage ?? null,
    permission_denials: [...runtime.denials],
    ...(errors.length === 0 ? {} : { errors })
  })
  diagnose(`turns=${turns} outcome=${lastOutcome}`)
  if (options.outputFormat === 'text') io.stdout.write('\n')
  session.dispose()
  await runtime.shutdownTracing?.()
  return isError ? 1 : exitCode
}
