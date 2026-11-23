// Configuration repository (SP002 design §3.5, AC MM-01/MM-06).
// Atomic writes, schema versioning, unknown field preservation.
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { ERROR_CODES } from '../core/constants.js'
import { writeJsonAtomic } from './atomic.js'
import { backupPath, configPath } from './paths.js'
import { createPrivateFileExclusive, readPrivateFile } from './private-file.js'

export const CONFIG_VERSION = 1

/** Wire protocol of the endpoint (SP007 PC-02). Absent means openai (legacy profiles). */
export type ModelProtocol = 'openai' | 'anthropic'

export type ModelProfile = {
  id: string
  label: string
  baseUrl: string
  model: string
  apiKeyRef: string
  capabilities: { tools: boolean; vision?: boolean }
  protocol?: ModelProtocol
  /**
   * Context window in tokens (SP009 0.9.1 LC-02). Custom models can declare
   * their own window; absent means "resolve automatically" (env override →
   * this field → discovered provider metadata → default).
   */
  contextWindow?: number
  createdAt: string
  updatedAt: string
  [key: string]: unknown
}

/** External status line command (SP006 design §4.4/§4.5). */
export type StatusLineConfig = {
  type: 'command'
  command: string
  args?: string[]
  padding?: number
  /** Milliseconds before the command is killed; defaults to 5000. */
  timeoutMs?: number
}

export type ConfigFile = {
  version: number
  /** null opts out of startup selection. Older files can omit this field. */
  defaultModelId?: string | null
  models: ModelProfile[]
  /** Optional external status line command; absent means built-in footer only. */
  statusLine?: StatusLineConfig
  [key: string]: unknown
}

export class ConfigStoreError extends Error {
  constructor(
    message: string,
    readonly code: string = ERROR_CODES.storageConfigCorrupt
  ) {
    super(message)
    this.name = 'ConfigStoreError'
  }
}

function emptyConfig(): ConfigFile {
  return { version: CONFIG_VERSION, models: [] }
}

/** Lock file used by ConfigStore.update (SP008 §3.5). */
export function configLockPath(file: string): string {
  return file + '.lock'
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function lockOwnerPid(lockFile: string): number | undefined {
  const raw = readPrivateFile(lockFile)
  if (!raw) return undefined
  const pid = Number(raw.split('\n')[0])
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

/** Returns true when a stale lock was removed and the caller may retry. */
function clearStaleConfigLock(lockFile: string): boolean {
  const pid = lockOwnerPid(lockFile)
  if (pid !== undefined && processAlive(pid)) return false
  if (pid === undefined) {
    // A lock whose content cannot be read is only cleared once it is old
    // enough that a concurrent create cannot still be in progress.
    try {
      if (Date.now() - statSync(lockFile).mtimeMs < 10_000) return false
    } catch {
      return true
    }
  }
  try {
    rmSync(lockFile, { force: true })
    return true
  } catch {
    return false
  }
}

function releaseConfigLock(lockFile: string): void {
  if (lockOwnerPid(lockFile) !== process.pid) return
  try {
    rmSync(lockFile, { force: true })
  } catch {
    // Releasing a lock must never throw.
  }
}

export class ConfigStore {
  constructor(private readonly file: string = configPath()) {}

  get path(): string {
    return this.file
  }

  load(): ConfigFile {
    if (!existsSync(this.file)) return emptyConfig()
    let raw: string
    try {
      raw = readFileSync(this.file, 'utf8')
    } catch (error) {
      throw new ConfigStoreError(
        `Cannot read configuration: ${(error as Error).message}`
      )
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.backup()
      throw new ConfigStoreError(
        'Configuration file is corrupt; a backup was kept and nothing was erased'
      )
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.backup()
      throw new ConfigStoreError('Configuration file is not a JSON object')
    }
    const config = parsed as ConfigFile
    const version = typeof config.version === 'number' ? config.version : 0
    if (version > CONFIG_VERSION) {
      throw new ConfigStoreError(
        `Configuration schema ${version} is newer than supported ${CONFIG_VERSION}`,
        ERROR_CODES.storageSchemaUnsupported
      )
    }
    if (version < CONFIG_VERSION) {
      const migrated = this.migrate(config, version)
      this.save(migrated)
      return migrated
    }
    if (!Array.isArray(config.models)) config.models = []
    return config
  }

  save(config: ConfigFile): void {
    try {
      writeJsonAtomic(this.file, config)
    } catch (error) {
      throw new ConfigStoreError(
        `Cannot write configuration: ${(error as Error).message}`
      )
    }
  }

  /**
   * Shared read-modify-write for configs used by several processes (SP008
   * SH-01/SH-02). The lock is taken first, then the file is re-read so a
   * concurrent update is never lost, and the write stays atomic. A live
   * holder makes the caller wait up to timeoutMs before failing with
   * BUDINGX_STORAGE_006; a crashed holder (dead pid) is cleared.
   */
  update(
    mutate: (config: ConfigFile) => ConfigFile | void,
    options: { timeoutMs?: number; retryDelayMs?: number } = {}
  ): ConfigFile {
    const lockFile = configLockPath(this.file)
    const timeoutMs = options.timeoutMs ?? 2000
    const retryDelayMs = Math.max(1, options.retryDelayMs ?? 10)
    this.acquireLock(lockFile, timeoutMs, retryDelayMs)
    try {
      const current = this.load()
      const next = mutate(current) ?? current
      this.save(next)
      return next
    } finally {
      releaseConfigLock(lockFile)
    }
  }

  private acquireLock(lockFile: string, timeoutMs: number, retryDelayMs: number): void {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try {
        createPrivateFileExclusive(lockFile, `${process.pid}\n${new Date().toISOString()}\n`)
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') {
          throw new ConfigStoreError(
            `Cannot lock configuration: ${(error as Error).message}`
          )
        }
      }
      if (clearStaleConfigLock(lockFile)) continue
      if (Date.now() >= deadline) {
        throw new ConfigStoreError(
          'Configuration is being updated by another process; retry later',
          ERROR_CODES.storageSessionLocked
        )
      }
      sleepSync(retryDelayMs)
    }
  }

  /** Keep a copy before a migration or a corrupt file is replaced. */
  backup(): void {
    if (!existsSync(this.file)) return
    try {
      writeFileSync(backupPath(this.file), readFileSync(this.file))
    } catch {
      // A failing backup must not destroy the original file.
    }
  }

  private migrate(config: ConfigFile, version: number): ConfigFile {
    this.backup()
    const migrated: ConfigFile = { ...config, version: CONFIG_VERSION }
    if (!Array.isArray(migrated.models)) migrated.models = []
    if (version < 1) {
      // v0 had no models list; keep any legacy single model as the default.
      const legacy = migrated as { baseUrl?: unknown; model?: unknown }
      if (typeof legacy.baseUrl === 'string' && typeof legacy.model === 'string') {
        migrated.models.push({
          id: 'legacy',
          label: 'legacy',
          baseUrl: legacy.baseUrl,
          model: legacy.model,
          apiKeyRef: 'legacy',
          capabilities: { tools: false },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
      }
    }
    return migrated
  }
}
