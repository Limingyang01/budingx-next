import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EditorBuffer } from '../dist/tui/editor/buffer.js'
import { applyKey } from '../dist/tui/editor/keys.js'

test('多行输入与光标行列移动', () => {
  const buffer = new EditorBuffer()
  applyKey(buffer, 'h', {}, { busy: false })
  applyKey(buffer, 'i', {}, { busy: false })
  assert.equal(buffer.text, 'hi')
  assert.deepEqual(buffer.cursor, { line: 0, col: 2 })
  buffer.moveLeft()
  assert.deepEqual(buffer.cursor, { line: 0, col: 1 })
  buffer.newline()
  assert.equal(buffer.text, 'h\ni')
  applyKey(buffer, 'x', {}, { busy: false })
  assert.equal(buffer.text, 'h\nxi')
  assert.equal(buffer.isMultiline, true)
  buffer.moveUp()
  assert.equal(buffer.cursor.line, 0)
  buffer.moveDown()
  assert.equal(buffer.cursor.line, 1)
})

test('光标移动按字符而非字节，中文与 emoji 不错位', () => {
  const buffer = new EditorBuffer()
  buffer.insert('你好👍')
  assert.equal(buffer.text, '你好👍')
  assert.equal(buffer.cursor.col, 3)
  buffer.backspace()
  assert.equal(buffer.text, '你好')
  buffer.moveLeft()
  assert.equal(buffer.cursor.col, 1)
  buffer.backspace()
  assert.equal(buffer.text, '好')
})

test('历史输入可用上下键召回', () => {
  const buffer = new EditorBuffer()
  buffer.commit('first command')
  buffer.commit('second command')
  assert.equal(buffer.recallPrevious(), true)
  assert.equal(buffer.text, 'second command')
  assert.equal(buffer.recallPrevious(), true)
  assert.equal(buffer.text, 'first command')
  assert.equal(buffer.recallNext(), true)
  assert.equal(buffer.text, 'second command')
  assert.equal(buffer.recallNext(), true)
  assert.equal(buffer.text, '')
})

test('多行粘贴插入为文本且不触发发送', () => {
  const buffer = new EditorBuffer()
  const action = applyKey(buffer, 'line one\nline two', {}, { busy: false })
  assert.equal(action.submit, undefined)
  assert.equal(buffer.text, 'line one\nline two')
})

test('undo 回到上一步', () => {
  const buffer = new EditorBuffer()
  buffer.insert('abc')
  assert.equal(buffer.text, 'abc')
  assert.equal(buffer.undo(), true)
  assert.equal(buffer.text, '')
  assert.equal(buffer.undo(), false)
})

test('Enter 提交，Shift+Enter 换行', () => {
  const buffer = new EditorBuffer()
  buffer.insert('hello')
  const submit = applyKey(buffer, '', { return: true }, { busy: false })
  assert.equal(submit.submit, true)
  const newline = applyKey(buffer, '', { return: true, shift: true }, { busy: false })
  assert.equal(newline.submit, undefined)
  assert.equal(buffer.text, 'hello\n')
})

test('执行中 Esc 打断，空闲 Esc 回收排队项', () => {
  const buffer = new EditorBuffer()
  const busy = applyKey(buffer, '', { escape: true }, { busy: true })
  assert.equal(busy.interrupt, true)
  assert.equal(busy.escape, undefined)
  const idle = applyKey(buffer, '', { escape: true }, { busy: false })
  assert.equal(idle.escape, true)
  assert.equal(idle.interrupt, undefined)
})

test('执行中 Ctrl+C 打断，空闲 Ctrl+C 请求退出', () => {
  const buffer = new EditorBuffer()
  const busy = applyKey(buffer, 'c', { ctrl: true }, { busy: true })
  assert.equal(busy.interrupt, true)
  assert.equal(busy.exit, undefined)
  const idle = applyKey(buffer, 'c', { ctrl: true }, { busy: false })
  assert.equal(idle.exit, true)
  assert.equal(idle.interrupt, undefined)
})

test('方向键在输入为空时移动光标，非空时优先编辑', () => {
  const buffer = new EditorBuffer()
  buffer.insert('abc')
  applyKey(buffer, '', { leftArrow: true }, { busy: false })
  assert.equal(buffer.cursor.col, 2)
  applyKey(buffer, '', { rightArrow: true }, { busy: false })
  assert.equal(buffer.cursor.col, 3)
  applyKey(buffer, '', { home: true }, { busy: false })
})

test('G08 多行有输入历史时上下键先移动行', () => {
  const b = new EditorBuffer()
  b.commit('older')
  b.setText('first\nsecond')
  applyKey(b, '', { upArrow: true }, { busy: false })
  assert.equal(b.cursor.line, 0)
  assert.equal(b.text, 'first\nsecond')
})


test('Home and End move within the current draft line', () => {
  const buffer = new EditorBuffer()
  buffer.insert('第一行\n第二行')
  applyKey(buffer, '', { home: true }, { busy: false })
  assert.equal(buffer.cursor.line, 1)
  assert.equal(buffer.cursor.col, 0)
  applyKey(buffer, '', { end: true }, { busy: false })
  assert.equal(buffer.cursor.col, 3)
})
