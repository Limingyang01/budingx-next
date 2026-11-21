// Configuration repository (SP002 design §3.5, AC MM-01/MM-06).
// Atomic writes, schema versioning, unknown field preservation.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { ERROR_CODES } from '../core/constants.js'
import { writeJsonAtomic } from './atomic.js'
import { backupPath, configPath } from './paths.js'

export const CONFIG_VERSION = 1

export type ModelProfile = {
  id: string
  label: string
  baseUrl: string
  model: string
  apiKeyRef: string
  capabilities: { tools: boolean }
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
