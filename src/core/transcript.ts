// Session transcript port (SP005 design §5, AC SR-01/SR-08).
//
// Core declares the port so the session loop can persist a transcript without
// importing storage (module boundary rule: core may not import storage).
// The storage module implements it against the filesystem.
//
// The three tool_step statuses are the "no blind replay" mechanism:
//   completed   - the side effect finished successfully
//   failed      - the tool reported a failure
//   needs_review - the outcome is unknown (interrupted); a human must check
import type { ErrorInfo, Message, MessageBlock, TurnOutcome, Usage } from './events.js'

/** Tool step outcome recorded in the transcript. */
export type ToolStepStatus = 'completed' | 'failed' | 'needs_review'

export type TranscriptRecord =
  | {
      type: 'session_started'
      ts: string
      schemaVersion: number
      sessionId: string
      title?: string
    }
  | {
      type: 'message'
      ts: string
      id: string
      parentId?: string
      role: Message['role']
      blocks: MessageBlock[]
    }
  | {
      type: 'turn'
      ts: string
      turnId: string
      outcome: TurnOutcome
      error?: ErrorInfo
      usage?: Usage
    }
  | {
      type: 'tool_step'
      ts: string
      turnId: string
      callId: string
      name: string
      status: ToolStepStatus
      detail?: string
    }
  | { type: 'note'; ts: string; text: string }

export type TranscriptRead = {
  records: TranscriptRecord[]
  /** Lines that could not be parsed; the original file is kept untouched. */
  corruptLines: number
  /** The file declares a schema version newer than this build supports. */
  unsupported: boolean
  /** The declared schema version, when present. */
  schemaVersion?: number
}

/**
 * Port used by the session loop. Core only appends; it never reads back to
 * drive execution, so a restored session can never replay a side effect.
 */
export interface SessionTranscript {
  append(record: TranscriptRecord): void
  read(): TranscriptRead
  directory(): string
}
