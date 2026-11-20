// User data root (SP002 design §3.5). Only ~/.budingx is ever touched;
// ~/.claude is never read or written.
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DATA_DIRECTORY = '.budingx'

export function dataRoot(home: string = homedir()): string {
  return join(home, DATA_DIRECTORY)
}

export function configPath(home?: string): string {
  return join(dataRoot(home), 'config.json')
}

export function credentialsPath(home?: string): string {
  return join(dataRoot(home), 'credentials.json')
}

/** Permission rules file (SP003 design §3.3.3). */
export function permissionsPath(home?: string): string {
  return join(dataRoot(home), 'permissions.json')
}

export function permissionModePath(home?: string): string {
  return join(dataRoot(home), 'permission-mode.json')
}

/** Keybinding overrides (SP006 design §4.5). */
export function keybindingsPath(home?: string): string {
  return join(dataRoot(home), 'keybindings.json')
}

/** Hook configuration (SP006 design §4.5). */
export function hooksPath(home?: string): string {
  return join(dataRoot(home), 'hooks.json')
}

/** MCP server configuration (SP006 design §4.5). */
export function mcpPath(home?: string): string {
  return join(dataRoot(home), 'mcp.json')
}

export function backupPath(file: string): string {
  return `${file}.bak`
}

export function temporaryPath(file: string): string {
  return `${file}.tmp`
}
