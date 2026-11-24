import { parseConfig } from './config.ts'

export function startServer(env: string): number {
  const config = parseConfig(env)
  return Number(config.PORT ?? 8080)
}
