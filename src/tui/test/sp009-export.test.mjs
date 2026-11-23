// SP009：/export 可以选择导出哪个会话。
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { exportSelectedSession } from '../dist/tui/commands/builtin-extended.js'
import { mountTty } from './helpers/mount-tty.mjs'

const idle = { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } }

const history = [
  { id: 'm1', role: 'user', blocks: [{ type: 'text', text: '当前会话的问题' }] },
  { id: 'm2', role: 'assistant', blocks: [{ type: 'text', text: '当前会话的回答' }] }
]
const saved = [
  { role: 'user', blocks: [{ type: 'text', text: '旧会话的问题' }] },
  { role: 'assistant', blocks: [{ type: 'text', text: '旧会话的回答' }] }
]

function context(home, readImpl) {
  return {
    session: { id: 'current', history },
    sessions: readImpl,
    home
  }
}

test('导出指定会话时读取该会话的历史而不是当前会话', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'budingx-export-'))
  try {
    const result = exportSelectedSession(context(home, {
      read: (id) => ({ ok: true, messages: id === 'saved' ? saved : [] })
    }), { sessionId: 'saved', format: 'text' })
    assert.equal(result.ok, true)
    assert.match(result.message, /已导出/)
    const file = /已导出 \d+ 字节：(.+)$/.exec(result.message)[1]
    const text = readFileSync(file, 'utf8')
    assert.match(text, /旧会话的问题/)
    assert.match(text, /旧会话的回答/)
    assert.doesNotMatch(text, /当前会话的问题/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('导出当前会话仍然可用', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'budingx-export-'))
  try {
    const result = exportSelectedSession(context(home, {
      read: () => ({ ok: false, message: '不该被调用' })
    }), { sessionId: 'current', format: 'text' })
    assert.equal(result.ok, true)
    const file = /已导出 \d+ 字节：(.+)$/.exec(result.message)[1]
    assert.match(readFileSync(file, 'utf8'), /当前会话的问题/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('读取失败的会话给出明确错误而不是写出空文件', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'budingx-export-'))
  try {
    const result = exportSelectedSession(context(home, {
      read: () => ({ ok: false, message: '会话不存在' })
    }), { sessionId: 'missing', format: 'jsonl' })
    assert.equal(result.ok, false)
    assert.match(result.message, /会话不存在/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('TUI 的 /export 打开会话选择面板并导出所选会话', async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'budingx-export-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const ui = await mountTty(t, {
    fullScreen: true,
    columns: 100,
    rows: 30,
    provider: idle,
    config: { model: 'fixture' },
    commandOverrides: {
      home,
      sessions: {
        list: () => [{ sessionId: 'saved', title: '旧会话', updatedAt: '2026-11-20', turns: 2 }],
        resume: () => ({ ok: false }),
        read: (id) => ({ ok: true, messages: id === 'saved' ? saved : [] })
      }
    }
  })
  await ui.send('/export\r')
  await ui.waitFor((frame) => frame.includes('导出会话') && frame.includes('旧会话'), 5000)
  // 第一项是当前会话，向下选择已保存会话。
  await ui.send('\x1b[B')
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('已导出'), 5000)
  const exportsDir = path.join(home, '.budingx', 'exports')
  assert.ok(existsSync(exportsDir), '导出目录应该被创建')
})
