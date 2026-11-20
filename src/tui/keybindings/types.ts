/** 上下文块（首批 8 个，见设计 §5.1）。 */
export type BindingContext =
  | 'global'
  | 'chat'
  | 'input'
  | 'confirmation'
  | 'transcript'
  | 'help'
  | 'select'
  | 'footer'

export const BINDING_CONTEXTS: BindingContext[] = [
  'global',
  'chat',
  'input',
  'confirmation',
  'transcript',
  'help',
  'select',
  'footer',
]

export interface ParsedKey {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string
}

export interface Chord {
  prefix: string
  rest: string
}

export interface KeyBinding {
  context: BindingContext
  key: string
  action: string
}

export type KeyResolution =
  | { kind: 'action'; action: string; command?: string }
  | { kind: 'pending'; prefix: string }
  | { kind: 'unbound' }
  | { kind: 'reserved'; key: string; severity: 'error' | 'warning' }

export interface KeybindingWarning {
  kind: 'parse_error' | 'duplicate' | 'reserved' | 'invalid_context' | 'invalid_action'
  severity: 'error' | 'warning'
  message: string
}

export interface KeybindingFile {
  bindings?: { context?: string; bindings?: Record<string, unknown> }[]
}

export interface LoadedKeybindings {
  bindings: KeyBinding[]
  warnings: KeybindingWarning[]
}

export interface KeyBindingResolver {
  readonly pending: string | null
  resolve(context: BindingContext, key: ParsedKey): KeyResolution
  reset(): void
}
