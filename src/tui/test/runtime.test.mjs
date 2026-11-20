import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { permissionModePath } from '../dist/storage/paths.js'
import { ConfigStore } from '../dist/storage/config-store.js'
import { CredentialStore } from '../dist/storage/credentials.js'
import { createProfile, profileHost } from '../dist/storage/profiles.js'
import { saveModel } from '../dist/tui/model-management.js'
import { createAgentRuntime, createConfiguredSession } from '../dist/tui/runtime.js'
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
  const ctx = { ...st, getConfig: () => config, setConfig: (next) => { config = next } }
  const draft = { id: p.id, label: p.label, baseUrl: p.baseUrl, model: p.model,
    tools: true, startupDefault: false, apiKey: 'fixture-key' }
  const saved = saveModel(ctx, draft, false)
  assert.equal(config.apiKey, 'fixture-key')
  assert.equal(st.credentialStore.get(p.id, profileHost(p)), 'fixture-key')
  assert.equal(st.credentialStore.get(p.id, 'other.invalid'), undefined)
  assert.throws(() => saveModel(ctx, { ...draft, apiKey: 'bad\nkey' }, false), /invalid/i)
  assert.throws(() => saveModel(ctx, { ...draft, updatedAt: saved.updatedAt + '-stale' }, false), /changed/)
  assert.equal(st.credentialStore.get(p.id, profileHost(p)), 'fixture-key')

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

test('默认运行时提供 Shell 工具并按权限档位执行（0.5.4 宿主信任，对齐参考实现）', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-shell-gate-'))
  const cwd = join(home, 'workspace')
  mkdirSync(cwd)
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const requests = []
  let pendingCommand = 'node --version'
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const request = JSON.parse(body)
    requests.push(request)
    const choice = request.messages.at(-1).role === 'tool'
      ? { delta: { content: '已收到结果' }, finish_reason: 'stop' }
      : {
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call-bash',
              type: 'function',
              function: { name: 'Bash', arguments: JSON.stringify({ command: pendingCommand }) }
            }]
          },
          finish_reason: 'tool_calls'
        }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ choices: [choice] })}\n\ndata: [DONE]\n\n`)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  const profile = createProfile({ label: 'shell', baseUrl, model: 'fixture', tools: true })
  const configStore = new ConfigStore(join(home, 'config.json'))
  configStore.save({ version: 1, models: [profile], defaultModelId: profile.id })
  const approvals = []
  const runtime = createAgentRuntime({
    cwd,
    home,
    configStore,
    mode: 'workspace_edit',
    getConfig: () => ({
      profileId: profile.id,
      baseUrl,
      model: 'fixture',
      apiKey: '',
      timeoutMs: 5000,
      source: 'file'
    }),
    approval: {
      request: async (request) => {
        approvals.push(request)
        return { outcome: 'allow', via: 'user' }
      }
    }
  })
  t.after(() => runtime.session.dispose())
  const events = []
  runtime.session.on((event) => events.push(event))

  // 只读命令（node --version 在白名单内）：任何档位都免审批直接执行，不再被隔离门禁拒绝。
  pendingCommand = 'node --version'
  for (const mode of ['workspace_edit', 'full_access']) {
    runtime.setPermissionMode(mode)
    events.length = 0
    approvals.length = 0
    assert.equal((await turn(runtime.session, '运行命令')).outcome, 'completed')
    assert.equal(approvals.length, 0, '只读命令免审批')
    assert.ok(events.some((event) => event.type === 'command_started'), '命令应真正启动')
    const results = events.filter((event) => event.type === 'tool_result')
    assert.equal(results.length, 1)
    assert.equal(results[0].isError, false)
    assert.doesNotMatch(results[0].content, /隔离|EXEC_005/)
  }

  // 非只读命令：工作区修改档位需审批，完全权限自动执行。
  pendingCommand = 'node -e "console.log(1)"'
  runtime.setPermissionMode('workspace_edit')
  events.length = 0
  approvals.length = 0
  assert.equal((await turn(runtime.session, '运行命令')).outcome, 'completed')
  assert.equal(approvals.length, 1, '工作区修改档位的执行命令需一次审批')
  assert.ok(events.some((event) => event.type === 'command_started'))

  runtime.setPermissionMode('full_access')
  events.length = 0
  approvals.length = 0
  assert.equal((await turn(runtime.session, '运行命令')).outcome, 'completed')
  assert.equal(approvals.length, 0, '完全权限自动执行')
  assert.ok(events.some((event) => event.type === 'command_started'))

  const offered = requests[0].tools.map((item) => item.function.name)
  assert.ok(['Bash', 'PowerShell', 'Read'].every((name) => offered.includes(name)))
})


test('PC-11 restores explicit interactive permission choices and preserves stored rules', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-mode-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const cwd = join(home, 'workspace')
  mkdirSync(cwd)
  const options = {
    home, cwd,
    getConfig: () => ({ baseUrl: 'http://localhost/v1', model: 'fixture', apiKey: '', timeoutMs: 1000 }),
    approval: { request: async () => ({ outcome: 'deny', via: 'policy' }) },
    configStore: new ConfigStore(join(home, 'config.json'))
  }
  const start = (overrides = {}) => {
    const runtime = createAgentRuntime({ ...options, persistPermissionMode: true, ...overrides })
    t.after(() => runtime.session.dispose())
    return runtime
  }
  const first = start()
  const rules = [{ id: 'deny-private', action: 'deny', tool: 'Write', path: 'private.txt' }]
  first.permissionStore.save({ schemaVersion: 1, rules, extra: 'preserved' })
  assert.equal(first.policy.getMode(), 'workspace_edit')
  assert.equal(first.policy.decide({ tool: 'Write', capability: 'write', path: 'normal.ts' }).action, 'allow')
  assert.equal(first.policy.decide({ tool: 'Write', capability: 'write', path: '.vscode/tasks.json' }).action, 'ask')
  for (const mode of ['workspace_edit', 'full_access']) {
    assert.equal(first.setPermissionMode(mode), true)
    const resumed = start()
    assert.equal(resumed.policy.getMode(), mode)
    assert.equal(resumed.policy.decide({ tool: 'Write', capability: 'write', path: 'private.txt' }).action, 'deny')
    assert.deepEqual(resumed.permissionStore.load().file, { schemaVersion: 1, rules, extra: 'preserved' })
  }
  const commandContext = {
    session: first.session,
    interactive: true,
    permission: {
      policy: first.policy,
      store: first.permissionStore,
      setMode: first.setPermissionMode,
      modes: { zh: {}, en: {}, order: ['read_only', 'workspace_edit', 'full_access'] }
    }
  }
  // 0.5.4：/permission 无参数交互统一打开规则面板（对齐参考仓单一 permissions）。
  const listed = await runCommand('/permission', commandContext)
  assert.equal(listed.openRules, true)
  assert.match((await runCommand('/permission read', commandContext)).error, /edit\|full/)
  assert.equal((await runCommand('/permission edit', commandContext)).error, undefined)
  assert.equal(first.policy.getMode(), 'workspace_edit')
  assert.equal((await runCommand('/permission full', commandContext)).error, undefined)
  assert.equal((await runCommand('/rules add deny Write other.txt', commandContext)).error, undefined)
  assert.equal(start().policy.getMode(), 'full_access')
  assert.match((await runCommand('/permission constructor', commandContext)).error, /Usage/)
  assert.equal(first.policy.getMode(), 'full_access')
  const pipe = start({ persistPermissionMode: false, mode: 'read_only' })
  assert.equal(pipe.policy.getMode(), 'read_only')
  pipe.setPermissionMode('workspace_edit')
  assert.equal(start().policy.getMode(), 'full_access')

  const file = first.permissionStore.path
  const preference = permissionModePath(home)
  writeFileSync(preference, JSON.stringify({ mode: 'read_only' }))
  assert.equal(start().policy.getMode(), 'workspace_edit')
  writeFileSync(preference, JSON.stringify({ mode: 'unknown' }))
  assert.equal(start().policy.getMode(), 'workspace_edit')
  writeFileSync(preference, JSON.stringify({ mode: 'full_access' }))
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, rules: null }))
  assert.equal(start().policy.getMode(), 'read_only')
  writeFileSync(file, '{malformed')
  const invalid = start()
  assert.equal(invalid.policy.getMode(), 'read_only')
  rmSync(preference)
  mkdirSync(preference)
  assert.equal(invalid.setPermissionMode('workspace_edit'), false)
  assert.equal(invalid.policy.getMode(), 'workspace_edit')
  assert.equal(readFileSync(file, 'utf8'), '{malformed')
})