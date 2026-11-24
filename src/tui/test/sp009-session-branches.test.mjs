import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { SessionStore, startSession } from '../dist/storage/session-store.js'
import { createAgentRuntime } from '../dist/tui/runtime.js'
import { mountTty } from './helpers/mount-tty.mjs'

const exec = promisify(execFile)

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'budingx-branch-'))
  const workspace = join(home, 'workspace')
  mkdirSync(workspace)
  const store = new SessionStore({ home, workspaceRoot: workspace })
  const { transcript } = startSession({ sessionId: 'original', home, workspaceRoot: workspace })
  transcript.append({
    type: 'message', ts: new Date().toISOString(), id: 'original-text', role: 'user',
    blocks: [{ type: 'text', text: '初始会话正文' }]
  })
  transcript.append({ type: 'permission_mode', ts: new Date().toISOString(), mode: 'read_only' })
  return { home, workspace, store }
}

test('AC-FORK-01/AC-NAME-01 真实 Ink 命令改名、从当前和历史派生、重开后分别续写', async (t) => {
  const { home, workspace, store } = fixture()
  const received = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    received.push(JSON.parse(Buffer.concat(chunks).toString()).messages)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end('data: {"choices":[{"delta":{"content":"测试回答"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const config = {
    model: 'fixture',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    apiKey: 'fixture-key'
  }
  let runtime
  const ui = await mountTty(t, {
    strategy: 'ascii',
    config,
    commandOverrides: {
      get sessions() { return runtime.sessions }
    },
    sessionFactory(stores) {
      runtime = createAgentRuntime({
        cwd: workspace, home, persistence: true, sessionId: 'original',
        configStore: stores.configStore, getConfig: stores.getConfig, approval: stores.gateway
      })
      assert.equal(runtime.sessions.resume('original').ok, true)
      return runtime.session
    }
  })
  t.after(() => rmSync(home, { recursive: true, force: true }))
  await ui.send('/rename 项目记录\r')
  await ui.waitFor((frame) => /会话标题已保存|Session title saved/.test(frame))
  assert.equal(store.summary('original').title, '项目记录')

  await ui.send('/branch\r')
  await ui.waitFor((frame) => /已切换至会话分支|Switched to session branch/.test(frame))
  const active = runtime.session.id
  assert.notEqual(active, 'original')
  assert.equal(store.readMeta(active).forkedFrom.messageId, 'original-text')
  assert.equal(store.summary(active).permissionMode, 'read_only')
  await ui.send('只出现在分支一\r')
  await ui.waitFor((frame) => frame.includes('测试回答'))

  await ui.send('/fork original\r')
  await ui.waitFor(() => runtime.session.id !== active)
  const selected = runtime.session.id
  assert.notEqual(selected, 'original')
  assert.equal(store.readMeta(selected).forkedFrom.sessionId, 'original')

  const reopened = createAgentRuntime({
    cwd: workspace, home, persistence: true, sessionId: active, configStore: ui.configStore,
    getConfig: () => ui.config(), approval: ui.gateway, mode: 'read_only'
  })
  try {
    assert.equal(reopened.sessions.resume(active).ok, true)
    assert.match(JSON.stringify(reopened.session.history), /只出现在分支一/)
    assert.doesNotMatch(JSON.stringify(store.restore(selected).messages), /只出现在分支一/)
    assert.doesNotMatch(JSON.stringify(store.restore('original').messages), /只出现在分支一/)
    assert.match(JSON.stringify(received[0]), /初始会话正文/)
  } finally {
    reopened.session.dispose()
  }
  await ui.send('/resume\r')
  await ui.waitFor((frame) => /Search titles or messages|搜索标题或正文/.test(frame))
  await ui.send('无匹配词')
  await ui.waitFor((frame) => /No matching sessions|没有匹配的会话/.test(frame))
  for (const _ of '无匹配词') await ui.send('\x7f')
  await ui.send('只出现在分支一')
  await ui.waitFor((frame) => /message match|正文命中/.test(frame))
  await ui.send('\r')
  await ui.waitFor(() => runtime.session.id === active)
})

test('AC-FORK-02 两个真实进程从同一个会话派生独立分支', async (t) => {
  const { home, workspace, store } = fixture()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const moduleUrl = new URL('../dist/storage/session-store.js', import.meta.url).href
  const source = `
    import { SessionStore } from ${JSON.stringify(moduleUrl)}
    const [home, workspaceRoot] = process.argv.slice(1)
    const store = new SessionStore({ home, workspaceRoot })
    process.stdout.write(JSON.stringify(store.fork('original')))
  `
  const fork = () => exec(process.execPath, ['--input-type=module', '-e', source, home, workspace])
  const results = (await Promise.all([fork(), fork()])).map(({ stdout }) => JSON.parse(stdout))
  assert.equal(results.every((entry) => entry.ok), true)
  assert.notEqual(results[0].sessionId, results[1].sessionId)
  assert.equal(store.list().length, 3)
  for (const result of results) {
    assert.equal(store.restore(result.sessionId).messages[0].id, 'original-text')
    assert.equal(store.readMeta(result.sessionId).forkedFrom.sessionId, 'original')
  }
})
