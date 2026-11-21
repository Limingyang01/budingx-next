import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  NON_REBINDABLE,
  createKeyBindingResolver,
  formatKeyStroke,
  loadKeybindings,
  parseChord,
  parseKeyStroke,
} from '../dist/tui/keybindings/index.js'
import { chordToString } from '../dist/tui/keybindings/parser.js'

const home = () => mkdtempSync(join(tmpdir(), 'budingx-kb-'))

test('TU-05 键位语法解析与规范化', () => {
  assert.deepEqual(parseKeyStroke('ctrl+shift+k'), { ctrl: true, alt: false, shift: true, meta: false, key: 'k' })
  assert.deepEqual(parseKeyStroke('Ctrl+K'), { ctrl: true, alt: false, shift: false, meta: false, key: 'k' })
  assert.deepEqual(parseKeyStroke('cmd+enter'), { ctrl: false, alt: false, shift: false, meta: true, key: 'enter' })
  assert.equal(parseKeyStroke('ctrl+'), null)
  assert.equal(parseKeyStroke('hyper+x'), null)
  assert.equal(formatKeyStroke(parseKeyStroke('alt+enter')), 'alt+enter')
  assert.equal(formatKeyStroke(parseKeyStroke('shift+ctrl+tab')), 'ctrl+shift+tab')
})

test('TU-06 chord 解析与前缀状态机', () => {
  const chord = parseChord('ctrl+x ctrl+e')
  assert.deepEqual(chord, { prefix: 'ctrl+x', rest: 'ctrl+e' })
  assert.equal(chordToString(chord), 'ctrl+x ctrl+e')

  const resolver = createKeyBindingResolver([
    { context: 'chat', key: 'ctrl+x ctrl+e', action: 'editor.external' },
    { context: 'chat', key: 'ctrl+o', action: 'transcript.toggle' },
  ])
  assert.deepEqual(resolver.resolve('chat', parseKeyStroke('ctrl+o')), { kind: 'action', action: 'transcript.toggle' })

  const pending = resolver.resolve('chat', parseKeyStroke('ctrl+x'))
  assert.deepEqual(pending, { kind: 'pending', prefix: 'ctrl+x' })
  assert.deepEqual(resolver.resolve('chat', parseKeyStroke('ctrl+e')), { kind: 'action', action: 'editor.external' })
  assert.equal(resolver.pending, null)
})

test('TU-06 chord 不匹配键丢弃并回落', () => {
  const resolver = createKeyBindingResolver([{ context: 'chat', key: 'ctrl+x ctrl+e', action: 'editor.external' }])
  resolver.resolve('chat', parseKeyStroke('ctrl+x'))
  assert.deepEqual(resolver.resolve('chat', parseKeyStroke('ctrl+k')), { kind: 'unbound' })
  assert.equal(resolver.pending, null)
})

test('TU-07 保留键不可重绑并返回 reserved', () => {
  assert.deepEqual([...NON_REBINDABLE], ['ctrl+c', 'ctrl+d', 'ctrl+m'])
  const resolver = createKeyBindingResolver([{ context: 'chat', key: 'ctrl+c', action: 'something' }])
  const result = resolver.resolve('chat', parseKeyStroke('ctrl+c'))
  assert.equal(result.kind, 'reserved')
  assert.equal(result.severity, 'error')
  assert.equal(resolver.resolve('chat', parseKeyStroke('ctrl+z')).kind, 'reserved')
})

test('TU-08 用户覆盖文件生效且 command: 引用可解析', () => {
  const dir = home()
  mkdirSync(join(dir, '.budingx'), { recursive: true })
  writeFileSync(
    join(dir, '.budingx', 'keybindings.json'),
    JSON.stringify({ bindings: [{ context: 'chat', bindings: { 'ctrl+t': 'command:/tasks' } }] }),
  )
  const loaded = loadKeybindings(dir)
  assert.deepEqual(loaded.warnings, [])
  const resolver = createKeyBindingResolver(loaded.bindings)
  assert.deepEqual(resolver.resolve('chat', parseKeyStroke('ctrl+t')), { kind: 'action', action: 'command', command: '/tasks' })
})

test('TU-07 用户覆盖文件损坏时隔离并保留默认绑定', () => {
  const dir = home()
  mkdirSync(join(dir, '.budingx'), { recursive: true })
  writeFileSync(join(dir, '.budingx', 'keybindings.json'), '{ not json')
  const loaded = loadKeybindings(dir)
  assert.equal(loaded.warnings[0].kind, 'parse_error')
  assert.ok(loaded.bindings.some((binding) => binding.context === 'chat' && binding.key === 'ctrl+o'))
  const resolver = createKeyBindingResolver(loaded.bindings)
  assert.equal(resolver.resolve('chat', parseKeyStroke('ctrl+o')).kind, 'action')
})

test('TU-07 重绑保留键/非法上下文产出警告并跳过', () => {
  const dir = home()
  mkdirSync(join(dir, '.budingx'), { recursive: true })
  writeFileSync(
    join(dir, '.budingx', 'keybindings.json'),
    JSON.stringify({
      bindings: [
        { context: 'chat', bindings: { 'ctrl+c': 'nope' } },
        { context: 'nonesuch', bindings: { 'ctrl+q': 'nope' } },
      ],
    }),
  )
  const loaded = loadKeybindings(dir)
  const kinds = loaded.warnings.map((warning) => warning.kind).sort()
  assert.deepEqual(kinds, ['invalid_context', 'reserved'])
  assert.equal(loaded.bindings.some((binding) => binding.action === 'nope'), false)
})

test('TU-08 重复绑定保留先注册者并告警', () => {
  const dir = home()
  mkdirSync(join(dir, '.budingx'), { recursive: true })
  writeFileSync(
    join(dir, '.budingx', 'keybindings.json'),
    JSON.stringify({
      bindings: [
        { context: 'chat', bindings: { 'ctrl+o': 'first.action' } },
        { context: 'chat', bindings: { 'ctrl+o': 'second.action' } },
      ],
    }),
  )
  const loaded = loadKeybindings(dir)
  assert.equal(loaded.warnings.some((warning) => warning.kind === 'duplicate'), true)
  const resolver = createKeyBindingResolver(loaded.bindings)
  assert.deepEqual(resolver.resolve('chat', parseKeyStroke('ctrl+o')), { kind: 'action', action: 'first.action' })
})
