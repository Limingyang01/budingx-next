// SSE framing (SP002 design §3.4, AC PS-01). Framing semantics stay equivalent
// to the 0.1.1 preview implementation. Tool call assembly lives in Core.
import { ERROR_CODES } from '../core/constants.js'

export type SseFrame = { data: string }

export class SseTooLargeError extends Error {
  code = ERROR_CODES.providerEventTooLarge

  constructor(message = 'Provider event exceeds size limit') {
    super(message)
    this.name = 'SseTooLargeError'
  }
}

function frameData(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
}

/**
 * Incremental SSE parser. Tolerates arbitrary TCP fragmentation, CRLF line
 * endings, comment lines (`: keepalive`) and multi line `data:` payloads.
 */
export class SseParser {
  private buffer = ''

  constructor(private readonly maxBufferBytes = 1048576) {}

  push(chunk: string): SseFrame[] {
    this.buffer += chunk.replace(/\r/g, '')
    if (this.buffer.length > this.maxBufferBytes) throw new SseTooLargeError()
    const frames: SseFrame[] = []
    let end = this.buffer.indexOf('\n\n')
    while (end !== -1) {
      const raw = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + 2)
      const data = frameData(raw)
      if (data) frames.push({ data })
      end = this.buffer.indexOf('\n\n')
    }
    return frames
  }

  /** Flush a trailing frame that arrived without the final blank line. */
  end(): SseFrame[] {
    const rest = this.buffer
    this.buffer = ''
    if (!rest.trim()) return []
    const data = frameData(rest)
    return data ? [{ data }] : []
  }
}
