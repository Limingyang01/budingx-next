// Atomic file writing with a baseline fingerprint (SP003 design §3.5/§3.6,
// AC WT-04 … WT-06, CP-02/CP-04).
// The fingerprint of the content on disk is re-checked immediately before
// the rename: when something else changed the file since the caller read
// it, the write is refused and the foreign change survives untouched.
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { ERROR_CODES } from '../core/constants.js'
import { WorkspaceError, type Workspace } from './paths.js'

export type WriteOptions = {
  path: string
  content: string
  /** SHA-256 hex of the content the caller last saw; absent for new files. */
  expectedFingerprint?: string
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
  if (!resolved.existed) {
    const parent = dirname(resolved.real)
    if (!existsSync(parent)) {
      throw new WorkspaceError(
        ERROR_CODES.workspaceNotFound,
        `Parent directory does not exist for: ${resolved.relative}`
      )
    }
    if (options.expectedFingerprint !== undefined) {
      throw new WorkspaceError(
        ERROR_CODES.workspaceEditConflict,
        `Expected an existing file but ${resolved.relative} does not exist`
      )
    }
  } else {
    const onDisk = contentFingerprint(readFileSync(resolved.real))
    if (
      options.expectedFingerprint !== undefined &&
      options.expectedFingerprint !== onDisk
    ) {
      throw new WorkspaceError(
        ERROR_CODES.workspaceEditConflict,
        `File changed since it was read; refusing to overwrite: ${resolved.relative}`
      )
    }
  }

  const payload = Buffer.from(options.content, 'utf8')
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
    renameSync(temporary, resolved.real)
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
