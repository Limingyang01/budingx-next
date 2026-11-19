// Session index, cross-process recovery and writer locking (SP005 design §5,
// AC SR-01..SR-11).
//
// The store never re-executes anything. Restoring a session gives back the
// transcript contents, the recorded permission mode and the list of tool
// steps whose outcome is unknown; the caller decides what to do next.
import {
  existsSync,
  readdirSync,
  rmSync
} from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { PermissionMode } from '../core/permissions.js'
import { writeJsonAtomic } from './atomic.js'
import {
  ensurePrivateDirectory,
  isRegularFile,
  readPrivateFile,
  sessionDirectory,
  writePrivateFile
} from './private-file.js'
import {
  TRANSCRIPT_VERSION,
  createSessionTranscript,
  messagesFromRecords,
  needsReviewSteps,
  type SessionTranscript,
  type TranscriptRecord
} from './session-transcript.js'

/** Name of the session index file. */
export const SESSION_INDEX_FILE = 'sessions.json'
/** Name of the per-session metadata file. */
export const SESSION_META_FILE = 'meta.json'
/** Name of the writer lock file. */
export const WRITER_LOCK_FILE = 'writer.lock'

export type SessionSummary = {
  sessionId: string
  title: string
  createdAt: string
  updatedAt: string
  turns: number
  permissionMode?: PermissionMode
}

export type SessionMeta = {
  schemaVersion: number
  sessionId: string
  title: string
  createdAt: string
  updatedAt: string
  turns: number
  permissionMode?: PermissionMode
}

export type RestoreStatus = 'restored' | 'not_found' | 'unsupported_schema' | 'corrupt' | 'locked'

export type RestoreResult = {
  status: RestoreStatus
  summary?: SessionSummary
  messages: Message[]
  transcript?: SessionTranscript
  /** Tool steps whose outcome is unknown; must be checked, never replayed. */
  needsReview: { name: string; callId: string; detail?: string }[]
  /** Non-fatal problems found while reading (e.g. skipped corrupt lines). */
  warnings: string[]
  message?: string
}

export type SessionStoreOptions = {
  home?: string
  now?: () => string
}

/** Messages restored from a transcript. */
type Message = { id: string; role: 'user' | 'assistant' | 'tool'; blocks: unknown[] }

function defaultNow(): string {
  return new Date().toISOString()
}

function sessionsRoot(home?: string): string {
  return join(home ? join(home, '.budingx') : join(homedir(), '.budingx'), 'sessions')
}

function sanitizeTitle(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return 'Untitled session'
  return trimmed.length > 80 ? trimmed.slice(0, 79) + '…' : trimmed
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'read_only' || value === 'workspace_edit' || value === 'full_access'
}

/**
 * Writer lock. A live lock (its pid is still running) rejects the other
 * writer explicitly. A stale lock is never deleted silently: the caller has
 * to pass force to take over, so a crashed process does not cause a silent
 * takeover of somebody else's session.
 */
export class SessionWriterLock {
  private readonly file: string

  constructor(
    sessionId: string,
    private readonly home?: string
  ) {
    this.file = join(sessionDirectory(sessionId, home), WRITER_LOCK_FILE)
  }

  get path(): string {
    return this.file
  }

  /** Try to take the lock. Returns undefined on success, a reason otherwise. */
  acquire(options: { force?: boolean } = {}): { acquired: true } | { acquired: false; reason: string } {
    ensurePrivateDirectory(join(this.file, '..'))
    if (existsSync(this.file)) {
      const raw = readPrivateFile(this.file)
      const pid = raw ? Number(raw.split('\n')[0]) : Number.NaN
      if (Number.isFinite(pid) && pid > 0 && isProcessAlive(pid)) {
        return { acquired: false, reason: `session is locked by a running process (pid ${pid})` }
      }
      if (!options.force) {
        return {
          acquired: false,
          reason: 'session has a stale lock from a crashed process; unlock it explicitly to continue'
        }
      }
      try {
        rmSync(this.file, { force: true })
      } catch {
        // Fall through: the exclusive create below decides the outcome.
      }
    }
    try {
      writePrivateFile(this.file, `${process.pid}\n${defaultNow()}\n`)
      return { acquired: true }
    } catch (error) {
      return {
        acquired: false,
        reason: error instanceof Error ? error.message : String(error)
      }
    }
  }

  release(): void {
    try {
      rmSync(this.file, { force: true })
    } catch {
      // Releasing a lock must never throw.
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    const code = (error as NodeJS.ErrnoException)?.code
    return code === 'EPERM'
  }
}

/**
 * Session index and recovery. Every method is read-only with respect to
 * conversation content except the explicit meta updates.
 */
export class SessionStore {
  private readonly root: string
  private readonly now: () => string

  constructor(private readonly options: SessionStoreOptions = {}) {
    this.root = sessionsRoot(options.home)
    this.now = options.now ?? defaultNow
  }

  /** Directory that holds all session directories. */
  get sessionsRoot(): string {
    return this.root
  }

  /** Directory of one session. */
  directory(sessionId: string): string {
    return sessionDirectory(sessionId, this.options.home)
  }

  /** List known sessions, newest first. */
  list(): SessionSummary[] {
    let entries: string[] = []
    try {
      entries = readdirSync(this.root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      return []
    }
    const summaries: SessionSummary[] = []
    for (const sessionId of entries) {
      const summary = this.summary(sessionId)
      if (summary) summaries.push(summary)
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /** Summary of one session, or undefined when there is none. */
  summary(sessionId: string): SessionSummary | undefined {
    const meta = this.readMeta(sessionId)
    if (meta) {
      return {
        sessionId: meta.sessionId,
        title: meta.title,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        turns: meta.turns,
        ...(meta.permissionMode ? { permissionMode: meta.permissionMode } : {})
      }
    }
    // Fall back to the transcript when meta.json is missing but a transcript
    // exists (for example after a crash between the two writes).
    const transcript = createSessionTranscript({ sessionId, home: this.options.home })
    const read = transcript.read()
    if (read.records.length === 0) return undefined
    const started = read.records.find((record) => record.type === 'session_started')
    const turns = read.records.filter((record) => record.type === 'turn').length
    const firstUser = read.records.find(
      (record) => record.type === 'message' && record.role === 'user'
    )
    const title =
      started && started.type === 'session_started' && started.title
        ? started.title
        : firstUser && firstUser.type === 'message'
          ? sanitizeTitle(firstUser.blocks.map((block) => (block as { text?: string }).text ?? '').join(' '))
          : 'Untitled session'
    const createdAt =
      started && started.type === 'session_started' ? started.ts : this.now()
    return {
      sessionId,
      title,
      createdAt,
      updatedAt: createdAt,
      turns
    }
  }

  /** Read the metadata file of one session. */
  readMeta(sessionId: string): SessionMeta | undefined {
    const file = join(this.directory(sessionId), SESSION_META_FILE)
    if (!isRegularFile(file)) return undefined
    const raw = readPrivateFile(file)
    if (!raw) return undefined
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return undefined
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const meta = parsed as SessionMeta
    if (typeof meta.schemaVersion === 'number' && meta.schemaVersion > TRANSCRIPT_VERSION) {
      return undefined
    }
    return meta
  }

  /** Write (or update) the metadata of one session. */
  writeMeta(meta: SessionMeta): void {
    const directory = this.directory(meta.sessionId)
    ensurePrivateDirectory(directory)
    writeJsonAtomic(join(directory, SESSION_META_FILE), {
      ...meta,
      schemaVersion: TRANSCRIPT_VERSION
    })
  }

  /**
   * Restore a session from disk. This never runs a tool and never widens the
   * permission mode of the restored session.
   */
  restore(sessionId: string): RestoreResult {
    const directory = this.directory(sessionId)
    if (!existsSync(directory)) {
      return {
        status: 'not_found',
        messages: [],
        needsReview: [],
        warnings: [],
        message: `session ${sessionId} was not found`
      }
    }
    const transcript = createSessionTranscript({ sessionId, home: this.options.home })
    const read = transcript.read()
    const warnings: string[] = []
    if (read.unsupported) {
      return {
        status: 'unsupported_schema',
        messages: [],
        needsReview: [],
        warnings,
        message: `session ${sessionId} uses transcript schema ${read.schemaVersion}, newer than supported ${TRANSCRIPT_VERSION}; it was left untouched`
      }
    }
    if (read.corruptLines > 0) {
      warnings.push(
        `${read.corruptLines} transcript line(s) could not be read and were skipped; the original file was kept`
      )
    }
    const records = read.records
    const summary = this.summary(sessionId)
    if (!summary) {
      return {
        status: 'not_found',
        messages: [],
        needsReview: [],
        warnings,
        message: `session ${sessionId} has no readable transcript`
      }
    }
    const review = needsReviewSteps(records).map((record) => {
      const step = record as Extract<TranscriptRecord, { type: 'tool_step' }>
      return {
        name: step.name,
        callId: step.callId,
        ...(step.detail ? { detail: step.detail } : {})
      }
    })
    if (review.length > 0) {
      warnings.push(
        `${review.length} tool step(s) have an unknown outcome and were not replayed; check their result before continuing`
      )
    }
    return {
      status: 'restored',
      summary,
      messages: messagesFromRecords(records) as unknown as Message[],
      transcript,
      needsReview: review,
      warnings
    }
  }

  /** Acquire the writer lock of one session. */
  acquire(sessionId: string, options: { force?: boolean } = {}):
    | { acquired: true; lock: SessionWriterLock }
    | { acquired: false; reason: string } {
    const lock = new SessionWriterLock(sessionId, this.options.home)
    const result = lock.acquire(options)
    if (!result.acquired) return result
    return { acquired: true, lock }
  }
}

/** Convenience factory mirroring the other storage modules. */
export function createSessionStore(options: SessionStoreOptions = {}): SessionStore {
  return new SessionStore(options)
}

/**
 * Initialize a session: create its directory and write the start record.
 * The title is the first user text of the session.
 */
export function startSession(options: {
  sessionId: string
  title?: string
  home?: string
  now?: () => string
}): { transcript: SessionTranscript; directory: string } {
  const directory = ensurePrivateDirectory(sessionDirectory(options.sessionId, options.home))
  const transcript = createSessionTranscript({
    sessionId: options.sessionId,
    home: options.home,
    ...(options.now ? { now: options.now } : {})
  })
  const started = transcript.read().records.find((record) => record.type === 'session_started')
  if (!started) {
    transcript.append({
      type: 'session_started',
      ts: (options.now ?? defaultNow)(),
      schemaVersion: TRANSCRIPT_VERSION,
      sessionId: options.sessionId,
      ...(options.title ? { title: sanitizeTitle(options.title) } : {})
    })
  }
  return { transcript, directory }
}

export { sanitizeTitle }
