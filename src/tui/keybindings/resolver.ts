import { parseChord } from './parser.js'
import { NON_REBINDABLE, TERMINAL_RESERVED } from './defaults.js'
import { formatKeyStroke } from './parser.js'
import type { BindingContext, KeyBinding, KeyBindingResolver, KeyResolution, ParsedKey } from './types.js'

const RESERVED = new Set<string>([...NON_REBINDABLE])
const SOFT_RESERVED = new Set<string>([...TERMINAL_RESERVED])

export function createKeyBindingResolver(bindings: KeyBinding[]): KeyBindingResolver {
  const exact = new Map<string, Map<string, KeyResolution>>()
  const prefixes = new Map<string, Set<string>>()
  let pending: string | null = null

  for (const binding of bindings) {
    const chord = parseChord(binding.key)
    if (!chord) continue
    const canonical = [chord.prefix, chord.rest].filter(Boolean).join(' ')
    const resolution: KeyResolution = binding.action.startsWith('command:')
      ? { kind: 'action', action: 'command', command: binding.action.slice('command:'.length) }
      : { kind: 'action', action: binding.action }
    const contextBindings = exact.get(binding.context) ?? new Map<string, KeyResolution>()
    if (!contextBindings.has(canonical)) contextBindings.set(canonical, resolution)
    exact.set(binding.context, contextBindings)

    // 记录所有前缀（含中间前缀），用于 chord 状态机。
    const strokes = canonical.split(' ')
    for (let index = 1; index < strokes.length; index += 1) {
      const prefix = strokes.slice(0, index).join(' ')
      const set = prefixes.get(binding.context) ?? new Set<string>()
      set.add(prefix)
      prefixes.set(binding.context, set)
    }
  }

  return {
    get pending() {
      return pending
    },
    reset() {
      pending = null
    },
    resolve(context: BindingContext, key: ParsedKey): KeyResolution {
      const stroke = formatKeyStroke(key)
      if (RESERVED.has(stroke)) {
        pending = null
        return { kind: 'reserved', key: stroke, severity: 'error' }
      }
      if (SOFT_RESERVED.has(stroke)) {
        pending = null
        return { kind: 'reserved', key: stroke, severity: 'warning' }
      }
      const contextBindings = exact.get(context) ?? new Map<string, KeyResolution>()
      const contextPrefixes = prefixes.get(context) ?? new Set<string>()

      if (pending) {
        const candidate = pending + ' ' + stroke
        pending = null
        const hit = contextBindings.get(candidate)
        if (hit) return hit
        if (contextPrefixes.has(candidate)) {
          pending = candidate
          return { kind: 'pending', prefix: candidate }
        }
        return { kind: 'unbound' }
      }

      const direct = contextBindings.get(stroke)
      if (direct) return direct
      if (contextPrefixes.has(stroke)) {
        pending = stroke
        return { kind: 'pending', prefix: stroke }
      }
      return { kind: 'unbound' }
    },
  }
}
