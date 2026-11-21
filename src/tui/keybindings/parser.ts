import type { Chord, ParsedKey } from './types.js'

const MODIFIER_ALIASES: Record<string, 'ctrl' | 'alt' | 'shift' | 'meta'> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  opt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  super: 'meta',
  win: 'meta',
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'esc',
  escape: 'esc',
  return: 'enter',
  enter: 'enter',
  uparrow: 'up',
  downarrow: 'down',
  leftarrow: 'left',
  rightarrow: 'right',
  pageup: 'pageup',
  pagedown: 'pagedown',
  ' ': 'space',
  space: 'space',
  backspace: 'backspace',
  delete: 'delete',
  tab: 'tab',
}

const MODIFIER_ORDER: ('ctrl' | 'alt' | 'shift' | 'meta')[] = ['ctrl', 'alt', 'shift', 'meta']

/** 解析 `ctrl+shift+k` 形式的单键；非法返回 null。 */
export function parseKeyStroke(input: string): ParsedKey | null {
  if (typeof input !== 'string' || input.trim() === '') return null
  const parts = input
    .trim()
    .split('+')
    .map((part) => part.trim().toLowerCase())
  if (parts.some((part) => part === '')) return null
  const parsed: ParsedKey = { ctrl: false, alt: false, shift: false, meta: false, key: '' }
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part]
    if (modifier) {
      parsed[modifier] = true
      continue
    }
    if (parsed.key) return null
    parsed.key = KEY_ALIASES[part] ?? part
  }
  if (!parsed.key) return null
  return parsed
}

export function formatKeyStroke(key: ParsedKey): string {
  const parts: string[] = []
  for (const modifier of MODIFIER_ORDER) {
    if (key[modifier]) parts.push(modifier)
  }
  parts.push(key.key.toLowerCase())
  return parts.join('+')
}

/** 解析 `ctrl+x ctrl+e` 形式的 chord；任一键非法返回 null。 */
export function parseChord(input: string): Chord | null {
  if (typeof input !== 'string') return null
  const strokes: string[] = []
  for (const raw of input.trim().split(/\s+/)) {
    const parsed = parseKeyStroke(raw)
    if (!parsed) return null
    strokes.push(formatKeyStroke(parsed))
  }
  if (strokes.length === 0) return null
  return { prefix: strokes[0], rest: strokes.slice(1).join(' ') }
}

export function chordToString(chord: Chord): string {
  return [chord.prefix, chord.rest].filter(Boolean).join(' ')
}
