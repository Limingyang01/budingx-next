import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
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
import { createHostProcessFixture } from '../../exec/test/helpers/host-process.mjs'
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

async function sp004Runtime(t, responses, setup = {}) {
  const base = mkdtempSync(join(tmpdir(), 'budingx-production-flow-'))
  const cwd = join(base, 'repo')
  mkdirSync(cwd)
  const requests = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push(JSON.parse(body))
    const next = responses[requests.length - 1]
    const response = typeof next === 'function' ? next(requests.at(-1)) : next
    const choice = Array.isArray(response)
      ? {
          delta: {
            tool_calls: response.map(([name, input], index) => ({
              index, id: `call-${requests.length}-${index}`, type: 'function',
              function: { name, arguments: JSON.stringify(input) }
            }))
          },
          finish_reason: 'tool_calls'
        }
      : { delta: { content: response ?? '结束' }, finish_reason: 'stop' }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ choices: [choice] })}\n\ndata: [DONE]\n\n`)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  const profile = createProfile({ label: 'SP004', baseUrl, model: 'sp004', tools: true })
  const configStore = new ConfigStore(join(base, 'config.json'))
  configStore.save({ version: 1, models: [profile], defaultModelId: profile.id })
  const approvals = []
  const runtime = createAgentRuntime({
    cwd, home: join(base, 'home'), configStore, mode: 'full_access',
    getConfig: () => ({
      profileId: profile.id, baseUrl, model: 'sp004', apiKey: 'fixture-key',
      timeoutMs: 2000, source: 'file'
    }),
    approval: { async request(request) {
      approvals.push(request)
      return setup.approve?.(request) ?? { outcome: 'allow', via: 'user' }
    } },
    sandboxBackend: setup.sandboxBackend
  })
  t.after(() => {
    runtime.session.dispose()
    server.closeAllConnections()
    server.close()
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const events = []
  runtime.session.on((event) => events.push(event))
  return { base, cwd, requests, approvals, runtime, events }
}

test('SP004 生产入口：模型写计划、显示审批、更新独立待办，工具结果以原 call ID 回填', async (t) => {
  const { runtime, requests, approvals, events } = await sp004Runtime(t, [
    [['EnterPlanMode', {}], ['WritePlan', {
      text: '# 修订计划\n1. 修改 src/app.ts', goal: '修订计划', steps: ['修改 src/app.ts']
    }]],
    [['ExitPlanMode', {}], ['TodoWrite', { todos: [
      { content: '补测试', status: 'in_progress', activeForm: '正在补测试' }
    ] }]],
    '计划已批准'
  ])
  assert.equal((await turn(runtime.session, '拟定计划')).outcome, 'completed')
  assert.equal(runtime.session.planMode.active, false,
    events.filter((event) => event.type === 'tool_result').map((event) => event.content).join('\n'))
  assert.equal(approvals.length, 1)
  assert.equal(approvals[0].name, 'ExitPlanMode')
  assert.ok(approvals[0].preview.some((line) => line.includes('修订计划')))
  const todos = events.find((event) => event.type === 'todos_updated')
  assert.equal(todos.items[0].activeForm, '正在补测试')
  const finalTools = requests[2].messages.filter((message) => message.role === 'tool')
  assert.deepEqual(finalTools.map((message) => message.tool_call_id),
    ['call-1-0', 'call-1-1', 'call-2-0', 'call-2-1'])
  assert.match(finalTools[1].content, /会话计划已更新/)
  assert.match(finalTools[2].content, /计划已批准/)
})

test('SP004 生产入口：专用 worktree 隔离文件，受控提交必须等新鲜用户批准', async (t) => {
  const { runtime, cwd, approvals, events } = await sp004Runtime(t, [
    [['EnterWorktree', { name: 'review' }]],
    [['Write', { path: 'added.txt', content: 'worktree only\n' }]],
    [['GitCommit', { message: 'fixture commit' }]],
    [['GitCommit', { message: 'fixture commit' }]],
    [['ExitWorktree', { action: 'keep' }]],
    '已完成'
  ], { approve: (request) => request.callId === 'call-3-0'
    ? { outcome: 'allow_session', via: 'user' }
    : { outcome: 'allow', via: 'user' } })
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'master')
  git('config', 'user.name', 'SP004 Fixture')
  git('config', 'user.email', 'sp004@example.test')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'core.autocrlf', 'false')
  git('commit', '--allow-empty', '-qm', 'base')
  const baseHead = git('rev-parse', 'HEAD')
  assert.equal((await turn(runtime.session, '在专用工作树增加文件并提交')).outcome, 'completed')
  assert.deepEqual(approvals.map((request) => request.name), ['EnterWorktree', 'GitCommit', 'GitCommit'])
  assert.ok(approvals[2].preview.some((line) => line.includes('added.txt')))
  const results = events.filter((event) => event.type === 'tool_result')
  assert.deepEqual(results.map((result) => result.isError), [false, false, true, false, false],
    results.map((result) => result.content).join('\n'))
  const commit = JSON.parse(results[3].content)
  assert.equal(git('show', `${commit.sha}:added.txt`), 'worktree only')
  assert.equal(git('rev-parse', 'HEAD'), baseHead)
  assert.equal(existsSync(join(cwd, 'added.txt')), false)
  assert.equal(runtime.workspace.root.toLowerCase(), cwd.toLowerCase())
})

test('SP004 生产入口：失败命令不算完成证据，测试成功后才能结束编码任务', async (t) => {
  const starts = []
  const backend = createHostProcessFixture({
    spawn(_executable, args, options) {
      starts.push(args.at(-1))
      return spawn(process.execPath, ['-e', starts.length === 1 ? 'process.exitCode = 3' : 'process.exitCode = 0'], options)
    }
  })
  const { runtime, requests, events } = await sp004Runtime(t, [
    [['StartCodingTask', { goal: '修复 fixture' }]],
    [['Bash', { command: 'node --test fixture.test.mjs' }]],
    '已经修复',
    [['Bash', { command: 'node --test fixture.test.mjs' }]],
    'fixture 通过'
  ], { sandboxBackend: backend })
  assert.equal((await turn(runtime.session, '修复 fixture')).outcome, 'completed')
  assert.equal(starts.length, 2)
  const outcomes = events.filter((event) => event.type === 'tool_result')
  assert.equal(outcomes[1].isError, true)
  assert.match(outcomes[1].content, /exit_code: 3/)
  assert.equal(outcomes[2].isError, false)
  assert.match(outcomes[2].content, /exit_code: 0/)
  assert.ok(requests[3].messages.some((message) => message.role === 'user' &&
    typeof message.content === 'string' && message.content.includes('真实执行证据')))
})

test('SP004 生产入口：后台任务可查询、取消并发出关联原调用的终态', { timeout: 12000 }, async (t) => {
  const backend = createHostProcessFixture({
    spawn(_executable, _args, options) {
      return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], options)
    }
  })
  let taskId
  const { runtime, events } = await sp004Runtime(t, [
    [['Bash', { command: 'node fixture.mjs', run_in_background: true }]],
    (request) => {
      const started = request.messages.find((message) => message.role === 'tool')
      taskId = /background_task_id: (\S+)/.exec(started?.content ?? '')?.[1]
      return [['TaskStatus', { task_id: taskId }], ['TaskCancel', { task_id: taskId }]]
    },
    '已取消'
  ], { sandboxBackend: backend })
  let off
  const finished = new Promise((resolve) => {
    off = runtime.session.on((event) => {
      if (event.type === 'command_finished') resolve(event)
    })
  })
  t.after(() => off())
  assert.equal((await turn(runtime.session, '运行、查看并取消 fixture')).outcome, 'completed')
  assert.ok(taskId)
  const results = events.filter((event) => event.type === 'tool_result')
  assert.deepEqual(results.map((result) => result.isError), [false, false, false])
  assert.match(results[1].content, /outcome: running/)
  assert.match(results[2].content, /已请求取消/)
  const terminal = await finished
  assert.equal(terminal.taskId, taskId)
  assert.equal(terminal.callId, 'call-1-0')
  assert.equal(terminal.outcome, 'cancelled')
})

test('SP004 生产入口：缺隔离后端时编码任务报告阻塞并结束回合', async (t) => {
  const { runtime, requests } = await sp004Runtime(t, [
    [['StartCodingTask', { goal: '修复 fixture' }]],
    [['Bash', { command: 'node --test fixture.test.mjs' }]],
    '测试无法运行'
  ])
  const result = await turn(runtime.session, '修复 fixture')
  assert.equal(result.outcome, 'error')
  assert.equal(result.error?.code, 'BUDINGX_EXEC_005')
  assert.equal(requests.length, 3)
})
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
  const listed = await runCommand('/permission', commandContext)
  assert.match(listed.message, /Allow edits[\s\S]*Full auto/)
  assert.doesNotMatch(listed.message, /read_only|read-only/i)
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
