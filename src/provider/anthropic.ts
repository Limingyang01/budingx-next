// Anthropic Messages direct adapter (SP007 design §4.3, AC PC-01/04/06).
// Second public protocol alongside the native OpenAI-compatible client.
// Independent implementation of the public Messages API wire format;
// shares framing (SseParser), limits and retry discipline with openai.ts.
import { ERROR_CODES } from '../core/constants.js'
import type { ErrorClass, Usage } from '../core/events.js'
import type {
  ApiContentPart,
  ApiMessage,
  ChatRequest,
  FinishReason,
  ModelProvider,
  ProviderError,
  ProviderEvent,
  ToolSpec
} from '../core/provider.js'
import { classifyHttpStatus, providerError, sanitize } from './errors.js'
import { SseParser } from './sse.js'
import {
  DEFAULT_LIMITS,
  backoffDelay,
  parseRetryAfter,
  readJsonLimited,
  type ProviderLimits,
  type ProviderOptions,
  type ProbeOptions,
  type ProbeProfile,
  type ProbeResult
} from './openai.js'
import { setTimeout as wait } from 'node:timers/promises'

/** Anthropic requires max_tokens; the reference omits it only behind a proxy. */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192
export const ANTHROPIC_VERSION = '2023-06-01'

const EFFORT_BUDGET: Record<string, number> = { low: 1024, medium: 4096, high: 16384 }

class IdleTimeoutError extends Error {
  code = ERROR_CODES.providerIdleTimeout
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

function finishReasonOf(value: unknown): FinishReason {
  switch (value) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop'
    case 'tool_use':
      return 'tool_calls'
    case 'max_tokens':
      return 'length'
    case 'refusal':
      return 'content_filter'
    default:
      return 'unknown'
  }
}

function anthropicErrorClass(type: unknown, message: unknown, status?: number): ErrorClass {
  const t = String(type ?? '').toLowerCase()
  const m = String(message ?? '').toLowerCase()
  if (t === 'authentication_error' || t === 'permission_error') return 'auth'
  if (t === 'rate_limit_error') return 'rate_limited'
  if (t === 'overloaded_error') return 'overloaded'
  if (t === 'not_found_error') return 'not_found'
  if (t === 'invalid_request_error') {
    if (/prompt is too long|context|too many tokens/.test(m)) return 'context_overflow'
    return 'bad_request'
  }
  if (t === 'api_error') return 'unknown'
  if (status !== undefined) {
    if (status === 529) return 'overloaded'
    if (status === 400 && /prompt is too long|context|too many tokens/.test(m)) return 'context_overflow'
    return classifyHttpStatus(status)
  }
  return 'unknown'
}

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean }

function imagePartToBlock(part: Extract<ApiContentPart, { type: 'image_url' }>): AnthropicBlock | undefined {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(part.image_url.url)
  if (!match) return undefined
  return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
}

function userBlocks(content: string | ApiContentPart[]): AnthropicBlock[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  const blocks: AnthropicBlock[] = []
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text) blocks.push({ type: 'text', text: part.text })
    } else {
      const block = imagePartToBlock(part)
      if (block) blocks.push(block)
    }
  }
  return blocks
}

/** ChatRequest (OpenAI-shaped ApiMessage) → Anthropic Messages body. */
export function toAnthropicBody(request: ChatRequest): Record<string, unknown> {
  const systemParts: string[] = []
  const messages: { role: 'user' | 'assistant'; content: AnthropicBlock[] }[] = []
  for (const message of request.messages as ApiMessage[]) {
    if (message.role === 'system') {
      systemParts.push(message.content)
      continue
    }
    if (message.role === 'user') {
      const blocks = userBlocks(message.content)
      if (blocks.length > 0) messages.push({ role: 'user', content: blocks })
      continue
    }
    if (message.role === 'tool') {
      const block: AnthropicBlock = {
        type: 'tool_result',
        tool_use_id: message.tool_call_id,
        content: message.content,
        is_error: message.content.startsWith('<tool_use_error>')
      }
      // Consecutive tool results merge into one user message (protocol rule).
      const last = messages[messages.length - 1]
      if (last && last.role === 'user' && last.content.every((b) => b.type === 'tool_result')) {
        last.content.push(block)
      } else {
        messages.push({ role: 'user', content: [block] })
      }
      continue
    }
    // assistant
    const blocks: AnthropicBlock[] = []
    if (message.content) blocks.push({ type: 'text', text: message.content })
    for (const call of message.tool_calls ?? []) {
      let input: unknown = {}
      try {
        input = JSON.parse(call.function.arguments || '{}')
      } catch {
        input = {}
      }
      blocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input })
    }
    if (blocks.length > 0) messages.push({ role: 'assistant', content: blocks })
  }

  const body: Record<string, unknown> = {
    model: request.model,
    messages,
    max_tokens: request.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
    stream: request.stream !== false
  }
  if (systemParts.length > 0) body.system = systemParts.join('\n\n')
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map((tool: ToolSpec) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters ?? { type: 'object', properties: {} }
    }))
    body.tool_choice = { type: 'auto' }
  }
  if (request.reasoningEffort !== undefined) {
    body.thinking = { type: 'enabled', budget_tokens: EFFORT_BUDGET[request.reasoningEffort] ?? 4096 }
  }
  return body
}

export function createAnthropicProvider(options: ProviderOptions): ModelProvider {
  const limits: ProviderLimits = { ...DEFAULT_LIMITS, ...options.limits }
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const secrets = options.apiKey ? [options.apiKey] : []

  async function readWithIdleTimeout(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    ms: number,
    controller: AbortController
  ) {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            reject(new IdleTimeoutError('Provider stream stalled'))
          }, ms)
        })
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async function* attempt(
    request: ChatRequest,
    context: { retryAfter?: number }
  ): AsyncGenerator<ProviderEvent> {
    const body = toAnthropicBody(request)
    const controller = new AbortController()
    const signals: AbortSignal[] = [controller.signal]
    if (request.signal) signals.push(request.signal)
    const combined = AbortSignal.any(signals)

    const send = (): Promise<Response> =>
      fetchImpl(`${options.baseUrl}/v1/messages`, {
        method: 'POST',
        redirect: 'error',
        signal: combined,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'anthropic-version': ANTHROPIC_VERSION,
          ...(options.apiKey ? { 'x-api-key': options.apiKey } : {})
        },
        body: JSON.stringify(body)
      })

    let response: Response
    const connectTimer = setTimeout(() => controller.abort(), limits.connectTimeoutMs)
    try {
      response = await send()
      // D11: endpoints that reject thinking get one retry without it
      // (error-driven; never silently switches model).
      if (response.status === 400 && body.thinking !== undefined) {
        let payload: any
        try {
          payload = await readJsonLimited(
            response,
            AbortSignal.any([combined, AbortSignal.timeout(limits.idleStreamTimeoutMs)])
          )
        } catch {
          payload = undefined
        }
        if (/thinking/i.test(String(payload?.error?.message ?? ''))) {
          delete body.thinking
          response = await send()
        }
      }
    } catch (error) {
      clearTimeout(connectTimer)
      if (request.signal?.aborted) {
        yield {
          type: 'failed',
          error: providerError('aborted', 'Request cancelled by the user', {
            code: ERROR_CODES.providerAborted,
            secrets
          })
        }
        return
      }
      const timedOut = controller.signal.aborted
      yield {
        type: 'failed',
        error: providerError(
          timedOut ? 'timeout' : 'network',
          timedOut
            ? 'Connection timed out; check the endpoint and network'
            : 'Connection failed; check endpoint and network',
          { secrets }
        )
      }
      return
    }
    clearTimeout(connectTimer)

    if (!response.ok) {
      let payload: any
      try {
        payload = await readJsonLimited(
          response,
          AbortSignal.any([combined, AbortSignal.timeout(limits.idleStreamTimeoutMs)])
        )
      } catch {
        /* Fall back to HTTP classification, never echo response text. */
      }
      context.retryAfter = parseRetryAfter(response.headers.get('retry-after'))
      const errorClass = anthropicErrorClass(payload?.error?.type, payload?.error?.message, response.status)
      yield {
        type: 'failed',
        error: providerError(
          errorClass,
          `Provider HTTP ${response.status}; check credentials, model and endpoint`,
          { status: response.status, secrets }
        )
      }
      return
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!response.body || !contentType.includes('text/event-stream')) {
      await response.body?.cancel().catch(() => {})
      yield {
        type: 'failed',
        error: providerError('invalid_stream', 'Provider did not return an SSE stream', {
          code: ERROR_CODES.providerInvalidStream,
          secrets
        })
      }
      return
    }

    const parser = new SseParser(limits.eventBufferBytes)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let total = 0
    let received = false
    let finishReason: FinishReason | undefined
    let usage: Usage | undefined
    let done = false
    const pending: ProviderEvent[] = []

    const countChars = (n: number) => {
      total += n
      if (total > limits.maxResponseChars) {
        throw providerError('context_overflow', 'Answer exceeds the configured response limit', {
          code: ERROR_CODES.providerResponseTooLong,
          secrets
        })
      }
    }

    const handleFrame = (data: string): void => {
      let payload: any
      try {
        payload = JSON.parse(data)
      } catch {
        throw providerError('invalid_stream', 'Malformed or invalid provider event', {
          code: ERROR_CODES.providerInvalidStream,
          secrets
        })
      }
      if (!payload || typeof payload !== 'object') {
        throw providerError('invalid_stream', 'Malformed or invalid provider event', {
          code: ERROR_CODES.providerInvalidStream,
          secrets
        })
      }
      switch (payload.type) {
        case 'message_start': {
          const input = payload.message?.usage?.input_tokens
          if (typeof input === 'number') usage = { ...usage, inputTokens: input }
          return
        }
        case 'content_block_start': {
          const block = payload.content_block
          if (block?.type === 'tool_use') {
            received = true
            countChars(String(block.id ?? '').length + String(block.name ?? '').length)
            pending.push({
              type: 'tool_call_delta',
              index: payload.index,
              callId: block.id,
              nameDelta: block.name
            })
          }
          return
        }
        case 'content_block_delta': {
          const delta = payload.delta
          if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
            countChars(delta.text.length)
            received = true
            pending.push({ type: 'text_delta', text: delta.text })
          } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking) {
            countChars(delta.thinking.length)
            received = true
            pending.push({ type: 'thinking_delta', text: delta.thinking })
          } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
            countChars(delta.partial_json.length)
            received = true
            pending.push({ type: 'tool_call_delta', index: payload.index, argsDelta: delta.partial_json })
          }
          return
        }
        case 'message_delta': {
          if (payload.delta?.stop_reason) {
            finishReason = finishReasonOf(payload.delta.stop_reason)
            received = true
          }
          const output = payload.usage?.output_tokens
          if (typeof output === 'number') usage = { ...usage, outputTokens: output }
          return
        }
        case 'message_stop': {
          done = true
          return
        }
        case 'error': {
          const errorClass = anthropicErrorClass(payload.error?.type, payload.error?.message)
          throw providerError(errorClass, 'Provider reported an error', { secrets })
        }
        default:
          // ping / content_block_stop / unknown frames carry no content.
          return
      }
    }

    try {
      while (!done) {
        const chunk = await readWithIdleTimeout(reader, limits.idleStreamTimeoutMs, controller)
        if (chunk.done) {
          for (const frame of parser.end()) handleFrame(frame.data)
          break
        }
        let frames
        try {
          frames = parser.push(decoder.decode(chunk.value, { stream: true }))
        } catch (error) {
          yield {
            type: 'failed',
            error: providerError('invalid_stream', 'Provider event exceeds size limit', {
              code:
                error && typeof error === 'object' && 'code' in error
                  ? String((error as { code: string }).code)
                  : ERROR_CODES.providerEventTooLarge,
              secrets
            })
          }
          return
        }
        for (const frame of frames) {
          handleFrame(frame.data)
          if (done) break
        }
        while (pending.length > 0) yield pending.shift() as ProviderEvent
      }
      while (pending.length > 0) yield pending.shift() as ProviderEvent
    } catch (error) {
      if (request.signal?.aborted) {
        yield {
          type: 'failed',
          error: providerError('aborted', 'Request cancelled by the user', {
            code: ERROR_CODES.providerAborted,
            secrets
          })
        }
        return
      }
      if (error instanceof IdleTimeoutError) {
        yield {
          type: 'failed',
          error: providerError('timeout', error.message, {
            code: ERROR_CODES.providerIdleTimeout,
            secrets
          })
        }
        return
      }
      if (error && typeof error === 'object' && 'class' in error && 'code' in error) {
        yield { type: 'failed', error: error as ProviderError }
        return
      }
      yield {
        type: 'failed',
        error: providerError('network', 'Connection failed while streaming', { secrets })
      }
      return
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }

    // finish and usage arrive in separate frames; the completed event is
    // withheld until the stream ends (reference frame-holding discipline).
    if (!done && !finishReason) {
      yield {
        type: 'failed',
        error: providerError('invalid_stream', 'Provider stream incomplete or truncated', {
          code: ERROR_CODES.providerInvalidStream,
          secrets
        })
      }
      return
    }
    if (!received) {
      yield {
        type: 'failed',
        error: providerError('invalid_stream', 'Provider returned no content', {
          code: ERROR_CODES.providerInvalidStream,
          secrets
        })
      }
      return
    }
    yield {
      type: 'message_completed',
      finishReason: finishReason ?? 'stop',
      ...(usage ? { usage } : {})
    }
  }

  return {
    async *stream(request: ChatRequest): AsyncGenerator<ProviderEvent> {
      let attemptNumber = 0
      while (attemptNumber < limits.maxAttempts) {
        attemptNumber++
        const context: { retryAfter?: number } = {}
        let emitted = false
        let retryDelay: number | undefined
        let retryClass: ErrorClass | undefined
        for await (const event of attempt(request, context)) {
          if (event.type === 'failed') {
            if (event.error.retryable && !emitted && attemptNumber < limits.maxAttempts) {
              retryDelay = context.retryAfter ?? backoffDelay(attemptNumber)
              retryClass = event.error.class
              break
            }
            yield event
            return
          }
          emitted = true
          yield event
        }
        if (retryDelay === undefined) return
        yield {
          type: 'retry',
          attempt: attemptNumber,
          maxAttempts: limits.maxAttempts,
          delayMs: retryDelay,
          errorClass: retryClass as ErrorClass
        }
        try {
          if (options.sleep) {
            request.signal?.throwIfAborted()
            await sleep(retryDelay)
            request.signal?.throwIfAborted()
          } else {
            await wait(Math.min(retryDelay, 2147483647), undefined, { signal: request.signal })
          }
        } catch {
          yield {
            type: 'failed',
            error: providerError('aborted', 'Request cancelled by the user', { secrets })
          }
          return
        }
      }
    }
  }
}

export async function probeAnthropic(
  profile: ProbeProfile,
  options: ProbeOptions = {}
): Promise<ProbeResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const secrets = profile.apiKey ? [profile.apiKey] : []
  const timeoutMs = options.timeoutMs ?? 10000

  const call = async (body: Record<string, unknown>) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
    try {
      const response = await fetchImpl(`${profile.baseUrl}/v1/messages`, {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': ANTHROPIC_VERSION,
          ...(profile.apiKey ? { 'x-api-key': profile.apiKey } : {})
        },
        body: JSON.stringify(body)
      })
      let payload: any
      try {
        payload = await readJsonLimited(response, signal)
      } catch {
        if (controller.signal.aborted) throw providerError('timeout', 'Provider probe timed out')
        if (response.ok) throw providerError('invalid_stream', 'Provider returned an invalid response')
      }
      return { response, payload }
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    const { response, payload } = await call({
      model: profile.model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false
    })
    if (!response.ok) {
      return {
        ok: false,
        errorClass: anthropicErrorClass(payload?.error?.type, payload?.error?.message, response.status),
        message: sanitize(`Provider HTTP ${response.status}; check credentials, model and endpoint`, secrets)
      }
    }
    const hasContent = Array.isArray(payload?.content)
    if (payload?.error || !hasContent) {
      return { ok: false, errorClass: 'invalid_stream', message: 'Provider response is not a Messages result' }
    }
    if (!options.tools) return { ok: true, message: 'Provider reachable' }
    const { response: toolResponse, payload: toolPayload } = await call({
      model: profile.model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 64,
      stream: false,
      tool_choice: { type: 'tool', name: 'echo' },
      tools: [{ name: 'echo', description: 'Echo the input back.', input_schema: { type: 'object', properties: {} } }]
    })
    if (!toolResponse.ok) {
      return {
        ok: false,
        errorClass: anthropicErrorClass(toolPayload?.error?.type, toolPayload?.error?.message, toolResponse.status),
        message: sanitize(`Provider HTTP ${toolResponse.status}; tool capability check failed`, secrets)
      }
    }
    const valid =
      Array.isArray(toolPayload?.content) &&
      toolPayload.content.some((b: any) => b?.type === 'tool_use' && b?.name === 'echo' && b?.id)
    if (!valid) {
      return { ok: false, errorClass: 'tool_unsupported', message: 'Provider did not return the requested tool call', supportsTools: false }
    }
    return { ok: true, message: 'Provider reachable', supportsTools: true }
  } catch (error) {
    return {
      ok: false,
      errorClass:
        error && typeof error === 'object' && 'class' in error
          ? (error as ProviderError).class
          : error instanceof Error && error.name === 'AbortError'
            ? 'timeout'
            : 'network',
      message: sanitize(error instanceof Error ? error.message : 'Connection failed', secrets)
    }
  }
}

export async function discoverModelsAnthropic(
  baseUrl: string,
  apiKey: string,
  options: Pick<ProbeOptions, 'signal' | 'timeoutMs' | 'fetchImpl'> = {}
): Promise<string[]> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 10000)
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout
  const response = await (options.fetchImpl ?? fetch)(`${baseUrl}/v1/models`, {
    method: 'GET',
    redirect: 'error',
    signal,
    headers: {
      'anthropic-version': ANTHROPIC_VERSION,
      ...(apiKey ? { 'x-api-key': apiKey } : {})
    }
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`HTTP ${response.status}`)
  }
  const payload = await readJsonLimited(response, signal, 4 * 1024 * 1024)
  const models = Array.isArray(payload?.data) ? payload.data : []
  const keys = new Set<string>()
  for (const model of models) {
    const id = model?.id
    if (typeof id === 'string' && id.trim() && id.length <= 256 && !/[\x00-\x1f\x7f]/.test(id)) {
      keys.add(id)
    }
  }
  return [...keys]
}
