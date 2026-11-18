// Atomic file writing with a baseline fingerprint (SP003 design §3.5/§3.6,
// AC WT-04 … WT-06, CP-02/CP-04).
// The fingerprint of the content on disk is re-checked immediately before
// the rename: when something else changed the file since the caller read
// it, the write is refused and the foreign change survives untouched.
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'
import { ERROR_CODES } from '../core/constants.js'
import { WorkspaceError, type Workspace } from './paths.js'

export type WriteOptions = {
  path: string
  content: string
  /** SHA-256 of the prior content, null for expected absence, undefined for no check. */
  expectedFingerprint?: string | null
  expectedPath?: string
  /** Whole-file writes normalize CRLF to LF; Edit supplies false because
   * it preserves the file's dominant line ending itself. */
  normalizeLineEndings?: boolean
}

export type WriteResult = {
  path: string
  bytes: number
  created: boolean
  /** Fingerprint of the content that is now on disk. */
  fingerprint: string
}

export function contentFingerprint(bytes: Uint8Array | string): string {
  return createHash('sha256')
    .update(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes)
    .digest('hex')
}

export function currentFingerprint(workspace: Workspace, path: string): string | undefined {
  const resolved = workspace.resolve(path)
  if (!resolved.existed || resolved.isDirectory) return undefined
  return contentFingerprint(readFileSync(resolved.real))
}

export function writeWorkspaceFile(
  workspace: Workspace,
  options: WriteOptions
): WriteResult {
  const resolved = workspace.resolve(options.path)
  if (resolved.existed && resolved.isDirectory) {
    throw new WorkspaceError(
      ERROR_CODES.workspaceNotAFile,
      `Path is a directory: ${resolved.relative}`
    )
  }
  function checkBaseline(): void {
    const current = workspace.resolve(options.path)
    if (current.real !== resolved.real ||
        (options.expectedPath !== undefined && current.real !== options.expectedPath)) {
      throw new WorkspaceError(ERROR_CODES.workspaceEditConflict, `File path changed before writing: ${resolved.relative}`)
    }
    if (options.expectedFingerprint === undefined) return
    const fingerprint = current.existed && !current.isDirectory
      ? contentFingerprint(readFileSync(current.real))
      : null
    if (current.isDirectory || options.expectedFingerprint !== fingerprint) {
      throw new WorkspaceError(
        ERROR_CODES.workspaceEditConflict,
        `File changed since it was read; refusing to overwrite: ${resolved.relative}`
      )
    }
  }
  checkBaseline()
  if (!resolved.existed) mkdirSync(dirname(resolved.real), { recursive: true })

  // Whole-file writes normalize line endings to LF. The reference learned
  // the hard way that keeping an old file's CRLF here breaks shell
  // scripts: Write is a replacement, Edit is the line-ending-preserving
  // path.
  const payload = Buffer.from(
    options.normalizeLineEndings === false
      ? options.content
      : options.content.replace(/\r\n/g, '\n'),
    'utf8'
  )
  const temporary = `${resolved.real}.budingx-${process.pid}-${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, payload)
    if (resolved.existed) {
      try {
        chmodSync(temporary, statSync(resolved.real).mode & 0o7777)
      } catch {
        // Mode preservation is best effort (Windows has no POSIX mode).
      }
    }
    checkBaseline()
    if (options.expectedFingerprint === null) {
      // A create must stay exclusive even if a file appears at the last moment.
      linkSync(temporary, resolved.real)
      rmSync(temporary, { force: true })
    } else {
      renameSync(temporary, resolved.real)
    }
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
  return {
    path: resolved.relative,
    bytes: payload.length,
    created: !resolved.existed,
    fingerprint: contentFingerprint(payload)
  }
}
