import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { dataRoot, permissionModePath } from '../dist/storage/paths.js'
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
    const response = typeof next === 'function' ? await next(requests.at(-1)) : next
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
  const runtimeWithApproval = (gateway) => createAgentRuntime({
    cwd, home: join(base, 'home'), configStore, mode: 'full_access',
    getConfig: () => ({
      profileId: profile.id, baseUrl, model: 'sp004', apiKey: 'fixture-key',
      timeoutMs: setup.timeoutMs ?? 2000, source: 'file'
    }),
    approval: {
      async request(request) {
        approvals.push(request)
        if (gateway) return gateway.request(request)
        return setup.approve?.(request) ?? { outcome: 'allow', via: 'user' }
      },
      cancelAll: () => gateway?.cancelAll()
    },
    sandboxBackend: setup.sandboxBackend
  })
  let runtime
  let ui
  if (setup.tty) {
    const { mountTty } = await import('./helpers/mount-tty.mjs')
    ui = await mountTty(t, {
      config: { profileId: profile.id, baseUrl, model: 'sp004' },
      sessionFactory: ({ gateway }) => {
        runtime = runtimeWithApproval(gateway)
        return runtime.session
      }
    })
  } else {
    runtime = runtimeWithApproval()
  }
  t.after(() => {
    runtime.session.dispose()
    server.closeAllConnections()
    server.close()
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const events = []
  runtime.session.on((event) => events.push(event))
  return { base, cwd, requests, approvals, runtime, events, ui }
}

test('SP004 生产入口：模型写计划、显示审批、更新独立待办，工具结果以原 call ID 回填', async (t) => {
  const { runtime, requests, approvals, events } = await sp004Runtime(t, [
    [['EnterPlanMode', {}], ['WritePlan', {
      text: '# 修订计划\n1. 修改 src/app.ts', goal: '修订计划', steps: ['修改 src/app.ts']
    }]],
    [['ExitPlanMode', { allowedPrompts: [{ tool: 'Bash', prompt: '运行单元测试' }] }], ['TodoWrite', { todos: [
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
  assert.ok(approvals[0].preview.some((line) => line.includes('Bash') && line.includes('运行单元测试')))
  assert.deepEqual(runtime.policy.listRules(), [])
  const todos = events.find((event) => event.type === 'todos_updated')
  assert.equal(todos.items[0].activeForm, '正在补测试')
  const finalTools = requests[2].messages.filter((message) => message.role === 'tool')
  assert.deepEqual(finalTools.map((message) => message.tool_call_id),
    ['call-1-0', 'call-1-1', 'call-2-0', 'call-2-1'])
  assert.match(finalTools[1].content, /会话计划已更新/)
  assert.match(finalTools[2].content, /计划已批准/)
})

async function assertPlanReapproval(t, target, reference, targetPaths) {
  const draft = {
    text: `# 审查计划\n1. 读取 ${reference} 后产生交付文件`,
    goal: '审查计划',
    steps: [`读取 ${reference} 后产生交付文件`],
    ...(targetPaths ? { targetPaths } : {})
  }
  let cwd
  const deniedPath = 'before-reapproval.mjs'
  const { runtime, approvals, events, ui, cwd: root } = await sp004Runtime(t, [
    [['EnterPlanMode', {}], ['WritePlan', draft]],
    [['ExitPlanMode', {}]],
    () => {
      writeFileSync(join(cwd, target), 'export const value = 2\n')
      return [['Write', { path: deniedPath, content: 'export default false\n' }]]
    },
    [['ExitPlanMode', {}]],
    [['Write', { path: 'after-reapproval.mjs', content: 'export default true\n' }]],
    '结束'
  ], { tty: true })
  cwd = root
  writeFileSync(join(root, target), 'export const value = 1\n')
  await ui.send('制定计划并执行\r')
  await ui.waitFor((frame) => ui.gateway.pendingRequests.length === 1 &&
    frame.includes('需要审批: ExitPlanMode') && frame.includes('批准计划：审查计划'))
  await ui.send('1')
  await ui.waitFor((frame) => approvals.length === 2 && ui.gateway.pendingRequests.length === 1 &&
    frame.includes('需要审批: ExitPlanMode') && frame.includes('重新审批的漂移项'), 5000)
  await ui.send('1')
  await ui.waitFor(() => !runtime.session.isBusy)
  assert.equal(events.find((event) => event.type === 'turn_finalized').outcome, 'completed')
  const results = events.filter((event) => event.type === 'tool_result')
  assert.deepEqual(approvals.map(({ name }) => name), ['ExitPlanMode', 'ExitPlanMode'])
  assert.notEqual(approvals[0].requestId, approvals[1].requestId)
  const drift = results.find((result) => result.callId === 'call-3-0').content
  assert.match(drift, /Plan drifted/)
  assert.ok(drift.includes(target), drift)
  assert.equal(results.find((result) => result.callId === 'call-4-0').isError, false)
  assert.equal(existsSync(join(root, deniedPath)), false)
  assert.equal(readFileSync(join(root, 'after-reapproval.mjs'), 'utf8'), 'export default true\n')
  assert.equal(runtime.session.planMode.active, false)
}

test('SP004 正式 TUI：计划漂移阻止写入，重新审批后只执行重新发起的写入', (t) =>
  assertPlanReapproval(t, 'target.mjs', 'target.mjs'))

test('SP004 正式 TUI：计划漂移重审识别中文和含空格的目标路径', async (t) => {
  await t.test('裸写的中文文件名', (t) => assertPlanReapproval(t, '测试.mjs', '测试.mjs'))
  await t.test('用反引号标记的含空格路径', (t) =>
    assertPlanReapproval(t, 'two words.mjs', '`two words.mjs`'))
  await t.test('没有在正文重述的结构化中文路径', (t) =>
    assertPlanReapproval(t, '中文 测试.mjs', '已声明的目标', ['中文 测试.mjs']))
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

test('SP004 正式 TUI：测试通过后的文件写入使旧证据失效', async (t) => {
  let starts = 0
  const backend = createHostProcessFixture({
    spawn(_executable, _args, options) {
      starts += 1
      return spawn(process.execPath, ['--test', 'proof.test.mjs'], options)
    }
  })
  const { runtime, cwd, requests, events } = await sp004Runtime(t, [
    [['StartCodingTask', { goal: '更新 fixture' }]],
    [['Bash', { command: 'node --test proof.test.mjs' }]],
    [['Write', { path: 'new-file.mjs', content: 'export const value = 2\n' }]],
    '已经完成',
    [['Bash', { command: 'node --test proof.test.mjs' }]],
    '写入后已重新测试'
  ], { sandboxBackend: backend })
  writeFileSync(join(cwd, 'proof.test.mjs'), "import { test } from 'node:test'\ntest('fixture', () => {})\n")
  assert.equal((await turn(runtime.session, '更新 fixture 并测试')).outcome, 'completed')
  assert.equal(starts, 2)
  assert.equal(events.find((event) => event.type === 'tool_result' && event.callId === 'call-3-0').isError, false)
  assert.equal(readFileSync(join(cwd, 'new-file.mjs'), 'utf8'), 'export const value = 2\n')
  assert.ok(requests[4].messages.some((message) => message.role === 'user' &&
    typeof message.content === 'string' && message.content.includes('真实执行证据')))
})

test('SP004 正式 TUI：成功的后台测试可直接作为完成证据', { timeout: 12000 }, async (t) => {
  let starts = 0
  let runtimeEvents
  const backend = createHostProcessFixture({
    spawn(_executable, _args, options) {
      starts += 1
      return spawn(process.execPath, ['--test', 'proof.test.mjs'], options)
    }
  })
  const { runtime, cwd, requests, events } = await sp004Runtime(t, [
    [['StartCodingTask', { goal: '在后台验证 fixture' }]],
    [['Bash', { command: 'node --test proof.test.mjs', run_in_background: true }]],
    async (request) => {
      const launch = request.messages.find((message) => message.role === 'tool' &&
        message.tool_call_id === 'call-2-0')
      const taskId = /background_task_id: (\S+)/.exec(launch?.content ?? '')?.[1]
      const deadline = Date.now() + 3000
      while (!runtimeEvents.some((event) => event.type === 'command_finished' && event.taskId === taskId) &&
        Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      return [['TaskStatus', { task_id: taskId ?? 'missing' }]]
    },
    '后台测试完成'
  ], { sandboxBackend: backend })
  runtimeEvents = events
  writeFileSync(join(cwd, 'proof.test.mjs'), "import { test } from 'node:test'\ntest('fixture', () => {})\n")
  assert.equal((await turn(runtime.session, '在后台验证 fixture')).outcome, 'completed')
  const terminal = events.find((event) => event.type === 'command_finished')
  assert.equal(terminal.callId, 'call-2-0')
  assert.equal(terminal.exitCode, 0)
  assert.equal(starts, 1)
  assert.equal(requests.length, 4)
  assert.ok(!events.some((event) => event.type === 'notice' && event.code === 'coding_task'))
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

test('SP004 正式 TUI：前后台命令结束前输出已流式落盘，终态回执保留文件路径', { timeout: 30000 }, async (t) => {
  let launch = 0
  const batchBytes = 1280 * 1024
  const program = [
    "const { existsSync } = require('node:fs')",
    'const [gate, marker, byteCount] = process.argv.slice(1)',
    'process.stdout.write(Buffer.alloc(Number(byteCount), marker))',
    "process.stderr.write('stderr-' + marker + '\\n')",
    'const end = Date.now() + 18000',
    'const wait = setInterval(() => {',
    '  if (existsSync(gate)) clearInterval(wait)',
    '  else if (Date.now() >= end) { clearInterval(wait); process.exitCode = 5 }',
    '}, 20)'
  ].join('\n')
  const backend = createHostProcessFixture({
    spawn(_executable, _args, options) {
      const marker = ++launch === 1 ? 'F' : 'B'
      return spawn(process.execPath, [
        '-e', program, `release-${marker}`, marker, String(batchBytes)
      ], options)
    }
  })
  const { ui, base, cwd, runtime, events } = await sp004Runtime(t, [
    [['Bash', { command: 'node stream-fixture.mjs' }]],
    [['Bash', { command: 'node stream-fixture.mjs', run_in_background: true }]],
    '报告已保存'
  ], { sandboxBackend: backend, tty: true })
  const tasks = join(dataRoot(join(base, 'home')), 'sessions', runtime.session.id, 'tasks')
  const hasLiveOutput = () => existsSync(tasks) && readdirSync(tasks).some((name) =>
    name.endsWith('.out.partial') && (statSync(join(tasks, name), { throwIfNoEntry: false })?.size ?? 0) >= batchBytes)
  await ui.send('运行前后台输出回归\r')
  await ui.waitFor(() => launch === 1 && hasLiveOutput(), 7000)
  assert.equal(events.some((event) => event.type === 'tool_result' && event.callId === 'call-1-0'), false)
  writeFileSync(join(cwd, 'release-F'), '')
  await ui.waitFor(() => launch === 2 && hasLiveOutput(), 7000)
  assert.equal(events.some((event) => event.type === 'command_finished' && event.callId === 'call-2-0'), false)
  writeFileSync(join(cwd, 'release-B'), '')
  await ui.waitFor(() => events.some((event) => event.type === 'command_finished' && event.callId === 'call-2-0'), 7000)
  const foreground = events.find((event) => event.type === 'tool_result' && event.callId === 'call-1-0')
  const foregroundPath = /^persisted_output_path: (.+)$/m.exec(foreground?.content ?? '')?.[1]
  const background = events.find((event) => event.type === 'command_finished' && event.callId === 'call-2-0')
  assert.ok(foregroundPath, foreground?.content.slice(0, 350))
  assert.equal(foreground.isError, false)
  assert.match(foreground.content, /输出已截断/)
  assert.equal(background.outcome, 'completed')
  for (const [path, marker] of [[foregroundPath, 'F'], [background.outputPath, 'B']]) {
    const artifact = readFileSync(path)
    assert.equal(artifact.length, batchBytes + Buffer.byteLength(`stderr-${marker}\n`))
    assert.ok(artifact.includes(Buffer.from(`stderr-${marker}\n`)))
  }
  assert.equal(readdirSync(tasks).some((name) => name.endsWith('.out.partial')), false)
})

test('SP004 正式 TUI：输出落盘失败单独提示并保留前后台命令退出状态', { timeout: 30000 }, async (t) => {
  let launch = 0
  let sessionEvents
  const backend = createHostProcessFixture({
    spawn(_executable, _args, options) {
      const foreground = ++launch === 1
      return spawn(process.execPath, ['-e',
        foreground ? 'process.stdout.write(Buffer.alloc(1280 * 1024, 70))' : 'process.exitCode = 7'
      ], options)
    }
  })
  const { ui, base, runtime, events } = await sp004Runtime(t, [
    [['Bash', { command: 'node log-fixture.mjs' }]],
    [['Bash', { command: 'node log-fixture.mjs', run_in_background: true }]],
    async (request) => {
      const started = request.messages.find((message) => message.tool_call_id === 'call-2-0')
      const taskId = /background_task_id: (\S+)/.exec(started?.content ?? '')?.[1]
      const deadline = Date.now() + 8000
      while (!sessionEvents.some((event) => event.type === 'command_finished' && event.taskId === taskId) &&
        Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      return [['TaskStatus', { task_id: taskId ?? 'missing' }]]
    },
    '已报告退出状态'
  ], { sandboxBackend: backend, tty: true, timeoutMs: 12000 })
  sessionEvents = events
  const sessionDir = join(dataRoot(join(base, 'home')), 'sessions', runtime.session.id)
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(join(sessionDir, 'tasks'), 'synthetic fixture: destination unavailable')
  await ui.send('验证日志失败提示\r')
  await ui.waitFor(() => events.some((event) => event.type === 'turn_finalized'), 16000)
  const foreground = events.find((event) => event.type === 'tool_result' && event.callId === 'call-1-0')
  assert.equal(foreground.isError, false)
  assert.match(foreground.content, /exit_code: 0/)
  assert.match(foreground.content.slice(0, 1024), /output_warning: create_failed/)
  assert.doesNotMatch(foreground.content, /persisted_output_path:/)
  const background = events.find((event) => event.type === 'command_finished' && event.callId === 'call-2-0')
  assert.equal(background.outcome, 'failed')
  assert.equal(background.exitCode, 7)
  assert.equal(background.outputWarning, 'create_failed')
  const status = events.find((event) => event.type === 'tool_result' && event.callId === 'call-3-0')
  assert.match(status.content, /exit_code: 7/)
  assert.match(status.content, /output_warning: create_failed/)
  await ui.waitFor((_frame, frames) => frames.some((frame) => frame.includes('命令日志未保存')))
  assert.equal(readFileSync(join(sessionDir, 'tasks'), 'utf8'), 'synthetic fixture: destination unavailable')
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

test('SP004 正式 TUI：已探测的主机隔离后端执行 Bash，仅暴露允许的项目输入', { timeout: 40000 }, async (t) => {
  const { createHostSandboxFromEnvironment } = await import('../dist/exec/host-sandbox.js')
  const backend = createHostSandboxFromEnvironment({ BUDINGX_SANDBOX: 'bubblewrap' })
  if (!backend) {
    t.skip('当前宿主没有通过 Bubblewrap 能力探测')
    return
  }
  const { ui, cwd, runtime, events } = await sp004Runtime(t, [
    [['Bash', {
      command: [
        'test -f visible.txt',
        'test ! -e .git',
        'test ! -e .env',
        'test ! -e hidden.txt',
        'test ! -e id_ed25519',
        'test ! -e nested/id_ecdsa_sk',
        'test -f id_ed25519.pub',
        'printf isolated-ready'
      ].join(' && ')
    }]],
    '隔离执行完成'
  ], { sandboxBackend: backend, tty: true })
  writeFileSync(join(cwd, 'visible.txt'), 'allowed fixture')
  writeFileSync(join(cwd, 'hidden.txt'), 'restricted fixture')
  writeFileSync(join(cwd, '.env'), 'SYNTHETIC_VALUE=fixture\n')
  writeFileSync(join(cwd, 'id_ed25519'), 'Synthetic file, no private key\n')
  writeFileSync(join(cwd, 'id_ed25519.pub'), 'Synthetic public fixture\n')
  mkdirSync(join(cwd, 'nested'))
  writeFileSync(join(cwd, 'nested', 'id_ecdsa_sk'), 'Synthetic file, no private key\n')
  mkdirSync(join(cwd, '.git'))
  runtime.policy.setRules([{ id: 'fixture-deny', action: 'deny', tool: 'Read', path: 'hidden.txt' }])
  await ui.send('验证隔离 execution\r')
  await ui.waitFor(() => events.some((event) => event.type === 'turn_finalized'), 20000)
  const result = events.find((event) => event.type === 'tool_result')
  assert.equal(result.isError, false, result.content)
  assert.match(result.content, /exit_code: 0/)
  assert.match(result.content, /isolated-ready/)
  assert.equal(readFileSync(join(cwd, 'visible.txt'), 'utf8'), 'allowed fixture')
})

const passingShellSuite = [
  'set -eu',
  'test -s input.txt',
  "printf 'TAP version 13\\nok 1 - fixture input\\n1..1\\n# tests 1\\n# pass 1\\n# fail 0\\n# skipped 0\\n'"
].join('\n') + '\n'

test('SP004 正式 TUI：私有快照里的临时修改无法证明真实工作区测试通过', { timeout: 45000 }, async (t) => {
  const { createHostSandboxFromEnvironment } = await import('../dist/exec/host-sandbox.js')
  const backend = createHostSandboxFromEnvironment({ BUDINGX_SANDBOX: 'bubblewrap' })
  if (!backend) {
    t.skip('当前宿主没有通过 Bubblewrap 能力探测')
    return
  }
  const command = { command: 'bash proof.test.sh' }
  const { cwd, runtime, events, requests, ui } = await sp004Runtime(t, [
    [['StartCodingTask', { goal: '修复合成测试' }]],
    [['Bash', command]],
    [['Bash', { command: "printf 'exit 0\\n' > proof.test.sh && bash proof.test.sh" }]],
    '已经完成',
    [['Read', { path: 'proof.test.sh' }]],
    [['Write', { path: 'proof.test.sh', content: passingShellSuite }]],
    [['Bash', command]],
    '工作区修复后验证通过'
  ], { sandboxBackend: backend, tty: true })
  writeFileSync(join(cwd, 'proof.test.sh'), 'exit 7\n')
  writeFileSync(join(cwd, 'input.txt'), 'test input\n')
  await ui.send('修复合成测试并验证\r')
  await ui.waitFor(() => !runtime.session.isBusy && events.some((event) => event.type === 'turn_finalized'), 35000)
  assert.equal(events.find((event) => event.type === 'turn_finalized').outcome, 'completed')
  assert.equal(requests.length, 8, '快照内修改后仍需要工作区修复与复测')
  const first = events.find((event) => event.type === 'tool_result' && event.callId === 'call-2-0')
  assert.match(first.content, /exit_code: 7/)
  const privateWrite = events.find((event) => event.type === 'tool_result' && event.callId === 'call-3-0')
  assert.match(privateWrite.content, /test_evidence: unavailable/)
  const verified = events.find((event) => event.type === 'tool_result' && event.callId === 'call-7-0')
  assert.match(verified.content, /test_evidence: verified/)
  assert.ok(requests[4].messages.some((message) => message.role === 'user' &&
    typeof message.content === 'string' && message.content.includes('真实执行证据')))
  assert.equal(readFileSync(join(cwd, 'proof.test.sh'), 'utf8'), passingShellSuite)
})

test('SP004 正式 TUI：测试结束后发生外部写入，旧快照不能完成验收', { timeout: 45000 }, async (t) => {
  const { createHostSandboxFromEnvironment } = await import('../dist/exec/host-sandbox.js')
  const backend = createHostSandboxFromEnvironment({ BUDINGX_SANDBOX: 'bubblewrap' })
  if (!backend) {
    t.skip('当前宿主没有通过 Bubblewrap 能力探测')
    return
  }
  let workspace
  let sessionEvents
  const command = { command: 'bash proof.test.sh' }
  const { cwd, runtime, events, requests } = await sp004Runtime(t, [
    [['StartCodingTask', { goal: '验证当前合成输入' }]],
    [['Bash', command]],
    () => {
      writeFileSync(join(workspace, 'input.txt'), 'second\n')
      return '已经验证完成'
    },
    [['Bash', { ...command, run_in_background: true }]],
    async (request) => {
      const result = request.messages.find((message) => message.tool_call_id === 'call-4-0')
      const taskId = /background_task_id: (\S+)/.exec(result?.content ?? '')?.[1]
      const deadline = Date.now() + 8000
      while (!sessionEvents.some((event) => event.type === 'command_finished' && event.taskId === taskId) &&
        Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      return [['TaskStatus', { task_id: taskId ?? 'missing' }]]
    },
    '已按当前输入重新验证'
  ], { sandboxBackend: backend, timeoutMs: 12000 })
  workspace = cwd
  sessionEvents = events
  writeFileSync(join(cwd, 'proof.test.sh'), passingShellSuite)
  writeFileSync(join(cwd, 'input.txt'), 'first\n')
  assert.equal((await turn(runtime.session, '验证当前合成输入')).outcome, 'completed')
  assert.equal(requests.length, 6, '测试结果发出后改变工作区必须重新验证')
  const results = events.filter((event) => event.type === 'tool_result' && event.callId.endsWith('-0'))
  assert.match(results.find((event) => event.callId === 'call-2-0').content, /test_evidence: verified/)
  assert.match(results.find((event) => event.callId === 'call-5-0').content, /test_evidence: verified/)
  assert.equal(events.find((event) => event.type === 'command_finished' && event.callId === 'call-4-0')
    .testEvidence.status, 'verified')
  assert.ok(events.some((event) => event.type === 'notice' && event.code === 'coding_task'))
})

test('SP004 正式 TUI：零测试不会结束回合，非交互 unittest 执行到实际测试后才能完成', { timeout: 50000 }, async (t) => {
  const { createHostSandboxFromEnvironment } = await import('../dist/exec/host-sandbox.js')
  const backend = createHostSandboxFromEnvironment({ BUDINGX_SANDBOX: 'bubblewrap' })
  if (!backend) {
    t.skip('当前宿主没有通过 Bubblewrap 能力探测')
    return
  }
  const testFile = [
    'import unittest',
    '',
    'class FixtureTest(unittest.TestCase):',
    '    def test_fixture(self):',
    '        self.assertEqual(2 + 2, 4)'
  ].join('\n') + '\n'
  const { cwd, runtime, events, requests, ui } = await sp004Runtime(t, [
    [['StartCodingTask', { goal: '验证 Python fixture' }]],
    [['Bash', { command: 'bash proof.test.sh' }]],
    '已经完成',
    [['Write', { path: 'test_fixture.py', content: testFile }]],
    [['Bash', { command: 'python3 -m unittest discover' }]],
    '已运行一个测试并通过'
  ], { sandboxBackend: backend, tty: true })
  writeFileSync(join(cwd, 'proof.test.sh'), 'python3 run_suite.py\n')
  writeFileSync(join(cwd, 'run_suite.py'), [
    'import sys, unittest',
    "suite = unittest.defaultTestLoader.discover('.')",
    'result = unittest.TextTestRunner().run(suite)',
    'sys.exit(0 if result.wasSuccessful() else 1)'
  ].join('\n') + '\n')
  await ui.send('运行 Python fixture 测试\r')
  await ui.waitFor(() => !runtime.session.isBusy && events.some((event) => event.type === 'turn_finalized'), 35000)
  assert.equal(events.find((event) => event.type === 'turn_finalized').outcome, 'completed')
  const zero = events.find((event) => event.type === 'tool_result' && event.callId === 'call-2-0')
  const positive = events.find((event) => event.type === 'tool_result' && event.callId === 'call-5-0')
  assert.match(zero.content, /exit_code: 0/)
  assert.match(zero.content, /Ran 0 tests/)
  assert.match(zero.content, /test_evidence: no_tests/)
  assert.equal(requests.length, 6, 'must add and run an actual test after the zero-test command')
  assert.match(positive.content, /Ran 1 test/)
  assert.match(positive.content, /test_evidence: verified/)
})

test('SP004 正式 TUI：清理日志不遮蔽有效测试计数，随后零测试仍使证据失效', { timeout: 50000 }, async (t) => {
  const { createHostSandboxFromEnvironment } = await import('../dist/exec/host-sandbox.js')
  const backend = createHostSandboxFromEnvironment({ BUDINGX_SANDBOX: 'bubblewrap' })
  if (!backend) {
    t.skip('当前宿主没有通过 Bubblewrap 能力探测')
    return
  }
  const { cwd, runtime, events, requests, ui } = await sp004Runtime(t, [
    [['StartCodingTask', { goal: '验证有清理阶段的测试' }]],
    [['Bash', { command: 'bash later-empty.test.sh' }]],
    '已经完成',
    [['Bash', { command: 'bash passing.test.sh' }]],
    '一个测试通过，清理已完成'
  ], { sandboxBackend: backend, tty: true })
  writeFileSync(join(cwd, 'test_fixture.py'), [
    'import unittest',
    'class FixtureTest(unittest.TestCase):',
    '    def test_fixture(self):',
    '        self.assertEqual(2 + 2, 4)'
  ].join('\n') + '\n')
  writeFileSync(join(cwd, 'empty_suite.py'), [
    'import sys, unittest',
    'result = unittest.TextTestRunner().run(unittest.TestSuite())',
    'sys.exit(0 if result.wasSuccessful() else 1)'
  ].join('\n') + '\n')
  writeFileSync(join(cwd, 'passing.test.sh'), [
    'set -eu',
    'python3 -m unittest discover 2>&1',
    "printf 'cleanup complete\\n'"
  ].join('\n') + '\n')
  writeFileSync(join(cwd, 'later-empty.test.sh'), [
    'set -eu',
    'bash passing.test.sh',
    'python3 empty_suite.py 2>&1',
    "printf 'second cleanup complete\\n'"
  ].join('\n') + '\n')
  await ui.send('运行带清理步骤的测试\r')
  await ui.waitFor(() => !runtime.session.isBusy && events.some((event) => event.type === 'turn_finalized'), 35000)
  assert.equal(events.find((event) => event.type === 'turn_finalized').outcome, 'completed')
  const laterEmpty = events.find((event) => event.type === 'tool_result' && event.callId === 'call-2-0')
  const passing = events.find((event) => event.type === 'tool_result' && event.callId === 'call-4-0')
  assert.match(laterEmpty.content, /Ran 1 test/)
  assert.match(laterEmpty.content, /Ran 0 tests/)
  assert.match(laterEmpty.content, /test_evidence: no_tests/)
  assert.match(passing.content, /cleanup complete/)
  assert.match(passing.content, /test_evidence: verified/)
  assert.match(passing.content, /tests_executed: 1/)
  assert.equal(requests.length, 5)
})

test('SP004 正式 TUI：无编号和超长 TAP 失败都使先前通过数失效', { timeout: 50000 }, async (t) => {
  const { createHostSandboxFromEnvironment } = await import('../dist/exec/host-sandbox.js')
  const backend = createHostSandboxFromEnvironment({ BUDINGX_SANDBOX: 'bubblewrap' })
  if (!backend) {
    t.skip('当前宿主没有通过 Bubblewrap 能力探测')
    return
  }
  const { cwd, runtime, events, requests, ui } = await sp004Runtime(t, [
    [['StartCodingTask', { goal: '核对实际 TAP 结果' }]],
    [['Bash', { command: 'bash unnumbered.test.sh' }]],
    '测试完成',
    [['Bash', { command: 'bash long-failure.test.sh' }]],
    '测试完成',
    [['Bash', { command: 'bash passing.test.sh' }]],
    '测试通过，清理完成'
  ], { sandboxBackend: backend, tty: true })
  writeFileSync(join(cwd, 'input.txt'), 'synthetic fixture\n')
  writeFileSync(join(cwd, 'passing.test.sh'), [
    'set -eu',
    'test -s input.txt',
    "printf 'TAP version 13\\nok 1 - fixture input exists\\n1..1\\n'",
    "printf 'ok cleanup complete\\n'"
  ].join('\n') + '\n')
  for (const [file, failure] of [
    ['unnumbered.test.sh', 'not ok - expected artifact is missing'],
    ['long-failure.test.sh', 'not ok 2 - expected artifact is missing ' + '诊'.repeat(1500)]
  ]) {
    writeFileSync(join(cwd, file), [
      'set -eu',
      'bash passing.test.sh',
      `if ! test -f expected.txt; then printf '%s\\n' '${failure}'; fi`
    ].join('\n') + '\n')
  }
  await ui.send('验证 TAP 测试并保留清理结果\r')
  await ui.waitFor(() => !runtime.session.isBusy && events.some((event) => event.type === 'turn_finalized'), 35000)
  assert.equal(events.find((event) => event.type === 'turn_finalized').outcome, 'completed')
  assert.equal(requests.length, 7, 'either TAP failure must cause a retry even when the process exits zero')
  for (const callId of ['call-2-0', 'call-4-0']) {
    const result = events.find((event) => event.type === 'tool_result' && event.callId === callId)
    assert.match(result.content, /exit_code: 0/)
    assert.match(result.content, /test_evidence: no_tests/)
    assert.match(result.content, /not ok/)
  }
  const passing = events.find((event) => event.type === 'tool_result' && event.callId === 'call-6-0')
  assert.match(passing.content, /test_evidence: verified/)
  assert.match(passing.content, /tests_executed: 1/)
  assert.match(passing.content, /ok cleanup complete/)
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
