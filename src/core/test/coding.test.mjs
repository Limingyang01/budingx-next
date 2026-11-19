// SP004 T1 · 编码任务完成证据判定（设计 §5.2 判定表，纯函数）。
import { createHostProcessFixture } from '../../exec/test/helpers/host-process.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { TASK_PHASES, isTestCommand, canClaimDone } from '../../tui/dist/core/coding.js'

test('TaskPhase 枚举固定为七值', () => {
  assert.deepEqual([...TASK_PHASES], [
    'orienting',
    'editing',
    'testing',
    'fixing',
    'awaiting_user',
    'done',
    'failed'
  ])
})

test('isTestCommand 启发式识别测试类命令', () => {
  const positives = [
    'npm run test:unit',
    'npm test',
    'pnpm test',
    'node --test src/core/test/exec.test.mjs',
    'pytest -q',
    'go test ./...',
    'cargo test',
    'make test',
    'vitest run',
    'jest',
    'mocha',
    'python -m unittest',
    'tox'
  ]
  for (const command of positives) {
    assert.equal(isTestCommand(command), true, command)
  }
  const negatives = ['echo hello', 'node build.mjs', 'git status', 'ls -la', 'npm run build']
  for (const command of negatives) {
    assert.equal(isTestCommand(command), false, command)
  }
})

const baseState = {
  taskId: 'task-1',
  goal: '修复缺陷',
  phase: 'testing',
  iterations: 1
}

test('canClaimDone：无命令证据不通过', () => {
  assert.deepEqual(canClaimDone(undefined), {
    ok: false,
    reason: '未执行过任何命令，无法证明任务完成'
  })
  assert.deepEqual(canClaimDone(baseState), {
    ok: false,
    reason: '未执行过任何命令，无法证明任务完成'
  })
})

test('canClaimDone：最近命令失败/超时/阻塞不通过', () => {
  for (const outcome of ['failed', 'timeout', 'blocked']) {
    const state = {
      ...baseState,
      lastTest: { command: 'npm test', exitCode: 1, outcome, at: 1 },
      testEvidence: { command: 'npm test', exitCode: 0, at: 0 }
    }
    const verdict = canClaimDone(state)
    assert.equal(verdict.ok, false, outcome)
    assert.ok(verdict.reason.includes('最近一次命令未成功'), verdict.reason)
  }
})

test('canClaimDone：成功但非测试类且无测试证据不通过', () => {
  const state = {
    ...baseState,
    lastTest: { command: 'echo hello', exitCode: 0, outcome: 'completed', at: 1 }
  }
  assert.deepEqual(canClaimDone(state), { ok: false, reason: '未运行测试' })
})

test('canClaimDone：测试类命令成功后通过', () => {
  const state = {
    ...baseState,
    lastTest: { command: 'npm test', exitCode: 0, outcome: 'completed', at: 1 },
    testEvidence: { command: 'npm test', exitCode: 0, at: 1 }
  }
  assert.deepEqual(canClaimDone(state), { ok: true })
})

test('canClaimDone：曾有测试成功但最近命令失败仍不通过', () => {
  const state = {
    ...baseState,
    lastTest: { command: 'npm test', exitCode: 2, outcome: 'failed', at: 2 },
    testEvidence: { command: 'npm test', exitCode: 0, at: 1 }
  }
  const verdict = canClaimDone(state)
  assert.equal(verdict.ok, false)
  assert.ok(verdict.reason.includes('需继续修复'), verdict.reason)
})
// ---------------------------------------------------------------------------
// SP004 T13 · 编码任务目标状态机与完成证据（design §5.2–§5.3，
// AC CT-01/CT-02/CT-04/CT-07/CT-08）。状态机是纯逻辑；Session 部分验证
// 完成声明校验、迭代上限与转向接线。
import {
  createCodingTaskTracker,
  createTaskRedirectTool
} from '../../tui/dist/core/coding.js'
import { Session } from '../../tui/dist/core/session.js'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: true }
}

const failedResult = {
  outcome: 'failed',
  exitCode: 1,
  stdout: '',
  stderr: 'boom',
  output: 'boom',
  truncated: false,
  bytes: 4,
  durationMs: 5
}

const passedResult = {
  outcome: 'completed',
  exitCode: 0,
  stdout: 'ok',
  stderr: '',
  output: 'ok',
  truncated: false,
  bytes: 2,
  durationMs: 5
}

function scriptProvider(script) {
  const requests = []
  return {
    requests,
    provider: {
      async *stream(request) {
        requests.push(request)
        const events = script.shift() ?? [{ type: 'message_completed', finishReason: 'stop' }]
        for (const event of events) yield event
      }
    }
  }
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('等待条件超时')
}

function textTurn(text) {
  return [
    { type: 'text_delta', text },
    { type: 'message_completed', finishReason: 'stop' }
  ]
}

function toolTurn(name, args, callId = 'call-1') {
  return [
    {
      type: 'tool_call_delta',
      index: 0,
      callId,
      nameDelta: name,
      argsDelta: JSON.stringify(args)
    },
    { type: 'message_completed', finishReason: 'tool_calls' }
  ]
}

/** 伪造一条命令证据工具：execute 时通过宿主回调上报 CommandResult。 */
function makeFakeRunTool(queue) {
  return {
    name: 'FakeRun',
    summary: 'Run a fake command and report its result to the host',
    capability: () => 'execute',
    target: () => ({ kind: 'none' }),
    describe: () => '运行假命令',
    async execute(_input, context) {
      const entry = queue.shift()
      context.onCommandResult?.(entry.command, entry.result)
      return `exit_code: ${entry.result.exitCode ?? 0}`
    }
  }
}

function makeSession({ script, tracker, tools = [] }) {
  const events = []
  const { provider, requests } = scriptProvider(script)
  const session = new Session({
    provider,
    approval: {
      async request() {
        throw new Error('编码任务用例不应走审批通道')
      }
    },
    resolveSnapshot: () => SNAPSHOT,
    tools,
    ...(tracker ? { codingTask: tracker } : {}),
    onEvent: (event) => events.push(event)
  })
  return { session, events, requests }
}

test('T13-1 无任何命令证据时不能声称完成（CT-07）', () => {
  const tracker = createCodingTaskTracker()
  const task = tracker.start('修复登录失败')
  assert.equal(task.goal, '修复登录失败')
  assert.equal(task.phase, 'orienting')
  const verdict = tracker.canClaimDone()
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /未执行过任何命令/)
})

test('T13-2 最近命令失败时不能声称完成（CT-07/CT-01）', () => {
  const tracker = createCodingTaskTracker()
  tracker.start('修复登录失败')
  tracker.observeCommand('npm test', failedResult)
  const state = tracker.get()
  assert.equal(state.lastTest.command, 'npm test')
  assert.equal(state.lastTest.outcome, 'failed')
  assert.equal(state.lastTest.exitCode, 1)
  assert.equal(state.phase, 'fixing')
  const verdict = tracker.canClaimDone()
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /最近一次命令未成功（exit=1）/)
})

test('T13-3 最近命令成功但不是测试类命令时不能声称完成（CT-07）', () => {
  const tracker = createCodingTaskTracker()
  tracker.start('修复登录失败')
  tracker.observeCommand('git status', passedResult)
  const verdict = tracker.canClaimDone()
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /未运行测试/)
})

test('T13-4 测试类命令成功后可声称完成（CT-07）', () => {
  const tracker = createCodingTaskTracker()
  tracker.start('修复登录失败')
  tracker.observeCommand('npm test', failedResult)
  tracker.observeCommand('npm test', passedResult)
  assert.equal(tracker.get().phase, 'testing')
  assert.equal(tracker.canClaimDone().ok, true)
})

test('T13-5 redirect 替换目标后旧目标与旧证据不再驱动状态（CT-04）', () => {
  const tracker = createCodingTaskTracker()
  tracker.start('修复登录失败')
  tracker.observeCommand('npm test', passedResult)
  assert.equal(tracker.canClaimDone().ok, true)
  tracker.redirect('改为实现注册页')
  const state = tracker.get()
  assert.equal(state.goal, '改为实现注册页')
  assert.equal(state.phase, 'orienting')
  assert.ok(state.goalReplacedAt > 0)
  assert.equal(state.lastTest, undefined)
  assert.equal(state.testEvidence, undefined)
  assert.equal(tracker.canClaimDone().ok, false)
})

test('T13-6 supplement 纳入当前目标但不替换（CT-03 前置）', () => {
  const tracker = createCodingTaskTracker()
  tracker.start('修复登录失败')
  tracker.supplement('顺便补一条回归测试')
  const state = tracker.get()
  assert.equal(state.goal, '修复登录失败')
  assert.deepEqual(state.supplements, ['顺便补一条回归测试'])
})

test('T13-7 达到迭代上限以 max_turns 终止且保留最后失败证据（CT-02）', async () => {
  const tracker = createCodingTaskTracker()
  tracker.start('修复登录失败')
  const queue = [
    { command: 'npm test', result: failedResult },
    { command: 'npm test', result: failedResult }
  ]
  const events = []
  const { provider } = scriptProvider([
    toolTurn('FakeRun', {}),
    toolTurn('FakeRun', {}, 'call-2')
  ])
  const session = new Session({
    provider,
    approval: { async request() { throw new Error('不应审批') } },
    resolveSnapshot: () => SNAPSHOT,
    tools: [makeFakeRunTool(queue)],
    codingTask: tracker,
    maxIterations: 2,
    onEvent: (event) => events.push(event)
  })
  session.submit('修复登录失败')
  await waitFor(() => events.some((event) => event.type === 'turn_finalized'))
  const finalized = events.find((event) => event.type === 'turn_finalized')
  assert.equal(finalized.outcome, 'max_turns')
  const last = tracker.get().lastTest
  assert.equal(last.outcome, 'failed')
  assert.equal(last.exitCode, 1)
  assert.equal(tracker.canClaimDone().ok, false)
  session.dispose()
})

test('T13-8 isTestCommand 覆盖常见测试命令（启发式）', () => {
  for (const command of [
    'npm test',
    'npm run test',
    'pnpm test',
    'npx vitest run',
    'jest --ci',
    'pytest -q',
    'python -m unittest',
    'go test ./...',
    'cargo test',
    'make test',
    'npm run check'
  ]) {
    assert.equal(isTestCommand(command), true, command)
  }
  for (const command of ['git status', 'echo hi', 'npm run build', 'node -e "1"']) {
    assert.equal(isTestCommand(command), false, command)
  }
})

test('T13-9 无证据的完成声明被拒绝并触发继续迭代（CT-07）', async () => {
  const tracker = createCodingTaskTracker()
  tracker.start('修复登录失败')
  const queue = [{ command: 'npm test', result: passedResult }]
  const events = []
  const { provider, requests } = scriptProvider([
    textTurn('已完成，可以交付。'),
    toolTurn('FakeRun', {}),
    textTurn('测试通过，已完成。')
  ])
  const session = new Session({
    provider,
    approval: { async request() { throw new Error('不应审批') } },
    resolveSnapshot: () => SNAPSHOT,
    tools: [makeFakeRunTool(queue)],
    codingTask: tracker,
    onEvent: (event) => events.push(event)
  })
  session.submit('修复登录失败')
  await waitFor(() => events.some((event) => event.type === 'turn_finalized'))
  const finalized = events.find((event) => event.type === 'turn_finalized')
  assert.equal(finalized.outcome, 'completed')
  assert.equal(requests.length, 3, '完成声明被拒后必须继续迭代')
  const injected = JSON.stringify(requests[1].messages)
  assert.match(injected, /未运行测试|未执行过任何命令/, '拒绝原因必须回喂给模型')
  const notice = events.find(
    (event) => event.type === 'notice' && event.code === 'coding_task'
  )
  assert.ok(notice, '必须告知宿主动完成声明被拒')
  assert.equal(tracker.canClaimDone().ok, true)
  session.dispose()
})

test('T13-10 TaskRedirect 通过工具替换目标且不需要审批（CT-04）', async () => {
  const tracker = createCodingTaskTracker()
  tracker.start('修复登录失败')
  tracker.observeCommand('npm test', passedResult)
  const queue = [{ command: 'npm test', result: passedResult }]
  const events = []
  const { provider, requests } = scriptProvider([
    toolTurn('TaskRedirect', { goal: '改为实现注册页', reason: '用户改主意了' }),
    toolTurn('FakeRun', {}, 'call-2'),
    textTurn('新目标的测试通过，已完成。')
  ])
  const session = new Session({
    provider,
    approval: { async request() { throw new Error('转向不应走审批通道') } },
    resolveSnapshot: () => SNAPSHOT,
    tools: [createTaskRedirectTool(tracker), makeFakeRunTool(queue)],
    codingTask: tracker,
    maxIterations: 4,
    onEvent: (event) => events.push(event)
  })
  session.submit('方向变了')
  await waitFor(() => events.some((event) => event.type === 'turn_finalized'))
  const results = events.filter((event) => event.type === 'tool_result')
  assert.equal(results.length, 2)
  assert.match(results[0].content, /改为实现注册页/)
  assert.equal(requests.length, 3)
  const state = tracker.get()
  assert.equal(state.goal, '改为实现注册页')
  assert.equal(state.testEvidence.command, 'npm test')
  assert.equal(tracker.canClaimDone().ok, true)
  session.dispose()
})

test('T13-11 真实命令执行证据经工具回调进入跟踪器（CT-08）', async () => {
  const tracker = createCodingTaskTracker()
  tracker.start('验证命令证据接线')
  const { createExecTools } = await import('../../tui/dist/exec/tools.js')
  const { createCommandRunner } = await import('../../tui/dist/exec/runner.js')
  const { createSandboxPolicy } = await import('../../tui/dist/exec/sandbox-policy.js')
  const verifiedBackend = createHostProcessFixture()
  const runner = createCommandRunner({
    defaultCwd: process.cwd(),
    sandboxPolicy: createSandboxPolicy({ backend: verifiedBackend })
  })
  const events = []
  const { provider } = scriptProvider([
    toolTurn('Bash', { command: 'node -e "process.exit(1)"' }),
    textTurn('命令失败了，继续修复。')
  ])
  const session = new Session({
    provider,
    approval: { async request() { throw new Error('不应审批') } },
    resolveSnapshot: () => SNAPSHOT,
    tools: createExecTools({
      runner,
      defaultCwd: process.cwd(),
      platform: process.platform,
      sandboxBackendId: verifiedBackend.id
    }),
    codingTask: tracker,
    onEvent: (event) => events.push(event)
  })
  session.submit('跑一个会失败的命令')
  await waitFor(() => events.some((event) => event.type === 'turn_finalized'), 15000)
  const last = tracker.get().lastTest
  assert.ok(last, '真实命令结果必须进入跟踪器')
  assert.equal(last.command, 'node -e "process.exit(1)"')
  assert.equal(last.outcome, 'failed')
  assert.equal(last.exitCode, 1)
  assert.equal(tracker.canClaimDone().ok, false)
  session.dispose()
  runner.dispose?.()
})

const workspaceWrite = {
  name: 'WorkspaceWrite',
  describe: () => '修改源文件',
  capability: () => 'write',
  async execute(_input, context) {
    context.changes?.([{
      id: 'change-1',
      path: 'source.mjs',
      operation: 'update',
      additions: 1,
      removals: 1,
      at: '2026-11-19T00:00:00.000Z'
    }])
    return '文件已变更'
  }
}

function startAndFinishTools(getSession, { automatic = false } = {}) {
  let origin
  return [
    {
      name: 'StartTest',
      describe: () => '后台运行测试',
      capability: () => 'execute',
      async execute(_input, context) {
        origin = { turnId: context.turnId, callId: context.callId }
        context.emit?.({
          type: 'command_started',
          ...origin,
          command: 'npm test',
          interpreter: 'bash',
          cwd: '/workspace',
          ...(automatic ? {} : { taskId: 'task-background' }),
          startedAt: 100
        })
        return '后台任务已启动'
      }
    },
    {
      name: 'FinishTest',
      describe: () => '接收后台测试结果',
      async execute() {
        getSession().commandFinished({
          type: 'command_finished',
          ...origin,
          taskId: 'task-background',
          outcome: 'completed',
          exitCode: 0,
          finishedAt: 101
        })
        return '后台测试已成功'
      }
    }
  ]
}

test('SP004 证据：通过测试后写文件，必须针对修改后的代码重新测试', async (t) => {
  const tracker = createCodingTaskTracker()
  tracker.start('修复缺陷')
  const { session, events, requests } = makeSession({
    tracker,
    tools: [workspaceWrite, makeFakeRunTool([
      { command: 'npm test', result: passedResult },
      { command: 'npm test', result: passedResult }
    ])],
    script: [
      toolTurn('FakeRun', {}, 'test-original'),
      toolTurn('WorkspaceWrite', {}, 'write-source'),
      textTurn('已完成。'),
      toolTurn('FakeRun', {}, 'test-changed'),
      textTurn('修改后的测试已通过。')
    ]
  })
  t.after(() => session.dispose())
  session.submit('修改并测试')
  await waitFor(() => events.some(({ type }) => type === 'turn_finalized'))
  assert.equal(requests.length, 5)
  assert.equal(events.find(({ type }) => type === 'turn_finalized').outcome, 'completed')
  assert.equal(tracker.canClaimDone().ok, true)
})

test('SP004 证据：手动和自动转后台的测试成功均可作为完成证据', async (t) => {
  for (const automatic of [false, true]) {
    await t.test(automatic ? '自动转后台' : '直接启动后台', async (subtest) => {
      const tracker = createCodingTaskTracker()
      tracker.start('修复缺陷')
      const tools = startAndFinishTools(() => session, { automatic })
      const { session, events, requests } = makeSession({
        tracker,
        tools,
        script: [
          toolTurn('StartTest', {}, 'begin-test'),
          toolTurn('FinishTest', {}, 'observe-test'),
          textTurn('后台测试已通过。')
        ]
      })
      subtest.after(() => session.dispose())
      session.submit('运行后台测试')
      await waitFor(() => events.some(({ type }) => type === 'turn_finalized'))
      assert.equal(requests.length, 3)
      assert.equal(tracker.canClaimDone().ok, true)
      assert.equal(events.find(({ type }) => type === 'turn_finalized').outcome, 'completed')
    })
  }
})

test('SP004 证据：旧后台测试在写文件、转向或工作区切换后完成，不能恢复旧证据', async (t) => {
  for (const mutation of ['write', 'redirect', 'switch']) {
    await t.test(mutation, async (subtest) => {
      const tracker = createCodingTaskTracker()
      tracker.start('修复缺陷')
      const tools = startAndFinishTools(() => session)
      const { session, events, requests } = makeSession({
        tracker,
        tools: [...tools, workspaceWrite, createTaskRedirectTool(tracker), {
          name: 'SwitchWorkspace',
          describe: () => '切换工作区',
          async execute() {
            session.invalidateCodingEvidence()
            return '工作区已切换'
          }
        }, makeFakeRunTool([{ command: 'npm test', result: passedResult }])],
        script: [
          toolTurn('StartTest', {}, 'begin-old-test'),
          mutation === 'write'
            ? toolTurn('WorkspaceWrite', {}, 'write-source')
            : mutation === 'redirect'
              ? toolTurn('TaskRedirect', { goal: '修改新目标' }, 'new-goal')
              : toolTurn('SwitchWorkspace', {}, 'new-workspace'),
          toolTurn('FinishTest', {}, 'observe-old-test'),
          textTurn('旧后台测试通过，可以完成。'),
          toolTurn('FakeRun', {}, 'test-current'),
          textTurn('当前工作区的测试通过。')
        ]
      })
      subtest.after(() => session.dispose())
      session.submit('验证当前工作区')
      await waitFor(() => events.some(({ type }) => type === 'turn_finalized'))
      assert.equal(requests.length, 6)
      assert.ok(events.some(({ type, callId }) => type === 'tool_call_completed' && callId === 'test-current'))
      assert.equal(tracker.canClaimDone().ok, true)
    })
  }
})

test('SP004 证据：命令运行中不得声明完成，只读检查保留原有测试证据', () => {
  const tracker = createCodingTaskTracker()
  tracker.start('修复缺陷')
  tracker.observeCommand('npm test', passedResult)
  const inspection = tracker.beginCommand(false)
  assert.equal(tracker.canClaimDone().ok, false)
  tracker.observeCommand('git status', passedResult, inspection)
  assert.equal(tracker.canClaimDone().ok, true)
  const possibleWrite = tracker.beginCommand(true)
  tracker.observeCommand('node prepare.mjs', passedResult, possibleWrite)
  assert.equal(tracker.canClaimDone().ok, false)
})

test('SP004 证据：重叠的可写命令结束前后均不能证明一次并发测试覆盖了最终内容', () => {
  const tracker = createCodingTaskTracker()
  tracker.start('修复缺陷')
  const writer = tracker.beginCommand(true)
  const testRun = tracker.beginCommand(true)
  tracker.observeCommand('npm test', passedResult, testRun)
  assert.equal(tracker.canClaimDone().ok, false)
  tracker.observeCommand('node prepare.mjs', passedResult, writer)
  assert.equal(tracker.canClaimDone().ok, false)
  tracker.observeCommand('npm test', passedResult, tracker.beginCommand(true))
  assert.equal(tracker.canClaimDone().ok, true)
})

test('SP004 证据：未验明和已过期的快照均不能证明任务完成', () => {
  const tracker = createCodingTaskTracker()
  tracker.start('修复缺陷')
  for (const status of ['unavailable', 'stale']) {
    tracker.observeCommand('bash proof.test.sh', { ...passedResult, testEvidence: { status } })
    assert.equal(tracker.canClaimDone().ok, false)
  }
  const attestation = { status: 'verified', workspaceDigest: 'fixture-digest' }
  tracker.observeCommand('bash proof.test.sh', { ...passedResult, testEvidence: attestation })
  assert.equal(tracker.canClaimDone().ok, false)
  assert.equal(tracker.canClaimDone(() => false).ok, false)
  assert.equal(tracker.canClaimDone((evidence) => evidence === attestation).ok, true)
})
