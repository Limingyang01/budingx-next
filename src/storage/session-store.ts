// Session index, cross-process recovery and writer locking (SP005 design §5,
// AC SR-01..SR-11).
//
// The store never re-executes anything. Restoring a session gives back the
// transcript contents, the recorded permission mode and the list of tool
// steps whose outcome is unknown; the caller decides what to do next.
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { ChangeRecordSummary, Message as CoreMessage } from '../core/events.js'
import type { PermissionMode } from '../core/permissions.js'
import { unfinishedToolCalls } from '../core/context-budget.js'
import type { SessionWorktreeBinding } from '../core/transcript.js'
import { writeJsonAtomic } from './atomic.js'
import {
  createPrivateFileExclusive,
  ensurePrivateDirectory,
  isRegularFile,
  readPrivateFile,
  sessionDirectory,
  writePrivateFile
} from './private-file.js'
import {
  TRANSCRIPT_FILE,
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
const SESSION_SEARCH_LIMIT = 200
const SESSION_SEARCH_TEXT_BYTES = 256 * 1024

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
  userTitle?: string
  forkedFrom?: { sessionId: string; messageId?: string }
}

export type SessionChangeResult = { ok: true; sessionId: string } | { ok: false; message: string }
export type SessionSearchEntry = SessionSummary & { body: string }

export type RestoreStatus = 'restored' | 'not_found' | 'unsupported_schema' | 'corrupt' | 'locked' | 'workspace_mismatch'

export type RestoreResult = {
  status: RestoreStatus
  summary?: SessionSummary
  messages: Message[]
  transcript?: SessionTranscript
  changes?: ChangeRecordSummary[]
  worktree?: SessionWorktreeBinding
  worktreeOriginBranch?: string
  /** Tool steps whose outcome is unknown; must be checked, never replayed. */
  needsReview: { name: string; callId: string; detail?: string }[]
  /** Non-fatal problems found while reading (e.g. skipped corrupt lines). */
  warnings: string[]
  message?: string
}

export type SessionStoreOptions = {
  home?: string
  now?: () => string
  /** Pass the same canonical root that the workspace tools use. */
  workspaceRoot?: string
}

/** Messages restored from a transcript. */
type Message = { id: string; role: 'user' | 'assistant' | 'tool'; blocks: unknown[] }

function defaultNow(): string {
  return new Date().toISOString()
}

export function sessionWorkspaceId(root: string): string {
  return createHash('sha256').update(resolve(root)).digest('hex')
}

export function validSessionId(sessionId: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,127}$/i.test(sessionId)
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
/** Observed writer-lock state; `active` means the pid is alive right now. */
export type WriterLockInfo = {
  pid?: number
  createdAt?: string
  active: boolean
}

export class SessionWriterLock {
  private readonly file: string
  /** True only while this instance is the process that created the lock. */
  private owned = false

  constructor(
    sessionId: string,
    private readonly home?: string
  ) {
    this.file = join(sessionDirectory(sessionId, home), WRITER_LOCK_FILE)
  }

  get path(): string {
    return this.file
  }

  /** True while this instance created the lock and has not released it. */
  get isOwned(): boolean {
    return this.owned
  }

  /**
   * Observe the lock without changing it. Callers get the pid and creation
   * time and decide from `active` whether a writer is alive; they must not
   * parse the human-readable acquisition reason.
   */
  inspect(): WriterLockInfo {
    const raw = readPrivateFile(this.file)
    if (raw === undefined) return { active: false }
    const lines = raw.split('\n')
    const pid = Number(lines[0])
    const createdAt = lines[1]?.trim()
    const validPid = Number.isFinite(pid) && pid > 0
    return {
      ...(validPid ? { pid } : {}),
      ...(createdAt ? { createdAt } : {}),
      active: validPid ? isProcessAlive(pid) : false
    }
  }

  /**
   * Try to take the lock.
   *
   * The lock is created with an exclusive create (O_EXCL), so two processes
   * racing for the same session can never both succeed (SP005 review H1).
   * A live owner is rejected; a stale lock is never removed silently and
   * requires an explicit force takeover.
   */
  acquire(options: { force?: boolean } = {}): { acquired: true } | { acquired: false; reason: string } {
    ensurePrivateDirectory(join(this.file, '..'))
    const first = this.tryCreate()
    if (first === 'created') return { acquired: true }
    if (first !== 'exists') return { acquired: false, reason: first }

    const owner = this.readOwner()
    if (owner !== undefined && isProcessAlive(owner)) {
      return { acquired: false, reason: `session is locked by a running process (pid ${owner})` }
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
      // The exclusive create below still decides the outcome.
    }
    const takeover = this.tryCreate()
    if (takeover === 'created') return { acquired: true }
    return {
      acquired: false,
      reason: takeover === 'exists' ? 'another process took the lock first' : takeover
    }
  }

  /** Create the lock file atomically; 'exists' means somebody got there first. */
  private tryCreate(): 'created' | 'exists' | string {
    try {
      createPrivateFileExclusive(this.file, `${process.pid}\n${defaultNow()}\n`)
      this.owned = true
      return 'created'
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code === 'EEXIST') return 'exists'
      return error instanceof Error ? error.message : String(error)
    }
  }

  private readOwner(): number | undefined {
    const raw = readPrivateFile(this.file)
    if (!raw) return undefined
    const pid = Number(raw.split('\n')[0])
    return Number.isFinite(pid) && pid > 0 ? pid : undefined
  }

  /**
   * Release the lock. Only the process that created it may remove it
   * (SP005 review H2: an unconditional remove let a non-owner delete another
   * process's lock, after which a third process could acquire it too).
   */
  release(): void {
    const wasOwned = this.owned
    this.owned = false
    if (!wasOwned) return
    const owner = this.readOwner()
    if (owner !== undefined && owner !== process.pid) return
    try {
      rmSync(this.file, { force: true })
    } catch {
      // Releasing a lock must never throw.
    }
  }
}

/** Inspect the writer lock of a session without acquiring it. */
export function inspectWriterLock(sessionId: string, home?: string): WriterLockInfo {
  return new SessionWriterLock(sessionId, home).inspect()
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
    if (!validSessionId(sessionId)) return undefined
    const transcript = createSessionTranscript({ sessionId, home: this.options.home })
    return this.summarize(sessionId, transcript.read().records)
  }

  searchIndex(): SessionSearchEntry[] {
    const entries: SessionSearchEntry[] = []
    for (const summary of this.list().slice(0, SESSION_SEARCH_LIMIT)) {
      const read = createSessionTranscript({ sessionId: summary.sessionId, home: this.options.home }).read()
      if (read.unsupported || read.corruptLines || !read.records.length || !this.ownsTranscript(read.records)) continue
      const messages = messagesFromRecords(read.records)
      const chunks: string[] = []
      let remaining = SESSION_SEARCH_TEXT_BYTES
      for (let index = messages.length - 1; index >= 0 && remaining > 0; index--) {
        const message = messages[index]
        if (message.role === 'tool' || message.notificationDisplay) continue
        const text = message.blocks.flatMap((block) => block.type === 'text' ? [block.text] : []).join('')
        if (!text) continue
        const bytes = Buffer.from(text + '\n')
        const firstByte = Math.max(0, bytes.length - remaining)
        // If the boundary falls inside a UTF-8 character, start from the next character.
        let start = firstByte
        while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++
        chunks.unshift(bytes.toString('utf8', start))
        remaining -= bytes.length - firstByte
      }
      entries.push({ ...summary, body: chunks.join('') })
    }
    return entries
  }

  private ownsTranscript(records: TranscriptRecord[]): boolean {
    const root = this.options.workspaceRoot
    if (root === undefined) return true
    const started = records.find((record) => record.type === 'session_started')
    return started?.workspaceId === sessionWorkspaceId(root)
  }

  private summarize(sessionId: string, records: TranscriptRecord[]): SessionSummary | undefined {
    if (!this.ownsTranscript(records)) return undefined
    const meta = this.readMeta(sessionId)
    if (!meta && records.length === 0) return undefined
    const started = records.find((record) => record.type === 'session_started')
    const turns = records.filter((record) => record.type === 'turn').length
    const firstUser = records.find(
      (record): record is Extract<TranscriptRecord, { type: 'message' }> => record.type === 'message' && record.role === 'user'
    )
    const derivedTitle = meta?.title ?? started?.title ??
      (firstUser ? sanitizeTitle(firstUser.blocks.map((block) => (block as { text?: string }).text ?? '').join(' ')) : 'Untitled session')
    const createdAt = meta?.createdAt ?? started?.ts ?? this.now()
    const permission = records.findLast((record) => record.type === 'permission_mode' && isPermissionMode(record.mode))
    const permissionMode = permission?.type === 'permission_mode' ? permission.mode : meta?.permissionMode
    const updatedAt = records.reduce(
      (latest, record) => record.type !== 'session_started' && typeof record.ts === 'string' && record.ts > latest ? record.ts : latest,
      meta?.updatedAt ?? createdAt
    )
    return {
      sessionId,
      title: typeof meta?.userTitle === 'string' && meta.userTitle ? meta.userTitle : derivedTitle,
      createdAt,
      updatedAt,
      turns: Math.max(meta?.turns ?? 0, turns),
      ...(permissionMode ? { permissionMode } : {})
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

  rename(sessionId: string, title: string, writer: SessionWriterLock): SessionChangeResult {
    if (!validSessionId(sessionId) || !writer.isOwned || writer.path !== join(this.directory(sessionId), WRITER_LOCK_FILE)) {
      return { ok: false, message: 'Session is not owned by this writer' }
    }
    const userTitle = title.trim()
    if (!userTitle || /\p{Cc}/u.test(userTitle) || Array.from(userTitle).length > 80) {
      return { ok: false, message: 'Provide a single-line title of 1–80 characters' }
    }
    try {
      const summary = this.summary(sessionId)
      if (!summary) return { ok: false, message: 'Session has no readable metadata or transcript' }
      const existing = this.readMeta(sessionId)
      this.writeMeta({
        ...summary,
        ...existing,
        schemaVersion: TRANSCRIPT_VERSION,
        sessionId,
        userTitle,
        updatedAt: this.now()
      })
      return { ok: true, sessionId }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Session rename failed' }
    }
  }

  fork(sourceId: string, options: { permissionMode?: PermissionMode; messages?: readonly CoreMessage[] } = {}): SessionChangeResult {
    if (!validSessionId(sourceId)) return { ok: false, message: 'Invalid source session ID' }
    const transcript = createSessionTranscript({ sessionId: sourceId, home: this.options.home })
    const read = transcript.read()
    const started = read.records.find((record) => record.type === 'session_started')
    const source = this.summarize(sourceId, read.records)
    if (read.unsupported || read.corruptLines || !started || !source) {
      return { ok: false, message: 'Source session is missing, damaged, or belongs to a different workspace' }
    }
    const at = this.now()
    const sessionId = randomUUID()
    const title = sanitizeTitle(`分支 · ${source.title}`)
    const messages = options.messages ? [...options.messages] : messagesFromRecords(read.records)
    const messageId = messages.at(-1)?.id
    const known = new Set(read.records.flatMap((record) => record.type === 'tool_step' ? [record.callId] : []))
    const review: TranscriptRecord[] = unfinishedToolCalls(messages)
      .filter(({ callId }) => !known.has(callId))
      .map(({ callId, name }) => ({
        type: 'tool_step', ts: at, turnId: sessionId, callId, name,
        status: 'needs_review', detail: 'Copied from a source session with an unfinished tool call'
      }))
    const rank: Record<PermissionMode, number> = { read_only: 0, workspace_edit: 1, full_access: 2 }
    const permissionMode = source.permissionMode && options.permissionMode &&
      rank[options.permissionMode] < rank[source.permissionMode] ? options.permissionMode :
      source.permissionMode ?? options.permissionMode
    const previousMessages = new Map(read.records.flatMap((record) =>
      record.type === 'message' ? [[record.id, record] as const] : []
    ))
    const records: TranscriptRecord[] = [
      { type: 'session_started', ts: at, schemaVersion: TRANSCRIPT_VERSION, sessionId, title, workspaceId: started.workspaceId },
      ...messages.map((message) => ({
        ...previousMessages.get(message.id),
        ...message,
        ts: previousMessages.get(message.id)?.ts ?? at,
        type: 'message' as const
      })),
      ...read.records.filter((record) =>
        record.type === 'turn' || record.type === 'tool_step' || record.type === 'permission_mode'
      ),
      ...review,
      ...(permissionMode ? [{ type: 'permission_mode' as const, ts: at, mode: permissionMode }] : [])
    ]
    const meta: SessionMeta = {
      schemaVersion: TRANSCRIPT_VERSION, sessionId, title, createdAt: at, updatedAt: at, turns: source.turns,
      ...(permissionMode ? { permissionMode } : {}),
      forkedFrom: { sessionId: sourceId, ...(messageId ? { messageId } : {}) }
    }
    let stage: string | undefined
    try {
      stage = mkdtempSync(join(ensurePrivateDirectory(this.root), '.fork-'))
      writePrivateFile(join(stage, TRANSCRIPT_FILE), records.map((record) => JSON.stringify(record)).join('\n') + '\n')
      writeJsonAtomic(join(stage, SESSION_META_FILE), meta)
      renameSync(stage, this.directory(sessionId))
      return { ok: true, sessionId }
    } catch (error) {
      if (stage) {
        for (const file of [TRANSCRIPT_FILE, SESSION_META_FILE]) {
          try { rmSync(join(stage, file), { force: true }) } catch {}
        }
        try { rmdirSync(stage) } catch {}
      }
      return { ok: false, message: error instanceof Error ? error.message : 'Session fork failed' }
    }
  }

  /**
   * Restore a session from disk. This never runs a tool and never widens the
   * permission mode of the restored session.
   */
  restore(sessionId: string): RestoreResult {
    if (!validSessionId(sessionId) || !existsSync(this.directory(sessionId))) {
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
    if (!this.ownsTranscript(records)) {
      return {
        status: 'workspace_mismatch',
        messages: [],
        needsReview: [],
        warnings: [],
        message: 'Session belongs to another workspace or has no saved workspace identity'
      }
    }
    const summary = this.summarize(sessionId, records)
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
    const worktree = records.findLast((record) => record.type === 'worktree_binding')
    return {
      status: 'restored',
      summary,
      messages: messagesFromRecords(records) as unknown as Message[],
      transcript,
      changes: records.flatMap((record) => record.type === 'change_set' && Array.isArray(record.changes) ? record.changes : []),
      ...(worktree?.type === 'worktree_binding'
        ? { worktree: worktree.binding, worktreeOriginBranch: worktree.originBranch }
        : {}),
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
  workspaceRoot?: string
}): { transcript: SessionTranscript; directory: string } {
  if (!validSessionId(options.sessionId)) throw new Error('Invalid session ID')
  const directory = ensurePrivateDirectory(sessionDirectory(options.sessionId, options.home))
  const transcript = createSessionTranscript({
    sessionId: options.sessionId,
    home: options.home,
    ...(options.now ? { now: options.now } : {})
  })
  const read = transcript.read()
  if (read.unsupported) throw new Error('Session transcript uses an unsupported schema')
  const started = read.records.find((record) => record.type === 'session_started')
  const workspaceId = options.workspaceRoot === undefined ? undefined : sessionWorkspaceId(options.workspaceRoot)
  if (workspaceId && (read.records.length > 0 || read.corruptLines > 0) && started?.workspaceId !== workspaceId) {
    throw new Error('Existing session cannot be attached to this workspace')
  }
  if (!started) {
    transcript.append({
      type: 'session_started',
      ts: (options.now ?? defaultNow)(),
      schemaVersion: TRANSCRIPT_VERSION,
      sessionId: options.sessionId,
      ...(workspaceId ? { workspaceId } : {}),
      ...(options.title ? { title: sanitizeTitle(options.title) } : {})
    })
  }
  return { transcript, directory }
}

export { sanitizeTitle }
