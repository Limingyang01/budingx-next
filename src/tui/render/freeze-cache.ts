export interface FrozenEntry {
  id: string
  width: number
  lines: string[]
  hash: string
}

export interface FreezeCache {
  get(id: string, width: number): FrozenEntry | undefined
  set(entry: FrozenEntry): void
  invalidate(id: string): void
  clear(): void
  size(): number
}

export function createFreezeCache(limit = 500): FreezeCache {
  const max = Math.max(1, Math.floor(limit))
  const entries = new Map<string, FrozenEntry>()

  const keyOf = (id: string, width: number): string => id + '\u0000' + width

  return {
    get(id, width) {
      return entries.get(keyOf(id, width))
    },
    set(entry) {
      const key = keyOf(entry.id, entry.width)
      entries.delete(key)
      entries.set(key, entry)
      while (entries.size > max) {
        const oldest = entries.keys().next()
        if (oldest.done) break
        entries.delete(oldest.value)
      }
    },
    invalidate(id) {
      for (const key of [...entries.keys()]) {
        if (entries.get(key)?.id === id) entries.delete(key)
      }
    },
    clear() {
      entries.clear()
    },
    size() {
      return entries.size
    },
  }
}
