// Atomic JSON writes (SP002 AC MM-01): temporary file, fsync, rename.
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { temporaryPath } from './paths.js'
import { PRIVATE_FILE_MODE, restrictToOwner } from './private-file.js'

/**
 * Tighten a temporary file before it is renamed into place (SP005 review H4).
 * Renaming is atomic, so the final name never exists with inherited
 * permissions: the restriction has to happen on the temporary path.
 */
function sealTemporary(temporary: string): void {
  try {
    chmodSync(temporary, PRIVATE_FILE_MODE)
  } catch {
    // Filesystems without POSIX modes fall back to the ACL pass below.
  }
  restrictToOwner(temporary)
}

export function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = temporaryPath(`${file}.${randomUUID()}`)
  const payload = JSON.stringify(value, null, 2) + '\n'
  try {
    const handle = openSync(temporary, 'w', PRIVATE_FILE_MODE)
    try {
      writeFileSync(handle, payload)
      fsyncSync(handle)
    } finally {
      closeSync(handle)
    }
    sealTemporary(temporary)
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

/**
 * Atomic text write (SP005 design §7): temporary file, fsync, rename.
 * Used for the Markdown memory files, where the payload is text and not JSON.
 */
export function writeTextAtomic(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = temporaryPath(`${file}.${randomUUID()}`)
  try {
    const handle = openSync(temporary, 'w', PRIVATE_FILE_MODE)
    try {
      writeFileSync(handle, content)
      fsyncSync(handle)
    } finally {
      closeSync(handle)
    }
    sealTemporary(temporary)
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
