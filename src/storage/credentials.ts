// Credential repository (SP002 design §3.5, AC MM-04/MM-05).
// Keys live in a dedicated file, bound to (profile id, base url host) so a key
// is never forwarded to a different host.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { ERROR_CODES } from '../core/constants.js'
import { writeJsonAtomic } from './atomic.js'
import { backupPath, credentialsPath } from './paths.js'

export const CREDENTIALS_VERSION = 1

export type CredentialsFile = {
  version: number
  keys: Record<string, string>
  hosts?: Record<string, string>
  [key: string]: unknown
}

export class CredentialStore {
  constructor(private readonly file: string = credentialsPath()) {}

  get path(): string {
    return this.file
  }

  load(): CredentialsFile {
    if (!existsSync(this.file)) return { version: CREDENTIALS_VERSION, keys: {} }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      throw new Error(
        `Credential file is corrupt; remove it and re-enter the key (${ERROR_CODES.storageConfigCorrupt})`
      )
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Credential file is not a JSON object')
    }
    const file = parsed as CredentialsFile
    if (typeof file.keys !== 'object' || file.keys === null) file.keys = {}
    if (typeof file.hosts !== 'object' || file.hosts === null) file.hosts = {}
    return file
  }

  save(file: CredentialsFile): void {
    writeJsonAtomic(this.file, file)
  }

  /** The key is only returned when it is bound to the same host. */
  get(id: string, host: string): string | undefined {
    const file = this.load()
    const key = file.keys[id]
    if (typeof key !== 'string') return undefined
    const boundHost = file.hosts?.[id]
    if (!boundHost || boundHost !== host) return undefined
    return key
  }

  set(id: string, host: string, key: string): void {
    const file = this.load()
    file.keys[id] = key
    file.hosts = file.hosts ?? {}
    file.hosts[id] = host
    this.save(file)
  }

  remove(id: string): void {
    const file = this.load()
    delete file.keys[id]
    if (file.hosts) delete file.hosts[id]
    this.save(file)
  }

  /** Credentials without a profile are reported, never deleted silently. */
  orphanIds(knownIds: string[]): string[] {
    const file = this.load()
    const known = new Set(knownIds)
    return Object.keys(file.keys).filter((id) => !known.has(id))
  }

  list(): { id: string; host: string }[] {
    const file = this.load()
    return Object.keys(file.keys).map((id) => ({
      id,
      host: file.hosts?.[id] ?? ''
    }))
  }

  backup(): void {
    if (!existsSync(this.file)) return
    try {
      writeFileSync(backupPath(this.file), readFileSync(this.file))
    } catch {
      // keep the original file when the backup fails
    }
  }
}
