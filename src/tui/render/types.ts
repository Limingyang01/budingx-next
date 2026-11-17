import type { NoticeCode, SessionState } from '../../core/events.js'

export type QueueItem = { id: string; preview: string }

export type ApprovalCard = {
  requestId: string
  name: string
  summary: string
}

export type NoticeItem = {
  level: 'info' | 'warning' | 'error'
  code: NoticeCode | string
  text: string
}

export type Frame = {
  /** Finished transcript lines, already written to the terminal scrollback. */
  staticLines: string[]
  /** Raw text of the running assistant message (never re-wrapped in place). */
  liveText: string
  /** Raw text of the running thinking block. */
  liveThinking: string
  /** The live area of the running turn. */
  liveLines: string[]
  status: { state: SessionState; note?: string }
  queue: QueueItem[]
  approval?: ApprovalCard
  notices: NoticeItem[]
  error?: string
}

export function initialFrame(): Frame {
  return {
    staticLines: [],
    liveText: '',
    liveThinking: '',
    liveLines: [],
    status: { state: 'idle' },
    queue: [],
    notices: [],
    error: undefined
  }
}
