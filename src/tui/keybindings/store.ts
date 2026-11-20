import { readFileSync } from 'node:fs'
import { parseChord } from './parser.js'
import { BINDING_CONTEXT_SET, DEFAULT_BINDINGS, NON_REBINDABLE, TERMINAL_RESERVED } from './defaults.js'
import { keybindingsPath } from '../../storage/paths.js'
import type { BindingContext, KeyBinding, KeybindingFile, KeybindingWarning, LoadedKeybindings } from './types.js'

const RESERVED = new Set<string>([...NON_REBINDABLE, ...TERMINAL_RESERVED])

/**
 * 读取用户键位覆盖（`~/.budingx/keybindings.json`）。
 * 合并顺序：默认 → 用户（用户覆盖同名键）。损坏/非法项隔离并产出 warning。
 */
export function loadKeybindings(homeDir?: string): LoadedKeybindings {
  const warnings: KeybindingWarning[] = []
  let raw: string
  try {
    raw = readFileSync(keybindingsPath(homeDir), 'utf8')
  } catch {
    return { bindings: [...DEFAULT_BINDINGS], warnings }
  }

  let parsed: KeybindingFile
  try {
    parsed = JSON.parse(raw) as KeybindingFile
  } catch (error) {
    warnings.push({
      kind: 'parse_error',
      severity: 'error',
      message: 'keybindings.json 不是合法 JSON，已忽略用户覆盖：' + String((error as Error).message),
    })
    return { bindings: [...DEFAULT_BINDINGS], warnings }
  }

  const overrides: KeyBinding[] = []
  const seen = new Set<string>()
  const groups = Array.isArray(parsed?.bindings) ? parsed.bindings : []
  for (const group of groups) {
    const context = group?.context
    if (typeof context !== 'string' || !BINDING_CONTEXT_SET.has(context as BindingContext)) {
      warnings.push({ kind: 'invalid_context', severity: 'warning', message: '未知键位上下文：' + String(context) })
      continue
    }
    const table = group?.bindings
    if (!table || typeof table !== 'object') continue
    for (const [rawKey, rawAction] of Object.entries(table)) {
      if (typeof rawAction !== 'string' || rawAction.trim() === '') {
        warnings.push({ kind: 'invalid_action', severity: 'warning', message: '键 ' + rawKey + ' 的绑定目标非法' })
        continue
      }
      const chord = parseChord(rawKey)
      if (!chord) {
        warnings.push({ kind: 'parse_error', severity: 'warning', message: '无法解析键位：' + rawKey })
        continue
      }
      const canonical = [chord.prefix, chord.rest].filter(Boolean).join(' ')
      if (RESERVED.has(canonical)) {
        warnings.push({ kind: 'reserved', severity: 'error', message: '键 ' + canonical + ' 为保留键，不能重绑' })
        continue
      }
      const dedupe = context + '\u0000' + canonical
      if (seen.has(dedupe)) {
        warnings.push({ kind: 'duplicate', severity: 'warning', message: '重复绑定：' + context + ' ' + canonical })
        continue
      }
      seen.add(dedupe)
      overrides.push({ context: context as BindingContext, key: canonical, action: rawAction })
    }
  }

  const merged = [...DEFAULT_BINDINGS]
  for (const override of overrides) {
    const index = merged.findIndex((binding) => binding.context === override.context && binding.key === override.key)
    if (index >= 0) merged[index] = override
    else merged.push(override)
  }
  return { bindings: merged, warnings }
}
