// Key mapping (SP002 design §3.6, AC TC-04).
// The TUI owns the meaning of a key; the session owns the behaviour.
import type { EditorBuffer } from './buffer.js'

export type KeyFlags = {
  upArrow?: boolean
  downArrow?: boolean
  leftArrow?: boolean
  rightArrow?: boolean
  pageDown?: boolean
  pageUp?: boolean
  return?: boolean
  escape?: boolean
  ctrl?: boolean
  shift?: boolean
  tab?: boolean
  backspace?: boolean
  delete?: boolean
  meta?: boolean
}

export type KeyContext = {
  /** A turn is running: Esc interrupts instead of recycling queued input. */
  busy: boolean
}

export type KeyAction = {
  handled: boolean
  submit?: boolean
  escape?: boolean
  interrupt?: boolean
  exit?: boolean
}

const nothing: KeyAction = { handled: false }

export function applyKey(
  buffer: EditorBuffer,
  input: string,
  key: KeyFlags,
  context: KeyContext
): KeyAction {
  if (key.ctrl && input === 'c') {
    return context.busy
      ? { handled: true, interrupt: true }
      : { handled: true, exit: true }
  }
  if (key.escape) {
    return context.busy
      ? { handled: true, interrupt: true }
      : { handled: true, escape: true }
  }
  if (key.return) {
    // Shift+Enter inserts a line break instead of submitting.
    if (key.shift) {
      buffer.newline()
      return { handled: true }
    }
    return { handled: true, submit: true }
  }
  if (key.backspace) {
    buffer.backspace()
    return { handled: true }
  }
  if (key.delete) {
    buffer.deleteForward()
    return { handled: true }
  }
  if (key.upArrow) {
    if (buffer.cursor.line > 0) {
      buffer.moveUp()
      return { handled: true }
    }
    if (buffer.isMultiline) return { handled: true }
    if (buffer.recallPrevious()) return { handled: true }
    buffer.moveUp()
    return { handled: true }
  }
  if (key.downArrow) {
    if (buffer.cursor.line < buffer.lines.length - 1) {
      buffer.moveDown()
      return { handled: true }
    }
    if (buffer.isMultiline) return { handled: true }
    if (buffer.recallNext()) return { handled: true }
    buffer.moveDown()
    return { handled: true }
  }
  if (key.leftArrow) {
    buffer.moveLeft()
    return { handled: true }
  }
  if (key.rightArrow) {
    buffer.moveRight()
    return { handled: true }
  }
  if (key.pageUp) {
    buffer.moveHome()
    return { handled: true }
  }
  if (key.pageDown) {
    buffer.moveEnd()
    return { handled: true }
  }
  if (key.ctrl && input === 'j') {
    buffer.newline()
    return { handled: true }
  }
  if (input && !key.ctrl && !key.meta) {
    buffer.insert(input)
    return { handled: true }
  }
  return nothing
}
