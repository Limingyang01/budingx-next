// Atomic JSON writes (SP002 AC MM-01): temporary file, fsync, rename.
import {
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

export function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = temporaryPath(`${file}.${randomUUID()}`)
  const payload = JSON.stringify(value, null, 2) + '\n'
  try {
    const handle = openSync(temporary, 'w')
    try {
      writeFileSync(handle, payload)
      fsyncSync(handle)
    } finally {
      closeSync(handle)
    }
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
