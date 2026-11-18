// Permission rule persistence (SP003 design §3.3.3, AC PC-07/PC-11).
// File: ~/.budingx/permissions.json, schemaVersion 1, atomic writes with
// a kept backup on corruption. A corrupt file never erases the original:
// the store reports the corruption, the caller warns, and an empty rule
// set is used for this run.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { PermissionMode } from '../core/permissions.js'
import { writeJsonAtomic } from './atomic.js'
import { backupPath, permissionModePath, permissionsPath } from './paths.js'

export const PERMISSIONS_VERSION = 1

export type StoredRule = {
  id: string
  action: 'allow' | 'deny'
  tool: string
  path?: string
  note?: string
  [key: string]: unknown
}

export type PermissionsFile = {
  schemaVersion: number
  rules: StoredRule[]
  [key: string]: unknown
}

export type PermissionsLoad = {
  file: PermissionsFile
  /** The on-disk file was unreadable; a backup was kept. */
  corrupt: boolean
  corruptReason?: string
}

export function emptyPermissions(): PermissionsFile {
  return { schemaVersion: PERMISSIONS_VERSION, rules: [] }
}

function validateRule(rule: unknown): StoredRule {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    throw new Error('Permission rule must be an object')
  }
  const entry = rule as Record<string, unknown>
  if (typeof entry.id !== 'string' || !entry.id) throw new Error('Permission rule needs an id')
  if (entry.action !== 'allow' && entry.action !== 'deny') {
    throw new Error(`Permission rule ${entry.id}: action must be allow or deny`)
  }
  if (typeof entry.tool !== 'string' || !entry.tool) {
    throw new Error(`Permission rule ${entry.id}: tool is required ('*' for any)`)
  }
  if (entry.path !== undefined && typeof entry.path !== 'string') {
    throw new Error(`Permission rule ${entry.id}: path must be a string`)
  }
  // The bash-prefix field is reserved for SP004; accepting it now would
  // create rules nothing enforces (design §3.3.3).
  if ('contentPrefix' in entry) {
    throw new Error(`Permission rule ${entry.id}: contentPrefix is not supported yet`)
  }
  return entry as StoredRule
}

export class PermissionsStore {
  constructor(private readonly file: string = permissionsPath()) {}

  get path(): string {
    return this.file
  }

  load(): PermissionsLoad {
    if (!existsSync(this.file)) return { file: emptyPermissions(), corrupt: false }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      this.backup()
      return {
        file: emptyPermissions(),
        corrupt: true,
        corruptReason: 'permissions.json is corrupt; a backup was kept and no rules are active'
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.backup()
      return {
        file: emptyPermissions(),
        corrupt: true,
        corruptReason: 'permissions.json is not a JSON object; a backup was kept'
      }
    }
    const config = parsed as PermissionsFile
    const version = typeof config.schemaVersion === 'number' ? config.schemaVersion : 0
    if (version > PERMISSIONS_VERSION) {
      // Newer than we understand: read-only refusal, never rewrite.
      return {
        file: emptyPermissions(),
        corrupt: true,
        corruptReason: `permissions.json schema ${version} is newer than supported ${PERMISSIONS_VERSION}`
      }
    }
    if (!Array.isArray(config.rules)) {
      this.backup()
      return {
        file: emptyPermissions(),
        corrupt: true,
        corruptReason: 'permissions.json rules must be an array; a backup was kept and no rules are active'
      }
    }
    try {
      config.rules = config.rules.map(validateRule)
    } catch (error) {
      // One malformed rule makes the whole set untrustworthy for this run:
      // keep the file, take a backup, and continue with no rules.
      this.backup()
      return {
        file: emptyPermissions(),
        corrupt: true,
        corruptReason: `permissions.json has an invalid rule (${
          error instanceof Error ? error.message : String(error)
        }); a backup was kept and no rules are active`
      }
    }
    config.schemaVersion = PERMISSIONS_VERSION
    return { file: config, corrupt: false }
  }

  save(config: PermissionsFile): void {
    const rules = (config.rules ?? []).map(validateRule)
    writeJsonAtomic(this.file, { ...config, schemaVersion: PERMISSIONS_VERSION, rules })
  }

  private backup(): void {
    try {
      writeFileSync(backupPath(this.file), readFileSync(this.file))
    } catch {
      // A failing backup must not destroy the original file.
    }
  }
}

export function readPermissionMode(home?: string): PermissionMode {
  try {
    const { mode } = JSON.parse(readFileSync(permissionModePath(home), 'utf8'))
    if (mode === 'workspace_edit' || mode === 'full_access') return mode
  } catch {
    // Missing or damaged preference files use the conservative default.
  }
  return 'read_only'
}

export function savePermissionMode(mode: PermissionMode, home?: string): void {
  writeJsonAtomic(permissionModePath(home), { mode })
}
