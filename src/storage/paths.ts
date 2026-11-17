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

export function backupPath(file: string): string {
  return `${file}.bak`
}

export function temporaryPath(file: string): string {
  return `${file}.tmp`
}
