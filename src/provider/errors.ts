// Provider error classification and redaction (SP002 design §3.4).
import { ERROR_CODES } from '../core/constants.js'
import type { ErrorClass } from '../core/events.js'
import type { ProviderError } from '../core/provider.js'

export function classifyHttpStatus(status: number): ErrorClass {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status === 408 || status === 504) return 'timeout'
  if (status >= 500) return 'overloaded'
  if (status >= 400) return 'bad_request'
  return 'unknown'
}

export function isRetryable(errorClass: ErrorClass): boolean {
  return (
    errorClass === 'rate_limited' ||
    errorClass === 'overloaded' ||
    errorClass === 'network' ||
    errorClass === 'timeout'
  )
}

export function errorCodeFor(errorClass: ErrorClass): string {
  switch (errorClass) {
    case 'auth':
      return ERROR_CODES.providerAuth
    case 'not_found':
      return ERROR_CODES.providerNotFound
    case 'rate_limited':
      return ERROR_CODES.providerRateLimited
    case 'overloaded':
      return ERROR_CODES.providerOverloaded
    case 'network':
      return ERROR_CODES.providerNetwork
    case 'timeout':
      return ERROR_CODES.providerTimeout
    case 'aborted':
      return ERROR_CODES.providerAborted
    case 'invalid_stream':
      return ERROR_CODES.providerInvalidStream
    case 'context_overflow':
      return ERROR_CODES.providerContextOverflow
    case 'tool_unsupported':
      return ERROR_CODES.providerToolUnsupported
    case 'bad_request':
      return ERROR_CODES.providerBadRequest
    default:
      return ERROR_CODES.providerUnknown
  }
}

/**
 * Remove credentials and control characters from anything user visible.
 * Provider bodies are never echoed; only our own short summary is shown.
 */
export function sanitize(text: string, secrets: string[] = []): string {
  let output = text
  for (const secret of secrets) {
    if (secret && secret.length >= 4) output = output.split(secret).join('***')
  }
  output = output.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
  if (output.length > 400) output = output.slice(0, 400) + '…'
  return output
}

export function providerError(
  errorClass: ErrorClass,
  message: string,
  options: { code?: string; status?: number; secrets?: string[] } = {}
): ProviderError {
  return {
    class: errorClass,
    code: options.code ?? errorCodeFor(errorClass),
    message: sanitize(message, options.secrets ?? []),
    retryable: isRetryable(errorClass),
    ...(options.status === undefined ? {} : { status: options.status })
  }
}
