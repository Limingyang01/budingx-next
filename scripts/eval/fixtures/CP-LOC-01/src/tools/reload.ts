import { parseConfig } from '../config.ts'

export function reloadConfig(env: string): Record<string, string> {
  return parseConfig(env)
}
