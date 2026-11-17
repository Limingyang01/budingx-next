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
  return undefined
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
    const connectTimer = setTimeout(
      () => controller.abort(),
      limits.connectTimeoutMs
    )
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
      await response.body?.cancel().catch(() => {})
      context.retryAfter = parseRetryAfter(response.headers.get('retry-after'))
      const errorClass = classifyHttpStatus(response.status)
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
        received = true
        pending.push({ type: 'thinking_delta', text: thinking })
      }
      if (Array.isArray(delta?.tool_calls)) {
        for (const call of delta.tool_calls) {
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
            error: providerError(
              'invalid_stream',
              'Provider event exceeds size limit',
              {
                code:
                  error && typeof error === 'object' && 'code' in error
                    ? String((error as { code: string }).code)
                    : ERROR_CODES.providerEventTooLarge,
                secrets
              }
            )
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
        await sleep(retryDelay)
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
          ...(profile.apiKey
            ? { Authorization: `Bearer ${profile.apiKey}` }
            : {})
        },
        body: JSON.stringify(body)
      })
      await response.body?.cancel().catch(() => {})
      return response
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    const response = await call({
      model: profile.model,
      messages: [{ role: 'user', content: 'ok' }],
      max_tokens: 1,
      stream: false
    })
    if (!response.ok) {
      const errorClass = classifyHttpStatus(response.status)
      return {
        ok: false,
        errorClass,
        message: sanitize(
          `Provider HTTP ${response.status}; check credentials, model and endpoint`,
          secrets
        )
      }
    }
    if (!options.tools) {
      return { ok: true, message: 'Provider reachable' }
    }
    const toolResponse = await call({
      model: profile.model,
      messages: [{ role: 'user', content: 'ok' }],
      max_tokens: 16,
      stream: false,
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
        errorClass: classifyHttpStatus(toolResponse.status),
        message: sanitize(
          `Provider HTTP ${toolResponse.status}; tool capability check failed`,
          secrets
        )
      }
    }
    return { ok: true, message: 'Provider reachable', supportsTools: true }
  } catch (error) {
    return {
      ok: false,
      errorClass: 'network',
      message: sanitize(
        error instanceof Error ? error.message : 'Connection failed',
        secrets
      )
    }
  }
}
