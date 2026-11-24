export type RawConfig = { defaults?: Record<string, string> }

export function parseConfig(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index < 0) continue
    out[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
  }
  return out
}
