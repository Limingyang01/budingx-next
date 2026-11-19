// SP004 T15 · 生产宿主计划集成（src/plan/host.ts）与计划模式工具表面（src/plan/tools.ts）。
// 覆盖：计划文件落盘、工作区/Git 快照指纹、漂移判定、执行前校验、工具调用成功与失败路径。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

test('普通 Markdown 正文追踪中文文件名、引号内空格和 Markdown 链接', (t) => {
  const f = makeRepo(t)
  const { host } = makeHost(f)
  const files = ['src/核心.mjs', 'src/新 模块.mjs', 'src/旧 说明.md', 'src/构建 文档.md']
  for (const file of files) writeFileSync(join(f.repo, file), 'initial')
  const text = [
    '修改 src/核心.mjs。',
    '修改 `src/新 模块.mjs`。',
    '更新 “src/旧 说明.md”。',
    '更新 [文档](<src/构建%20文档.md>)。'
  ].join('\n')
  host.writePlanText(text, '更新文件', ['修改目标'])
  const reviewed = host.snapshot()
  assert.deepEqual(Object.keys(reviewed.files).sort(), [...files].sort())
  host.store.requestApproval(text)
  const approved = host.store.approve(text)
  for (const file of files) writeFileSync(join(f.repo, file), 'changed')
  assert.deepEqual(host.validate(approved).drift.map((entry) => entry.item),
    files.map((file) => `files:${file}`).sort())
})

test('明确目标持久化并检测原本不存在的扩展名为空的文件', (t) => {
  const f = makeRepo(t)
  const { workspace, host } = makeHost(f)
  const path = 'src/空格 目录/新 文件'
  const text = '按计划添加新文件'
  host.writePlanText(text, '添加文件', ['写入新文件'], [path])
  const before = host.snapshot()
  assert.ok(Object.hasOwn(before.files, path))
  host.store.requestApproval(text)
  const approved = host.store.approve(text)
  const reopened = createPlanModeHost({ sessionId: 'sess-1', workspace, home: f.home })
  assert.deepEqual(reopened.store.current().targetPaths, [path])
  mkdirSync(join(f.repo, 'src', '空格 目录'), { recursive: true })
  writeFileSync(join(f.repo, path), 'unexpected creation')
  assert.deepEqual(reopened.validate(approved).drift.map((entry) => entry.item), [`files:${path}`])
})

test('明确目标拒绝越界、目录、链接和拒绝读取的目标', (t) => {
  const f = makeRepo(t)
  const outside = join(f.base, 'outside')
  mkdirSync(outside)
  symlinkSync(outside, join(f.repo, 'linked'), 'junction')
  const workspace = createWorkspace(f.repo)
  const host = createPlanModeHost({
    sessionId: 'sess-bounds',
    workspace,
    home: f.home,
    canReadPath: (path) => path !== 'notes.txt'
  })
  for (const path of ['../outside/file.mjs', join(outside, 'file.mjs'), 'linked/file.mjs',
    'C:/outside/file.mjs', 'src', 'src/.env', '.git/config', 'notes.txt']) {
    assert.throws(() => host.writePlanText('新计划', '修改目标', ['步骤'], [path]), /targetPaths/)
  }
  assert.deepEqual(host.snapshot('计划参考 `notes.txt` 和 `src/app.mjs`').files,
    { 'src/app.mjs': host.snapshot('src/app.mjs').files['src/app.mjs'] })
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
  const exited = await exit.execute({ allowedPrompts: [{ tool: 'Bash', prompt: '运行验证测试' }] }, context)
  assert.match(exited, /计划已批准（plan-sess-2）/)
  assert.equal(session.planMode.active, false)
  assert.equal(policy.getMode(), 'workspace_edit')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].name, 'ExitPlanMode')
  assert.equal(requests[0].planId, 'plan-sess-2')
  assert.ok(requests[0].preview.includes('Bash: 运行验证测试'))
  assert.equal(policy.decide({ tool: 'Bash', capability: 'execute' }).action, 'ask')

  // 非法 allowedPrompts 在校验层被拒绝，不触发审批。
  for (const allowedPrompts of [
    'nope', ['run tests'], [{ tool: 'PowerShell', prompt: 'test' }], [{ tool: 'Bash' }]
  ]) {
    await assert.rejects(() => exit.execute({ allowedPrompts }, context), /allowedPrompts/)
  }
  assert.equal(requests.length, 1)
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
    'Bash', 'PowerShell', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'WritePlan',
    'TodoWrite', 'EnterWorktree', 'ExitWorktree', 'GitCommit', 'TaskStatus', 'TaskCancel',
    'StartCodingTask', 'TaskRedirect'
  ]) {
    assert.ok(names.includes(name), `缺少工具：${name}`)
  }
  assert.equal(typeof runtime.session.id, 'string')
  assert.ok(runtime.session.id.length > 0, '会话标识用于后台输出与计划文件隔离')

  // SP004 §4.7：隔离后端由宿主注入，本仓尚无已验证后端 → 命令在 spawn 前即被拒绝。
  const events = []
  runtime.session.on((event) => events.push(event))
  const bash = runtime.session.tools.find((tool) => tool.name === 'Bash')
  const blocked = await bash.execute(
    { command: 'node -e "require(\'fs\').writeFileSync(\'spawned.txt\', \'x\')"' },
    { signal: new AbortController().signal }
  )
  assert.match(String(blocked), /隔离后端/, '拒绝原因必须说明缺少已验证隔离后端')
  assert.equal(events.some((event) => event.type === 'command_started'), false)
  assert.equal(runtime.session.isBusy, false)
})
