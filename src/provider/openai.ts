// OpenAI compatible provider client (SP002 design §3.4, AC PS-03 … PS-06).
// Generic by design: base URL + key + model name, no vendor specific paths.
import { ERROR_CODES } from '../core/constants.js'
import type { ErrorClass } from '../core/events.js'
import type {
  ChatRequest,
  FinishReason,
  ModelProvider,
  ProviderError,
  ProviderEvent,
  ToolSpec
} from '../core/provider.js'
import { classifyHttpStatus, providerError, sanitize } from './errors.js'
import { SseParser } from './sse.js'
import { setTimeout as wait } from 'node:timers/promises'

async function readJsonLimited(response: Response, signal: AbortSignal): Promise<any> {
  if (!response.body) throw new Error('Missing response body')
  const reader = response.body.getReader()
  const abort = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    let text = ''
    const decoder = new TextDecoder()
    while (true) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      signal.throwIfAborted()
      if (chunk.done) break
      text += decoder.decode(chunk.value, { stream: true })
      if (text.length > 16384) throw new Error('Response exceeds probe/error limit')
    }
    return JSON.parse(text)
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function responseErrorClass(status: number, payload: any): ErrorClass {
  const code = String(payload?.error?.code ?? payload?.error?.type ?? '').toLowerCase()
  if (status === 400 || status === 422) {
    if (/context.*(length|limit|overflow)|too_many_tokens/.test(code))
      return 'context_overflow'
    if (/unsupported.*tool|tool.*(unsupported|not_supported)/.test(code))
      return 'tool_unsupported'
  }
  return classifyHttpStatus(status)
}

export type ProviderLimits = {
  eventBufferBytes: number
  maxResponseChars: number
  connectTimeoutMs: number
  idleStreamTimeoutMs: number
  maxAttempts: number
}

export const DEFAULT_LIMITS: ProviderLimits = {
  eventBufferBytes: 1048576,
  maxResponseChars: 65536,
  connectTimeoutMs: 30000,
  idleStreamTimeoutMs: 120000,
  maxAttempts: 5
}

export type ProviderOptions = {
  baseUrl: string
  apiKey?: string
  limits?: Partial<ProviderLimits>
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export type ProbeProfile = {
  baseUrl: string
  model: string
  apiKey?: string
}

export type ProbeOptions = {
  tools?: boolean
  timeoutMs?: number
  limits?: Partial<ProviderLimits>
  fetchImpl?: typeof fetch
}

export type ProbeResult = {
  ok: boolean
  errorClass?: ErrorClass
  message: string
  supportsTools?: boolean
}

class IdleTimeoutError extends Error {
  code = ERROR_CODES.providerIdleTimeout
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

function backoffDelay(attempt: number): number {
  const base = Math.min(500 * 2 ** (attempt - 1), 8000)
  const jitter = base * 0.2 * (Math.random() * 2 - 1)
  return Math.max(50, Math.round(base + jitter))
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

function finishReasonOf(value: unknown): FinishReason {
  switch (value) {
    case 'stop':
      return 'stop'
    case 'tool_calls':
      return 'tool_calls'
    case 'length':
      return 'length'
    case 'content_filter':
      return 'content_filter'
    default:
      return 'unknown'
  }
}

function toolSpecs(tools: ToolSpec[] | undefined) {
  if (!tools || tools.length === 0) return undefined
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      ...(tool.parameters ? { parameters: tool.parameters } : {})
    }
  }))
}

export function createOpenAiProvider(options: ProviderOptions): ModelProvider {
  const limits = { ...DEFAULT_LIMITS, ...options.limits }
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
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream: request.stream !== false
    }
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens
    const specs = toolSpecs(request.tools)
    if (specs) body.tools = specs

    const controller = new AbortController()
    const signals: AbortSignal[] = [controller.signal]
    if (request.signal) signals.push(request.signal)
    const combined = AbortSignal.any(signals)

    let response: Response
    const connectTimer = setTimeout(() => controller.abort(), limits.connectTimeoutMs)
    try {
      response = await fetchImpl(`${options.baseUrl}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        signal: combined,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {})
        },
        body: JSON.stringify(body)
      })
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
      const errorClass: ErrorClass = timedOut ? 'timeout' : 'network'
      yield {
        type: 'failed',
        error: providerError(
          errorClass,
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
      let payload
      try {
        payload = await readJsonLimited(
          response,
          AbortSignal.any([combined, AbortSignal.timeout(limits.idleStreamTimeoutMs)])
        )
      } catch {
        /* Fall back to HTTP classification, never echo response text. */
      }
      context.retryAfter = parseRetryAfter(response.headers.get('retry-after'))
      const errorClass = responseErrorClass(response.status, payload)
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
    let done = false
    const pending: ProviderEvent[] = []

    const handleFrame = (data: string): boolean => {
      if (data.trim() === '[DONE]') {
        done = true
        return true
      }
      let payload: {
        error?: unknown
        choices?: {
          delta?: {
            content?: unknown
            reasoning_content?: unknown
            reasoning?: unknown
            tool_calls?: {
              index?: number
              id?: string
              function?: { name?: string; arguments?: string }
            }[]
          }
          finish_reason?: unknown
        }[]
      }
      try {
        payload = JSON.parse(data)
      } catch {
        throw providerError('invalid_stream', 'Malformed or invalid provider event', {
          code: ERROR_CODES.providerInvalidStream,
          secrets
        })
      }
      if (!payload || payload.error) {
        throw providerError('bad_request', 'Provider reported an error', { secrets })
      }
      const choice = payload.choices?.[0]
      const delta = choice?.delta
      if (typeof delta?.content === 'string' && delta.content) {
        total += delta.content.length
        if (total > limits.maxResponseChars) {
          throw providerError(
            'context_overflow',
            'Answer exceeds the configured response limit',
            { code: ERROR_CODES.providerResponseTooLong, secrets }
          )
        }
        received = true
        pending.push({ type: 'text_delta', text: delta.content })
      }
      const thinking = delta?.reasoning_content ?? delta?.reasoning
      if (typeof thinking === 'string' && thinking) {
        total += thinking.length
        if (total > limits.maxResponseChars)
          throw providerError(
            'context_overflow',
            'Answer exceeds the configured response limit',
            { code: ERROR_CODES.providerResponseTooLong, secrets }
          )
        received = true
        pending.push({ type: 'thinking_delta', text: thinking })
      }
      if (Array.isArray(delta?.tool_calls)) {
        for (const call of delta.tool_calls) {
          total +=
            (call.function?.arguments?.length ?? 0) +
            (call.function?.name?.length ?? 0) +
            (call.id?.length ?? 0)
          if (total > limits.maxResponseChars)
            throw providerError(
              'context_overflow',
              'Answer exceeds the configured response limit',
              { code: ERROR_CODES.providerResponseTooLong, secrets }
            )
          received = true
          pending.push({
            type: 'tool_call_delta',
            ...(typeof call.index === 'number' ? { index: call.index } : {}),
            callId: call.id,
            nameDelta: call.function?.name,
            argsDelta: call.function?.arguments
          })
        }
      }
      if (choice?.finish_reason) {
        finishReason = finishReasonOf(choice.finish_reason)
        received = true
      }
      return false
    }

    try {
      while (!done) {
        const chunk = await readWithIdleTimeout(
          reader,
          limits.idleStreamTimeoutMs,
          controller
        )
        if (chunk.done) {
          for (const frame of parser.end()) {
            if (handleFrame(frame.data)) break
          }
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
        while (pending.length > 0) {
          const event = pending.shift() as ProviderEvent
          yield event
        }
      }
      while (pending.length > 0) {
        const event = pending.shift() as ProviderEvent
        yield event
      }
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

    if (!done && !finishReason) {
      yield {
        type: 'failed',
        error: providerError(
          'invalid_stream',
          'Provider stream incomplete or truncated',
          {
            code: ERROR_CODES.providerInvalidStream,
            secrets
          }
        )
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
      finishReason: finishReason ?? 'stop'
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
            await wait(Math.min(retryDelay, 2147483647), undefined, {
              signal: request.signal
            })
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

export async function probe(
  profile: ProbeProfile,
  options: ProbeOptions = {}
): Promise<ProbeResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const secrets = profile.apiKey ? [profile.apiKey] : []
  const timeoutMs = options.timeoutMs ?? 10000

  const call = async (body: Record<string, unknown>) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(`${profile.baseUrl}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(profile.apiKey ? { Authorization: `Bearer ${profile.apiKey}` } : {})
        },
        body: JSON.stringify(body)
      })
      let payload
      try {
        payload = await readJsonLimited(response, controller.signal)
      } catch {
        if (controller.signal.aborted)
          throw providerError('timeout', 'Provider probe timed out')
        if (response.ok)
          throw providerError('invalid_stream', 'Provider returned an invalid response')
      }
      return { response, payload }
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    const { response, payload } = await call({
      model: profile.model,
      messages: [{ role: 'user', content: 'ok' }],
      max_tokens: 1,
      stream: false
    })
    if (!response.ok) {
      const errorClass = responseErrorClass(response.status, payload)
      return {
        ok: false,
        errorClass,
        message: sanitize(
          `Provider HTTP ${response.status}; check credentials, model and endpoint`,
          secrets
        )
      }
    }
    if (
      !Array.isArray(payload?.choices) ||
      !payload.choices[0]?.message ||
      typeof payload.choices[0].message.content !== 'string'
    ) {
      return {
        ok: false,
        errorClass: 'invalid_stream',
        message: 'Provider response is not a chat completion'
      }
    }
    if (!options.tools) {
      return { ok: true, message: 'Provider reachable' }
    }
    const { response: toolResponse, payload: toolPayload } = await call({
      model: profile.model,
      messages: [{ role: 'user', content: 'ok' }],
      max_tokens: 64,
      stream: false,
      tool_choice: { type: 'function', function: { name: 'echo' } },
      tools: [
        {
          type: 'function',
          function: {
            name: 'echo',
            description: 'Echo the input back.',
            parameters: { type: 'object', properties: {} }
          }
        }
      ]
    })
    if (!toolResponse.ok) {
      return {
        ok: false,
        errorClass: responseErrorClass(toolResponse.status, toolPayload),
        message: sanitize(
          `Provider HTTP ${toolResponse.status}; tool capability check failed`,
          secrets
        )
      }
    }
    const calls = toolPayload?.choices?.[0]?.message?.tool_calls
    const valid =
      Array.isArray(calls) &&
      calls.some((c: any) => {
        if (
          !c.id ||
          c.type !== 'function' ||
          c.function?.name !== 'echo' ||
          typeof c.function.arguments !== 'string'
        )
          return false
        try {
          JSON.parse(c.function.arguments)
          return true
        } catch {
          return false
        }
      })
    if (!valid)
      return {
        ok: false,
        errorClass: 'tool_unsupported',
        message: 'Provider did not return the requested tool call',
        supportsTools: false
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
      message: sanitize(
        error instanceof Error ? error.message : 'Connection failed',
        secrets
      )
    }
  }
}
