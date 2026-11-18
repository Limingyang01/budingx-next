import type {
  ChangeRecordSummary,
  DenialRecord,
  NoticeCode,
  SessionState
} from '../../core/events.js'
import type { PermissionMode } from '../../core/permissions.js'

export type QueueItem = { id: string; preview: string }

export type ApprovalCard = {
  requestId: string
  name: string
  summary: string
  preview?: readonly string[]
}

export type NoticeItem = {
  level: 'info' | 'warning' | 'error'
  code: NoticeCode | string
  text: string
}

export type Frame = {
  /** Logical transcript entries, retained for both narrower and wider resize. */
  transcript: string[]
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
  /** Current permission mode (SP003 design §3.8). */
  permissionMode: PermissionMode
  /** Changes written by this session, newest last (SP003 AC CP-06). */
  changes: ChangeRecordSummary[]
  /** Recent refusals, newest last (SP003 AC PC-10). */
  denials: DenialRecord[]
}

export function initialFrame(mode: PermissionMode = 'read_only'): Frame {
  return {
    transcript: [],
    staticLines: [],
    liveText: '',
    liveThinking: '',
    liveLines: [],
    status: { state: 'idle' },
    queue: [],
    notices: [],
    error: undefined,
    permissionMode: mode,
    changes: [],
    denials: []
  }
}
