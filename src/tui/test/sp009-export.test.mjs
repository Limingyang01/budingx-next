// SP009：/export 可以选择导出哪个会话。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { exportSelectedSession } from '../dist/tui/commands/builtin-extended.js'
import { Session } from '../dist/core/session.js'
import { SessionStore, startSession } from '../dist/storage/session-store.js'
import { createWorkspace } from '../dist/workspace/paths.js'
import { createWorkspaceTools } from '../dist/workspace/tools.js'
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

test('AC-EXPORT-01/02 Markdown 经 Ink 和无头导出真实写入证据，保留围栏并脱敏', async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'budingx-md-export-'))
  const cwd = path.join(home, 'workspace')
  mkdirSync(cwd)
  execFileSync('git', ['init', '-q'], { cwd })
  writeFileSync(path.join(cwd, 'unrelated.txt'), 'unrelated user change')
  const sessionId = 'md-session'
  const store = new SessionStore({ home, workspaceRoot: cwd })
  const { transcript } = startSession({ home, workspaceRoot: cwd, sessionId, title: '项目中文标题' })
  let requests = 0
  const session = new Session({
    id: sessionId,
    transcript,
    tools: createWorkspaceTools(createWorkspace(cwd)).tools,
    approval: { request: async () => ({ outcome: 'allow', via: 'user' }) },
    resolveSnapshot: () => ({ modelId: 'fixture', model: 'fixture', baseUrlHost: 'fixture', capabilities: { tools: true } }),
    provider: {
      async *stream() {
        if (++requests === 1) {
          yield {
            type: 'tool_call_delta', index: 0, callId: 'write-1', nameDelta: 'Write',
            argsDelta: JSON.stringify({ path: 'created.ts', content: 'export const value = 42\n' })
          }
          yield { type: 'message_completed', finishReason: 'tool_calls' }
          return
        }
        yield { type: 'text_delta', text: '中文回答\n\n```ts\nconst ready = true\n```\nBearer fixturetoken1234' }
        yield { type: 'message_completed', finishReason: 'stop' }
      }
    }
  })
  const finalized = new Promise((resolve) => session.on((event) => {
    if (event.type === 'turn_finalized') resolve(event)
  }))
  session.submit('写入文件', { context: [{ source: 'skill:fixture', content: 'HIDDEN-SKILL-TEXT' }] })
  assert.equal((await finalized).outcome, 'completed')
  assert.equal(existsSync(path.join(cwd, 'created.ts')), true)

  const ui = await mountTty(t, {
    sessionFactory: () => session, config: { model: 'fixture' },
    commandOverrides: {
      home,
      sessions: {
        list: () => store.list(), resume: () => ({ ok: false }),
        read: (id) => {
          const saved = store.restore(id)
          return { ok: saved.status === 'restored', messages: saved.messages, changes: saved.changes, title: saved.summary?.title }
        }
      }
    }
  })
  t.after(() => rmSync(home, { recursive: true, force: true }))
  await ui.send('/export --format markdown --path tui.md\r')
  await ui.waitFor((frame) => frame.includes('MARKDOWN'))
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('已导出'))
  const env = { ...process.env, HOME: home, USERPROFILE: home, HOMEDRIVE: '', HOMEPATH: '' }
  const subprocess = execFileSync(process.execPath, [
    fileURLToPath(new URL('../dist/tui/cli.js', import.meta.url)),
    '--prompt', `/export --format markdown --session ${sessionId} --path headless.md`, '--output-format', 'json'
  ], { cwd, env, encoding: 'utf8' })
  assert.equal(JSON.parse(subprocess).is_error, false)
  const tui = readFileSync(path.join(home, '.budingx', 'tui.md'), 'utf8')
  const headless = readFileSync(path.join(home, '.budingx', 'headless.md'), 'utf8')
  assert.equal(tui, headless)
  assert.match(tui, /项目中文标题/)
  assert.match(tui, /```ts\nconst ready = true\n```/)
  assert.match(tui, /created\\\.ts/)
  assert.doesNotMatch(tui, /unrelated|HIDDEN-SKILL-TEXT|fixturetoken1234/)
})
