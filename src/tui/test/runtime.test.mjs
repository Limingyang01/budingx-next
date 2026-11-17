import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { ConfigStore } from '../dist/storage/config-store.js'
import { CredentialStore } from '../dist/storage/credentials.js'
import { createProfile, profileHost } from '../dist/storage/profiles.js'
import { createConfiguredSession, saveProfileKey } from '../dist/tui/runtime.js'
import { runCommand } from '../dist/tui/commands.js'
function stores() {
  const root = mkdtempSync(join(tmpdir(), 'budingx-runtime-'))
  return {
    configStore: new ConfigStore(join(root, 'config.json')),
    credentialStore: new CredentialStore(join(root, 'credentials.json'))
  }
}
function turn(session, text) {
  return new Promise((resolve) => {
    const off = session.on((e) => {
      if (e.type === 'turn_finalized') {
        off()
        resolve(e)
      }
    })
    session.submit(text)
  })
}
test('G04/G05 两端点切换模型和凭据，当前回合快照不变', async (t) => {
  const requests = []
  let release
  const gate = new Promise((r) => (release = r))
  async function server(label) {
    const s = createServer(async (req, res) => {
      let b = ''
      for await (const c of req) b += c
      requests.push({ label, key: req.headers.authorization, body: JSON.parse(b) })
      if (label === 'one') await gate
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')
    })
    s.listen(0, '127.0.0.1')
    await once(s, 'listening')
    t.after(() => {
      s.closeAllConnections()
      s.close()
    })
    return 'http://127.0.0.1:' + s.address().port + '/v1'
  }
  const one = await server('one'),
    two = await server('two'),
    st = stores()
  const p1 = createProfile({ label: 'one', baseUrl: one, model: 'first', tools: true }),
    p2 = createProfile({ label: 'two', baseUrl: two, model: 'second', tools: false })
  st.configStore.save({ version: 1, models: [p1, p2], defaultModelId: p1.id })
  st.credentialStore.set(p2.id, profileHost(p2), 'fixture-two')
  let config = {
    profileId: p1.id,
    baseUrl: one,
    model: 'first',
    apiKey: 'fixture-one',
    timeoutMs: 1000,
    source: 'file'
  }
  const session = createConfiguredSession(
    () => config,
    { request: async () => ({ outcome: 'deny', via: 'policy' }) },
    st.configStore
  )
  t.after(() => session.dispose())
  const snapshots = []
  session.on((e) => {
    if (e.type === 'turn_started') snapshots.push(e.snapshot)
  })
  const first = turn(session, 'first')
  await new Promise((r) => setTimeout(r, 25))
  await runCommand('/model two', {
    ...st,
    session,
    getConfig: () => config,
    setConfig: (n) => (config = n),
    exit() {}
  })
  release()
  assert.equal((await first).outcome, 'completed')
  assert.equal((await turn(session, 'second')).outcome, 'completed')
  assert.deepEqual(
    requests.map((r) => [r.label, r.key, r.body.model]),
    [
      ['one', 'Bearer fixture-one', 'first'],
      ['two', 'Bearer fixture-two', 'second']
    ]
  )
  assert.deepEqual(
    snapshots.map((s) => s.capabilities.tools),
    [true, false]
  )
})
test('G01 录入凭据按主机绑定，活动档案刷新，非法输入不保存', () => {
  const st = stores(),
    p = createProfile({ label: 'one', baseUrl: 'https://one.invalid/v1', model: 'm' })
  st.configStore.save({ version: 1, models: [p] })
  let config = {
    profileId: p.id,
    baseUrl: p.baseUrl,
    model: 'm',
    apiKey: '',
    timeoutMs: 50,
    source: 'file'
  }
  saveProfileKey(
    { id: p.id, host: profileHost(p) },
    'fixture-key',
    st,
    () => config,
    (n) => (config = n)
  )
  assert.equal(config.apiKey, 'fixture-key')
  assert.equal(st.credentialStore.get(p.id, 'one.invalid'), 'fixture-key')
  assert.throws(() =>
    saveProfileKey(
      { id: p.id, host: 'other.invalid' },
      'another-key',
      st,
      () => config,
      (n) => (config = n)
    )
  )
  assert.throws(() =>
    saveProfileKey(
      { id: p.id, host: profileHost(p) },
      'bad\nkey',
      st,
      () => config,
      (n) => (config = n)
    )
  )
})
test('G15 配置超时作用于慢连接', async (t) => {
  const s = createServer(() => {})
  s.listen(0, '127.0.0.1')
  await once(s, 'listening')
  t.after(() => {
    s.closeAllConnections()
    s.close()
  })
  const session = createConfiguredSession(
    () => ({
      baseUrl: 'http://127.0.0.1:' + s.address().port,
      model: 'm',
      apiKey: '',
      timeoutMs: 5,
      source: 'env'
    }),
    { request: async () => ({ outcome: 'deny', via: 'policy' }) },
    stores().configStore
  )
  const start = Date.now()
  const result = await turn(session, 'hi')
  session.dispose()
  assert.equal(result.error.class, 'timeout')
  assert.ok(Date.now() - start < 12000)
})
