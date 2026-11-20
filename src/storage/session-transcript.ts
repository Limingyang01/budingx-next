// Session transcript persistence (SP005 design §5, AC SR-01/SR-07/SR-08/SR-09).
//
// Layout: ~/.budingx/sessions/<sessionId>/transcript.jsonl
// One JSON object per line, appended and fsynced. The transcript is the
// recovery source of truth: it records messages, turn outcomes and tool
// steps, and nothing in this file ever re-executes a tool.
//
// The three tool_step statuses are the "no blind replay" mechanism:
//   completed  - the side effect finished successfully
//   failed     - the tool reported a failure
//   needs_review - the outcome is unknown (interrupted); a human must check
import type { Message } from '../core/events.js'
import type {
  SessionTranscript,
  ToolStepStatus,
  TranscriptRead,
  TranscriptRecord
} from '../core/transcript.js'
import {
  appendPrivateLine,
  ensurePrivateDirectory,
  isRegularFile,
  readPrivateFile,
  sessionDirectory
} from './private-file.js'

/** Current transcript schema version. */
export const TRANSCRIPT_VERSION = 1

/** Name of the transcript file inside a session directory. */
export const TRANSCRIPT_FILE = 'transcript.jsonl'

export type {
  SessionTranscript,
  ToolStepStatus,
  TranscriptRead,
  TranscriptRecord
}

export type SessionTranscriptOptions = {
  sessionId: string
  home?: string
  /** Injectable clock, for deterministic tests. */
  now?: () => string
}

function defaultNow(): string {
  return new Date().toISOString()
}

function isTranscriptRecord(value: unknown): value is TranscriptRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.type === 'string'
}

function isToolStepStatus(value: unknown): value is ToolStepStatus {
  return value === 'completed' || value === 'failed' || value === 'needs_review'
}

/**
 * Create the transcript store for one session. Nothing is written until the
 * first append, so creating a session never creates a file on disk.
 */
export function createSessionTranscript(options: SessionTranscriptOptions): SessionTranscript {
  const sessionId = options.sessionId
  const directory = sessionDirectory(sessionId, options.home)
  const file = `${directory}/${TRANSCRIPT_FILE}`
  const now = options.now ?? defaultNow

  return {
    directory: () => directory,

    append(record: TranscriptRecord): void {
      const stamped = { ...record, ts: record.ts ?? now() } as TranscriptRecord
      appendPrivateLine(file, JSON.stringify(stamped) + '\n')
    },

    read(): TranscriptRead {
      const raw = readPrivateFile(file)
      if (raw === undefined) {
        return { records: [], corruptLines: 0, unsupported: false }
      }
      const lines = raw.split('\n').filter((line) => line.trim().length > 0)
      const records: TranscriptRecord[] = []
      let corruptLines = 0
      let schemaVersion: number | undefined
      let unsupported = false

      for (const line of lines) {
        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          // A half-written line (process killed mid-write) is skipped and
          // counted; the original file is never rewritten.
          corruptLines += 1
          continue
        }
        if (!isTranscriptRecord(parsed)) {
          corruptLines += 1
          continue
        }
        if (parsed.type === 'session_started') {
          const version = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 0
          schemaVersion = version
          if (version > TRANSCRIPT_VERSION) {
            // Newer than we understand: refuse to read, never overwrite.
            unsupported = true
            return { records: [], corruptLines, unsupported: true, schemaVersion: version }
          }
        }
        if (parsed.type === 'tool_step' && !isToolStepStatus(parsed.status)) {
          corruptLines += 1
          continue
        }
        records.push(parsed)
      }

      return { records, corruptLines, unsupported, schemaVersion }
    }
  }
}

/**
 * Rebuild the message list of a session from transcript records. Tool
 * results are restored as-is, so a recovered conversation shows exactly what
 * the tools returned before the process died.
 *
 * `compaction` records are replayed, so a context compaction survives a
 * restart instead of being silently undone (SP005 review H5).
 */
export function messagesFromRecords(records: TranscriptRecord[]): Message[] {
  const byId = new Map<string, Message>()
  let order: string[] = []
  for (const record of records) {
    if (record.type === 'message') {
      if (!Array.isArray(record.blocks)) continue
      if (!byId.has(record.id)) order.push(record.id)
      byId.set(record.id, { id: record.id, role: record.role, blocks: record.blocks })
      continue
    }
    if (record.type === 'compaction') {
      for (const synthetic of record.synthetic ?? []) {
        byId.set(synthetic.id, {
          id: synthetic.id,
          role: synthetic.role,
          blocks: synthetic.blocks
        })
      }
      const next: string[] = []
      const seen = new Set<string>()
      for (const id of record.order ?? []) {
        if (seen.has(id) || !byId.has(id)) continue
        seen.add(id)
        next.push(id)
      }
      order = next
    }
  }
  const messages: Message[] = []
  for (const id of order) {
    const message = byId.get(id)
    if (message) messages.push(message)
  }
  return messages
}

/**
 * Tool steps whose outcome is unknown. A recovery consumer must ask the user
 * to check these before anything is retried; it must never replay them.
 */
export function needsReviewSteps(records: TranscriptRecord[]): TranscriptRecord[] {
  return records.filter(
    (record) => record.type === 'tool_step' && record.status === 'needs_review'
  )
}

/** True when the transcript file exists on disk. */
export function transcriptExists(sessionId: string, home?: string): boolean {
  return isRegularFile(`${sessionDirectory(sessionId, home)}/${TRANSCRIPT_FILE}`)
}

/** Ensure the session directory exists with owner-only permissions. */
export function ensureSessionDirectory(sessionId: string, home?: string): string {
  return ensurePrivateDirectory(sessionDirectory(sessionId, home))
}
