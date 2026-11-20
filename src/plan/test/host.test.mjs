// SP004 T15 · 生产宿主计划集成（src/plan/host.ts）与计划模式工具表面（src/plan/tools.ts）。
// 覆盖：计划文件落盘、工作区/Git 快照指纹、漂移判定、执行前校验、工具调用成功与失败路径。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createPlanModeHost, planModeFilePath } from '../../tui/dist/plan/host.js'
import { createPlanModeTools } from '../../tui/dist/plan/tools.js'
import { Session } from '../../tui/dist/core/session.js'
import { createAgentRuntime } from '../../tui/dist/tui/runtime.js'
import { ConfigStore } from '../../tui/dist/storage/config-store.js'
import { createPermissionPolicy } from '../../tui/dist/workspace/policy.js'
import { createWorkspace } from '../../tui/dist/workspace/paths.js'

const BUGGY = 'export function add(a, b) {\n  return a * b\n}\n'
const FIXED = 'export function add(a, b) {\n  return a + b\n}\n'

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function makeRepo(t) {
  const base = mkdtempSync(join(tmpdir(), 'budingx-plan-host-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const repo = join(base, 'repo')
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'src', 'app.mjs'), BUGGY)
  writeFileSync(join(repo, 'notes.txt'), 'notes\n')
  git(repo, 'init', '-q')
  git(repo, 'config', 'user.name', 'T15 Fixture')
  git(repo, 'config', 'user.email', 't15@example.test')
  git(repo, 'config', 'commit.gpgsign', 'false')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'fixture: initial state')
  return { base, repo, home: join(base, 'home') }
}

function makeHost(f) {
  const workspace = createWorkspace(f.repo)
  const host = createPlanModeHost({ sessionId: 'sess-1', workspace, home: f.home })
  return { workspace, host }
}

test('T15-11 生产 PlanModeHost：计划文件落盘、目标文件前像指纹、外部改动即漂移', (t) => {
  const f = makeRepo(t)
  const { workspace, host } = makeHost(f)
  assert.equal(
    planModeFilePath('sess-1', f.home),
    join(f.home, '.budingx', 'plans', 'sess-1', 'plan-sess-1.md')
  )

  const created = host.store.create('修复 add 的失败测试', [{ title: '修改 src/app.mjs' }])
  const text = '# 计划\n1. 修改 src/app.mjs 并运行 node --test\n'
  const pending = host.store.requestApproval(text)
  const baseline = host.snapshot()
  assert.equal(baseline.root, workspace.root)
  assert.match(baseline.head ?? '', /^[0-9a-f]{40}$/, '快照必须绑定 Git HEAD')
  assert.ok(baseline.files['src/app.mjs'], '计划正文提到的文件必须有前像指纹')
  assert.equal(host.diff(baseline, host.snapshot()).length, 0)

  // 用户可编辑的计划正文落盘后可读回（宿主退出计划模式时据此展示）。
  return host.readPlanText().then((written) => {
    assert.ok(written && written.includes(created.id), '计划文件应包含计划 id')
    assert.ok(written.includes(pending.id), '计划文件应包含计划编号')

    const approved = host.store.approve(text)
    assert.equal(host.validate(approved).ok, true, '批准后未漂移的计划应通过执行前校验')

    // 外部进程改动目标文件：指纹漂移，执行前校验失败并列出 files:<path>。
    writeFileSync(join(f.repo, 'src', 'app.mjs'), FIXED)
    const drifted = host.validate(approved)
    assert.equal(drifted.ok, false)
    assert.deepEqual(drifted.drift.map((d) => d.item), ['files:src/app.mjs'])

    const diff = host.diff(baseline, host.snapshot())
    assert.deepEqual(diff.map((d) => d.item), ['files:src/app.mjs'])
    assert.match(diff[0].expected, /^[0-9a-f]{64}$/)
    assert.match(diff[0].actual, /^[0-9a-f]{64}$/)
    assert.equal(diff[0].expected === diff[0].actual, false)
  })
})

test('T15-11b 生产 PlanModeHost：未提交的 HEAD 变化也计入漂移', (t) => {
  const f = makeRepo(t)
  const { workspace, host } = makeHost(f)
  const baseline = host.snapshot()
  writeFileSync(join(f.repo, 'src', 'app.mjs'), FIXED)
  git(f.repo, 'add', '-A')
  git(f.repo, 'commit', '-q', '-m', 'external commit')
  const drift = host.diff(baseline, host.snapshot())
  assert.deepEqual(drift.map((d) => d.item), ['head'])
})

test('approved draft text drift blocks execution even when referenced files are unchanged', async (t) => {
  const f = makeRepo(t)
  const { workspace, host } = makeHost(f)
  const original = '# Repair add\nUse src/app.mjs'
  host.writeDraft(original)
  const session = new Session({
    provider: { stream: async function* () {} },
    approval: { async request() { return { outcome: 'allow', via: 'user' } } },
    resolveSnapshot: () => ({
      modelId: 'fixture', model: 'fixture', baseUrlHost: 'fixture.invalid', capabilities: { tools: true }
    }),
    tools: [],
    permissionPolicy: createPermissionPolicy({ workspace }),
    planMode: host
  })
  t.after(() => session.dispose())
  assert.equal(session.enterPlanMode().ok, true)
  assert.equal((await session.exitPlanMode()).ok, true)
  assert.equal(host.validate(host.store.current()).ok, true)
  writeFileSync(host.draftPath, original + '\nNew unapproved requirement.')
  assert.deepEqual(host.validate(host.store.current()).drift.map((item) => item.item), ['draft'])
})

test('T15-12 计划模式工具：EnterPlanMode 进入调研、ExitPlanMode 缺计划文件报错、批准后恢复原档位', async (t) => {
  const base = makeRepo(t)
  const workspace = createWorkspace(base.repo)
  const host = createPlanModeHost({ sessionId: 'sess-2', workspace, home: base.home })
  const policy = createPermissionPolicy({ workspace, mode: 'workspace_edit' })
  const requests = []
  const session = new Session({
    provider: { stream: async function* () {} },
    approval: {
      async request(request) {
        requests.push(request)
        return { outcome: 'allow', via: 'user' }
      }
    },
    resolveSnapshot: () => ({
      modelId: 'fixture',
      model: 'fixture',
      baseUrlHost: 'fixture.invalid',
      capabilities: { tools: true }
    }),
    tools: [],
    permissionPolicy: policy,
    planMode: host
  })
  t.after(() => session.dispose())
  session.tools.push(...createPlanModeTools(session))

  const enter = session.tools.find((tool) => tool.name === 'EnterPlanMode')
  const exit = session.tools.find((tool) => tool.name === 'ExitPlanMode')
  const context = { signal: new AbortController().signal }

  const entered = await enter.execute({}, context)
  assert.match(entered, /已进入计划模式/)
  assert.equal(session.planMode.active, true)
  assert.equal(session.planMode.phase, 'research')

  // 无计划文件时退出：工具错误，停留在调研阶段。
  await assert.rejects(() => exit.execute({}, context), /计划文件缺失或为空/)
  assert.equal(session.planMode.phase, 'research')

  // 写入计划并再次退出：审批通过后恢复原档位。
  host.store.create('修复 add 的失败测试', [{ title: '修改 src/app.mjs' }])
  host.store.requestApproval('# 计划\n1. 修改 src/app.mjs\n')
  const exited = await exit.execute({}, context)
  assert.match(exited, /计划已批准（plan-sess-2）/)
  assert.equal(session.planMode.active, false)
  assert.equal(policy.getMode(), 'workspace_edit')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].name, 'ExitPlanMode')
  assert.equal(requests[0].planId, 'plan-sess-2')

  // 非法 allowedPrompts 在校验层被拒绝，不触发审批。
  await assert.rejects(
    () => exit.execute({ allowedPrompts: 'nope' }, context),
    /allowedPrompts/
  )
  assert.equal(requests.length, 1)
})

test('production plan tools send the complete edited plan under the original call id', async (t) => {
  const f = makeRepo(t)
  const draft = join(f.home, '.budingx', 'plans', 'wire-plan', 'plan-wire-plan.draft.md')
  const other = join(f.home, '.budingx', 'plans', 'other-session', 'private.md')
  mkdirSync(join(other, '..'), { recursive: true })
  writeFileSync(other, 'private neighbor')
  const plan = ['# Repair add', ...Array.from({ length: 45 }, (_, i) => `Line ${i + 1}`)].join('\n')
  const edited = plan + '\nOnly the user may add this requirement.'
  const script = [
    ['enter-bad', 'EnterPlanMode', { unexpected: true }],
    ['enter', 'EnterPlanMode', {}],
    ['write-other', 'Write', { path: other, content: 'blocked' }],
    ['write-plan', 'Write', { path: draft, content: plan }],
    ['read-plan', 'Read', { path: draft }],
    ['exit', 'ExitPlanMode', { allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }] }],
    ['write-after', 'Write', { path: draft, content: 'too late' }]
  ]
  const requests = []
  const server = createServer(async (req, res) => {
    let text = ''
    for await (const chunk of req) text += chunk
    requests.push(JSON.parse(text))
    const next = script.shift()
    const choice = next
      ? {
          delta: {
            tool_calls: [{
              index: 0,
              id: next[0],
              type: 'function',
              function: { name: next[1], arguments: JSON.stringify(next[2]) }
            }]
          },
          finish_reason: 'tool_calls'
        }
      : { delta: { content: 'done' }, finish_reason: 'stop' }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ choices: [choice] })}\n\ndata: [DONE]\n\n`)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  const configStore = new ConfigStore(join(f.base, 'config.json'))
  configStore.save({ version: 1, models: [{ id: 'fixture', capabilities: { tools: true } }] })
  const approvals = []
  const runtime = createAgentRuntime({
    cwd: f.repo,
    getConfig: () => ({
      baseUrl, model: 'fixture', profileId: 'fixture', apiKey: 'fixture-key',
      timeoutMs: 1000, source: 'env'
    }),
    approval: {
      async request(request) {
        approvals.push(request)
        return { outcome: 'allow', editedText: edited, via: 'user' }
      }
    },
    configStore,
    home: f.home,
    sessionId: 'wire-plan'
  })
  t.after(() => runtime.session.dispose())
  const { promise, resolve } = Promise.withResolvers()
  const results = new Map()
  runtime.session.on((event) => {
    if (event.type === 'tool_result') results.set(event.callId, event)
    if (event.type === 'turn_finalized') resolve(event)
  })
  runtime.session.submit('Plan the repair')
  const timeout = setTimeout(() => resolve(undefined), 8000)
  t.after(() => clearTimeout(timeout))
  assert.ok(await promise, 'fixture turn did not finish')
  assert.equal(results.get('enter-bad').isError, true)
  assert.ok(results.get('enter').content.includes(draft))
  assert.equal(results.get('write-other').isError, true)
  assert.equal(results.get('write-plan').isError, false)
  assert.match(results.get('read-plan').content, /Line 45/)
  assert.equal(approvals.length, 1)
  assert.equal(approvals[0].callId, 'exit')
  assert.equal(approvals[0].planId, 'plan-wire-plan')
  assert.equal(approvals[0].preview.join('\n'), plan)
  assert.match(approvals[0].summary, /Bash.*run tests/)
  assert.equal(results.get('exit').isError, false)
  assert.equal(results.get('write-after').isError, true)
  assert.equal(runtime.session.planMode.active, false)
  assert.equal(readFileSync(draft, 'utf8'), edited)
  assert.equal(readFileSync(other, 'utf8'), 'private neighbor')
  const toolMessage = requests.at(-1).messages.find((message) => message.tool_call_id === 'exit')
  assert.ok(toolMessage.content.includes(edited))
})
test('T15-13 生产 runtime 接线：四类工具就位、会话标识就绪，无已验证隔离后端时命令在 spawn 前被拒绝', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'budingx-runtime-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const config = {
    baseUrl: 'https://fixture.invalid/v1',
    model: 'fixture',
    apiKey: 'fixture-key',
    timeoutMs: 500,
    source: 'env'
  }
  const runtime = createAgentRuntime({
    cwd: base,
    getConfig: () => config,
    approval: { async request() { return { outcome: 'deny', via: 'user' } } },
    configStore: new ConfigStore(join(base, 'config.json')),
    home: join(base, '.budingx')
  })
  t.after(() => runtime.session.dispose())

  const names = runtime.session.tools.map((tool) => tool.name)
  for (const name of [
    'Read', 'Write', 'Edit', 'Glob', 'Grep',
    'Bash', 'PowerShell', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode'
  ]) {
    assert.ok(names.includes(name), `缺少工具：${name}`)
  }
  assert.equal(typeof runtime.session.id, 'string')
  assert.ok(runtime.session.id.length > 0, '会话标识用于后台输出与计划文件隔离')

  // SP004 §4.7：隔离后端由宿主注入，本仓尚无已验证后端 → 命令在 spawn 前即被拒绝。
  const events = []
  runtime.session.on((event) => events.push(event))
  const bash = runtime.session.tools.find((tool) => tool.name === 'Bash')
  await assert.rejects(
    () => bash.execute(
      { command: 'node -e "require(\'fs\').writeFileSync(\'spawned.txt\', \'x\')"' },
      { signal: new AbortController().signal }
    ),
    /隔离后端/
  )
  assert.equal(events.some((event) => event.type === 'command_started'), false)
  assert.equal(runtime.session.isBusy, false)
})
