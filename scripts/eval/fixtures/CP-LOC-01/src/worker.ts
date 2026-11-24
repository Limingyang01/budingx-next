import { parseConfig } from './config.ts'

export function workerConcurrency(env: string): number {
  const config = parseConfig(env)
  return Number(config.CONCURRENCY ?? 4)
}
