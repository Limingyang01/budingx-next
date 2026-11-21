import type { BindingContext, KeyBinding } from './types.js'

/** 硬编码保留键：不可由用户重绑。 */
export const NON_REBINDABLE = ['ctrl+c', 'ctrl+d', 'ctrl+m'] as const
/** 终端/信号语义占用的键：绑定会告警。 */
export const TERMINAL_RESERVED = ['ctrl+z', 'ctrl+\\'] as const

export const DEFAULT_BINDINGS: KeyBinding[] = [
  { context: 'global', key: 'ctrl+c', action: 'app.interrupt' },
  { context: 'chat', key: 'ctrl+o', action: 'transcript.toggle' },
  { context: 'chat', key: 'ctrl+r', action: 'history.search' },
  { context: 'chat', key: 'shift+tab', action: 'permission.cycle' },
  { context: 'chat', key: 'ctrl+t', action: 'command:/tasks' },
  { context: 'input', key: 'ctrl+a', action: 'cursor.home' },
  { context: 'input', key: 'ctrl+e', action: 'cursor.end' },
  { context: 'input', key: 'ctrl+g', action: 'editor.external' },
  { context: 'confirmation', key: 'y', action: 'confirm.once' },
  { context: 'confirmation', key: 'n', action: 'confirm.reject' },
  { context: 'confirmation', key: 'a', action: 'confirm.session' },
  { context: 'transcript', key: 'ctrl+o', action: 'transcript.toggle' },
  { context: 'transcript', key: 'esc', action: 'transcript.close' },
  { context: 'help', key: 'esc', action: 'help.close' },
  { context: 'select', key: 'up', action: 'select.previous' },
  { context: 'select', key: 'down', action: 'select.next' },
  { context: 'select', key: 'enter', action: 'select.confirm' },
  { context: 'select', key: 'esc', action: 'select.cancel' },
  { context: 'footer', key: 'tab', action: 'focus.cycle' },
]

export const BINDING_CONTEXT_SET: Set<BindingContext> = new Set([
  'global',
  'chat',
  'input',
  'confirmation',
  'transcript',
  'help',
  'select',
  'footer',
])
