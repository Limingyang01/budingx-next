// Project memory (SP005 design §7, AC PM-01..PM-08).
//
// Layout:
//   ~/.budingx/memory/projects/<projectKey>/MEMORY.md   project scoped notes
//   ~/.budingx/memory/sessions/<sessionId>/MEMORY.md   session scoped notes
//
// Project and session memory live in different directories, so one project can
// never see another project's notes and a sibling session never sees another
// session's notes. Nothing is ever written into the user's project directory.
//
// Entries look like:
//
//   ## <entryId> · <title>
//   - created: 2026-01-01T00:00:00.000Z
//   - scope: project
//   <body>
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { writeTextAtomic } from './atomic.js'
import { backupPath, dataRoot } from './paths.js'
import {
  ensurePrivateDirectory,
  isRegularFile,
  readPrivateFile,
  restrictToOwner,
  writePrivateFile
} from './private-file.js'

/** Name of the memory file inside a memory directory. */
export const MEMORY_FILE = 'MEMORY.md'
/** Maximum size of one entry body in characters. */
export const MAX_ENTRY_CHARS = 20000
/** Maximum number of entries in one memory file. */
export const MAX_ENTRIES = 200

export type MemoryScope = 'project' | 'session'

export type MemoryEntry = {
  id: string
  title: string
  body: string
  scope: MemoryScope
  createdAt: string
}

export type MemoryRead = {
  entries: MemoryEntry[]
  /** The file could not be parsed; the original was kept and backed up. */
  corrupt: boolean
  corruptReason?: string
}

export type MemoryWriteResult =
  | { ok: true; entry: MemoryEntry; file: string }
  | { ok: false; code: string; message: string }

export type ProjectMemoryOptions = {
  home?: string
  /** Workspace root of the project; used to derive a stable project key. */
  projectRoot?: string
  /** Session id, used for session scoped memory. */
  sessionId?: string
  now?: () => string
  /**
   * Injectable writer used by the tests to prove that a failed write leaves
   * the previous content untouched (AC PM-04). The production default writes
   * atomically (temporary file, fsync, rename).
   */
  writeFile?: (file: string, content: string) => void
}

function defaultNow(): string {
  return new Date().toISOString()
}

/**
 * Stable, path safe key of a project directory: the sanitized directory name
 * plus a short hash of the normalized absolute path. Two different roots
 * never share a key; the same root always maps to the same key.
 */
export function projectKeyOf(projectRoot: string): string {
  const normalized = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 16)
  const name = projectRoot.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? 'project'
  const safeName = name.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 40) || 'project'
  return `${safeName}-${hash}`
}

/** Directory of the project scoped memory. */
export function projectMemoryDirectory(projectRoot: string, home?: string): string {
  return join(dataRoot(home), 'memory', 'projects', projectKeyOf(projectRoot))
}

/** Directory of the session scoped memory. */
export function sessionMemoryDirectory(sessionId: string, home?: string): string {
  return join(dataRoot(home), 'memory', 'sessions', sessionId)
}

/** Path of the memory file of one scope. */
export function memoryFilePath(scope: MemoryScope, options: ProjectMemoryOptions): string {
  const directory =
    scope === 'project'
      ? options.projectRoot
        ? projectMemoryDirectory(options.projectRoot, options.home)
        : join(dataRoot(options.home), 'memory', 'projects')
      : options.sessionId
        ? sessionMemoryDirectory(options.sessionId, options.home)
        : join(dataRoot(options.home), 'memory', 'sessions')
  return join(directory, MEMORY_FILE)
}

/** Credential style content is refused instead of being written (PM-05). */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bsk-[A-Za-z0-9_-]{8,}\b/,
  /\bgh[posru]_[A-Za-z0-9]{16,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/,
  /\b(?:api[_-]?key|secret(?:[_-]?key)?|password|passwd|authorization|(?:access[_-]?|refresh[_-]?)?token|private[_-]?key|client[_-]?secret)\s*[:=]\s*\S+/i
]

/** True when the text carries credential style content. */
export function containsCredential(text: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text))
}

function parseEntries(raw: string): { entries: MemoryEntry[]; corrupt: boolean; corruptReason?: string } {
  const lines = raw.split('\n')
  const entries: MemoryEntry[] = []
  let current: MemoryEntry | undefined
  const body: string[] = []
  const flush = () => {
    if (current) {
      entries.push({ ...current, body: body.join('\n').trim() })
    }
    current = undefined
    body.length = 0
  }
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/)
    if (heading) {
      flush()
      const raw = heading[1]
      const separator = raw.indexOf('·')
      const id = separator >= 0 ? raw.slice(0, separator).trim() : raw.trim()
      const title = separator >= 0 ? raw.slice(separator + 1).trim() : ''
      current = { id, title, body: '', scope: 'project', createdAt: '' }
      continue
    }
    const meta = line.match(/^-\s+created:\s*(.+)$/)
    if (meta && current) {
      current.createdAt = meta[1].trim()
      continue
    }
    const scopeMeta = line.match(/^-\s+scope:\s*(.+)$/)
    if (scopeMeta && current) {
      current.scope = scopeMeta[1].trim() === 'session' ? 'session' : 'project'
      continue
    }
    if (current) body.push(line)
  }
  flush()
  return { entries, corrupt: false }
}

function serializeEntry(entry: MemoryEntry): string {
  return [
    `## ${entry.id} · ${entry.title}`,
    `- created: ${entry.createdAt}`,
    `- scope: ${entry.scope}`,
    '',
    entry.body.trim(),
    ''
  ].join('\n')
}

/**
 * Memory store for one scope. Writes are atomic and never destroy the
 * original file: a failed write leaves the previous content in place.
 */
export class ProjectMemory {
  private readonly file: string
  private readonly scope: MemoryScope
  private readonly now: () => string
  private readonly writeFile: (file: string, content: string) => void

  constructor(options: ProjectMemoryOptions, scope: MemoryScope = 'project') {
    this.scope = scope
    this.file = memoryFilePath(scope, options)
    this.now = options.now ?? defaultNow
    this.writeFile = options.writeFile ?? writeTextAtomic
  }

  get path(): string {
    return this.file
  }

  get scopeName(): MemoryScope {
    return this.scope
  }

  /** Read all entries. A corrupt file is kept and backed up. */
  read(): MemoryRead {
    if (!isRegularFile(this.file)) return { entries: [], corrupt: false }
    const raw = readPrivateFile(this.file)
    if (raw === undefined) return { entries: [], corrupt: false }
    try {
      return parseEntries(raw)
    } catch (error) {
      this.backup()
      return {
        entries: [],
        corrupt: true,
        corruptReason: `memory file is corrupt; a backup was kept and the original was not erased (${
          error instanceof Error ? error.message : String(error)
        })`
      }
    }
  }

  /** Append one entry. */
  write(title: string, body: string): MemoryWriteResult {
    const trimmedBody = body.trim()
    if (!trimmedBody) {
      return { ok: false, code: 'memoryEmpty', message: 'memory entry body must not be empty' }
    }
    if (trimmedBody.length > MAX_ENTRY_CHARS) {
      return {
        ok: false,
        code: 'memoryEntryTooLong',
        message: `memory entry is ${trimmedBody.length} characters; the limit is ${MAX_ENTRY_CHARS}`
      }
    }
    if (containsCredential(trimmedBody) || containsCredential(title)) {
      return {
        ok: false,
        code: 'memorySecretRejected',
        message: 'memory entry looks like it contains a credential and was refused'
      }
    }
    const current = this.read()
    if (current.corrupt) {
      return {
        ok: false,
        code: 'memoryCorrupt',
        message: current.corruptReason ?? 'memory file is corrupt'
      }
    }
    if (current.entries.length >= MAX_ENTRIES) {
      return {
        ok: false,
        code: 'memoryTooManyEntries',
        message: `memory file already holds ${current.entries.length} entries; the limit is ${MAX_ENTRIES}`
      }
    }
    const entry: MemoryEntry = {
      id: createHash('sha256')
        .update(`${this.now()}|${title}|${trimmedBody}`)
        .digest('hex')
        .slice(0, 12),
      title: title.trim() || 'Untitled note',
      body: trimmedBody,
      scope: this.scope,
      createdAt: this.now()
    }
    const previous = existsSync(this.file) ? (readPrivateFile(this.file) ?? '') : ''
    const content = previous + (previous.endsWith('\n') || previous === '' ? '' : '\n') + serializeEntry(entry)
    try {
      ensurePrivateDirectory(join(this.file, '..'))
      // The write is atomic: a failure leaves the previous content in place.
      this.writeFile(this.file, content)
      // The private ACL pass runs after the atomic rename so the file is
      // never briefly readable by other principals.
      restrictToOwner(this.file)
    } catch (error) {
      return {
        ok: false,
        code: 'memoryWriteFailed',
        message: error instanceof Error ? error.message : String(error)
      }
    }
    return { ok: true, entry, file: this.file }
  }

  /** Remove one entry by id. */
  remove(id: string): boolean {
    const current = this.read()
    const kept = current.entries.filter((entry) => entry.id !== id)
    if (kept.length === current.entries.length) return false
    const content = ['# Memory', '']
      .concat(kept.flatMap((entry) => serializeEntry(entry).split('\n')))
      .join('\n')
    writeTextAtomic(this.file, content.endsWith('\n') ? content : content + '\n')
    return true
  }

  private backup(): void {
    try {
      const raw = readPrivateFile(this.file)
      if (raw === undefined) return
      writePrivateFile(backupPath(this.file), raw)
    } catch {
      // A failing backup must not destroy the original file.
    }
  }
}

/** Factory for the project scoped memory of one workspace root. */
export function createProjectMemory(options: ProjectMemoryOptions): ProjectMemory {
  return new ProjectMemory(options, 'project')
}

/** Factory for the session scoped memory. */
export function createSessionMemory(options: ProjectMemoryOptions): ProjectMemory {
  return new ProjectMemory(options, 'session')
}

/**
 * Read the memory text that is injected into the model context. Returns an
 * empty string when there is nothing to inject.
 */
export function memoryContextText(scope: MemoryScope, options: ProjectMemoryOptions): string {
  const memory = new ProjectMemory(options, scope)
  const read = memory.read()
  if (read.entries.length === 0) return ''
  const lines = read.entries.map((entry) => `- [${entry.title}] ${entry.body.replace(/\n+/g, ' ')}`)
  return [`<${scope}_memory source="${memory.path}">`, ...lines, `</${scope}_memory>`].join('\n')
}
