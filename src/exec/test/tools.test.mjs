// SP004 T5 · Bash/PowerShell 工具适配器与同一权限入口（design §4.5–§4.9）。
// 证据层级 L0（纯逻辑）+ L1（真实进程）；Session 集成用脚本化 provider。
import assert from 'node:assert/strict'
import { execFileSync, spawn as spawnRef } from 'node:child_process'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCommandRunner } from '../../tui/dist/exec/runner.js'
import { createExecTools } from '../../tui/dist/exec/tools.js'
import { createSandboxPolicy } from '../../tui/dist/exec/sandbox-policy.js'
import { createWorkspace } from '../../tui/dist/workspace/paths.js'
import { createPermissionPolicy } from '../../tui/dist/workspace/policy.js'
import { Session } from '../../tui/dist/core/session.js'

const verifiedBackend = {
  id: 'synthetic-backend',
  label: '合成验收后端',
  verified: true,
  capabilities: {
    allowWrite: [],
    denyWrite: [],
    allowRead: [],
    denyRead: [],
    networkDomains: [],
    canEnforceNetwork: true
  }
}

function makeRunner(extra = {}) {
  return createCommandRunner({
    defaultCwd: process.cwd(),
    sandboxPolicy: createSandboxPolicy({ backend: verifiedBackend }),
    ...extra
  })
}

function makeTools(runner, extra = {}) {
  const tools = createExecTools({
    runner,
    defaultCwd: process.cwd(),
    platform: process.platform,
    sandboxBackendId: verifiedBackend.id,
    ...extra
  })
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  return { tools, byName, bash: byName.get('Bash') }
}

function ctx(events = []) {
  return {
    events,
    context: {
      signal: new AbortController().signal,
      turnId: 'turn-1',
      callId: 'call-1',
      emit: (event) => events.push(event)
    }
  }
}

function withSpawnCounter(runnerOptions = {}) {
  const spawned = []
  const runner = makeRunner({
    spawn: (...args) => {
      spawned.push(args[0])
      return spawnRef(...args)
    },
    ...runnerOptions
  })
  return { runner, spawned }
}

test('T5-1 工具 schema：字段名、单位与必填项', () => {
  const runner = makeRunner()
  const { tools, bash } = makeTools(runner)
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['Bash', 'PowerShell']
  )
  const parameters = bash.parameters
  assert.equal(parameters.type, 'object')
  assert.deepEqual(Object.keys(parameters.properties), [
    'command',
    'timeout',
    'description',
    'run_in_background'
  ])
  assert.deepEqual(parameters.required, ['command'])
  assert.equal(parameters.additionalProperties, false)
  // timeout 以毫秒为单位（design §4.9）。
  assert.match(parameters.properties.timeout.description, /毫秒/)
  runner.dispose()
})

test('T5-2 未知字段拒绝且零 spawn（cwd/env 等宿主私有字段不可由模型提供）', async () => {
  const { runner, spawned } = withSpawnCounter()
  const { bash } = makeTools(runner)
  const { context } = ctx()
  await assert.rejects(
    () => bash.execute({ command: 'echo hi', cwd: '.' }, context),
    (error) => {
      assert.match(error.message, /未知参数|cwd/)
      assert.equal(error.code, 'BUDINGX_CORE_002')
      return true
    }
  )
  await assert.rejects(() => bash.execute({ command: 'echo hi', sandbox: 'off' }, context), /未知参数/)
  assert.equal(spawned.length, 0, '拒绝路径不得启动进程')
  runner.dispose()
})

test('T5-3 timeout 单位为毫秒：超时终止并回填 timeout 状态', async () => {
  const { runner } = withSpawnCounter()
  const { bash } = makeTools(runner)
  const { context } = ctx()
  const started = Date.now()
  const text = await bash.execute(
    { command: 'node -e "setTimeout(()=>{}, 5000)"', timeout: 300 },
    context
  )
  const elapsed = Date.now() - started
  assert.match(text, /timeout|超时/)
  assert.ok(elapsed < 4000, `应按毫秒级超时提前返回（实测 ${elapsed}ms）`)
  runner.dispose()
})

test('T5-4 能力分类：已校验只读命令归为 read，其余归为 execute', () => {
  const runner = makeRunner()
  const { bash } = makeTools(runner)
  assert.equal(bash.capability({ command: 'git status --porcelain' }), 'read')
  assert.equal(bash.capability({ command: 'git log --oneline -5' }), 'read')
  assert.equal(bash.capability({ command: 'git push origin HEAD' }), 'execute')
  assert.equal(bash.capability({ command: 'npm test' }), 'execute')
  assert.equal(bash.capability({ command: 'git status --unknown-flag' }), 'execute')
  assert.equal(bash.capability({ command: 'rm -rf build' }), 'execute')
  runner.dispose()
})

test('T5-5 Git 写命令经通用入口被引导到受控入口，零 spawn', async () => {
  const { runner, spawned } = withSpawnCounter()
  const { bash } = makeTools(runner)
  const { context } = ctx()
  await assert.rejects(
    () => bash.execute({ command: 'git push origin main' }, context),
    (error) => {
      assert.match(error.message, /受控入口|Git/)
      return true
    }
  )
  await assert.rejects(() => bash.execute({ command: 'git commit -m "x"' }, context), /受控入口|Git/)
  assert.equal(spawned.length, 0)
  runner.dispose()
})

test('T5-6 审批预览：命令/解释器/工作目录/超时/后台/隔离 + 破坏性警告', () => {
  const runner = makeRunner()
  const { bash } = makeTools(runner)
  const preview = bash.prepareApproval({ command: 'rm -rf build', timeout: 1000 }).preview.join('\n')
  assert.match(preview, /命令/)
  assert.match(preview, /解释器/)
  assert.match(preview, /工作目录/)
  assert.match(preview, /超时/)
  assert.match(preview, /后台/)
  assert.match(preview, /隔离/)
  assert.match(preview, /⚠/)
  assert.match(preview, /不可逆/)
  assert.match(preview, /synthetic-backend/)
  runner.dispose()
})

test('T5-7 前台成功：exit_code 0 与 stdout 分离回填', async () => {
  const runner = makeRunner()
  const { bash } = makeTools(runner)
  const { context } = ctx()
  const text = await bash.execute(
    { command: `node -e "process.stdout.write('ok-out');process.stderr.write('err-out')"` },
    context
  )
  assert.match(text, /exit_code: 0/)
  assert.match(text, /ok-out/)
  assert.match(text, /err-out/)
  assert.match(text, /stderr/)
  runner.dispose()
})

test('T5-8 非零退出码不被吞：exit_code 3 原样回填', async () => {
  const runner = makeRunner()
  const { bash } = makeTools(runner)
  const { context } = ctx()
  const text = await bash.execute({ command: 'node -e "process.exit(3)"' }, context)
  assert.match(text, /exit_code: 3/)
  runner.dispose()
})

test('T5-9 超大输出截断并标注', async () => {
  const runner = makeRunner()
  const { bash } = makeTools(runner)
  const { context } = ctx()
  const text = await bash.execute(
    { command: `node -e "process.stdout.write('x'.repeat(100*1024))"` },
    context
  )
  assert.match(text, /\[输出已截断/)
  runner.dispose()
})

test('T5-10 显式后台：回执含 exit_code <pending>/background_task_id/note，可查询可取消', async () => {
  const runner = makeRunner()
  const { bash } = makeTools(runner)
  const { context, events } = ctx()
  const text = await bash.execute(
    { command: 'node -e "setTimeout(()=>{}, 2000)"', run_in_background: true },
    context
  )
  assert.match(text, /exit_code: <pending>/)
  const match = /background_task_id: (task-[\w-]+)/.exec(text)
  assert.ok(match, '后台回执必须包含任务 ID')
  assert.match(text, /--- note ---/)
  const snapshot = runner.status(match[1])
  assert.ok(snapshot)
  const startedEvent = events.find((event) => event.type === 'command_started')
  assert.ok(startedEvent, '必须发 command_started 事件')
  assert.equal(startedEvent.callId, 'call-1')
  assert.equal(startedEvent.turnId, 'turn-1')
  assert.equal(startedEvent.taskId, match[1])
  assert.equal(runner.cancel(match[1]), true)
  runner.dispose()
})

test('T5-11 自动转后台：回执含 auto_backgrounded 与预算说明', async () => {
  const runner = makeRunner({ blockingBudgetMs: 200 })
  const { bash } = makeTools(runner)
  const { context } = ctx()
  const text = await bash.execute({ command: 'node -e "setTimeout(()=>{}, 1200)"' }, context)
  assert.match(text, /exit_code: <pending>/)
  assert.match(text, /auto_backgrounded: true/)
  assert.match(text, /阻塞预算/)
  runner.dispose()
})

test('T5-12 同一调用只产生一个工具结果，且事件带 callId', async () => {
  const runner = makeRunner()
  const { bash } = makeTools(runner)
  const { context, events } = ctx()
  const text = await bash.execute({ command: 'echo one' }, context)
  assert.match(text, /exit_code: 0/)
  assert.equal(
    events.filter((event) => event.type === 'command_started').length,
    1
  )
  // 前台命令无 taskId，不补发第二个「完成」事件（完成经工具结果表达）。
  assert.equal(events.filter((event) => event.type === 'command_finished').length, 0)
  runner.dispose()
})

function makeEnv(mode) {
  const base = mkdtempSync(join(tmpdir(), 'budingx-exec-policy-'))
  const root = join(base, 'workspace')
  const userRoot = join(base, '.budingx')
  mkdirSync(root)
  mkdirSync(userRoot)
  const workspace = createWorkspace(root)
  const policy = createPermissionPolicy({ workspace, mode, dataRootOverride: userRoot })
  return { base, root, workspace, policy, cleanup: () => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
}

function scriptProvider(script) {
  return {
    async *stream(request) {
      const events = script.shift() ?? [{ type: 'message_completed', finishReason: 'stop' }]
      for (const event of events) {
        if (request.signal?.aborted) {
          yield {
            type: 'failed',
            error: {
              class: 'aborted',
              code: 'BUDINGX_PROVIDER_007',
              message: 'Request cancelled by the user',
              retryable: false
            }
          }
          return
        }
        yield event
      }
    }
  }
}

/** 等待条件成立（事件驱动的回合推进），超时即失败。 */
async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('等待条件超时')
}

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: true }
}

test('T5-13 仅可查看模式：命令执行被硬性拒绝且零 spawn', async () => {
  const env = makeEnv('read_only')
  const { runner, spawned } = withSpawnCounter()
  const { bash } = makeTools(runner)
  const provider = scriptProvider([
    [
      {
        type: 'tool_call_delta',
        index: 0,
        callId: 'call-1',
        nameDelta: 'Bash',
        argsDelta: JSON.stringify({ command: 'echo hi' })
      },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ],
    [{ type: 'message_completed', finishReason: 'stop' }]
  ])
  const events = []
  const session = new Session({
    provider,
    approval: { async request() { throw new Error('read-only deny should not ask') } },
    resolveSnapshot: () => SNAPSHOT,
    tools: [bash],
    permissionPolicy: env.policy,
    onEvent: (event) => events.push(event)
  })
  session.submit('跑个命令')
  await waitFor(() => events.some((event) => event.type === 'tool_result'))
  const results = events.filter((event) => event.type === 'tool_result')
  assert.equal(results.length, 1)
  assert.match(results[0].content, /Denied/)
  assert.equal(spawned.length, 0)
  session.dispose()
  env.cleanup()
})

test('T5-14 工作区内修改模式：合格只读命令免审批直接执行', async (t) => {
  const env = makeEnv('workspace_edit')
  t.after(env.cleanup)
  execFileSync('git', ['init', '--quiet'], { cwd: env.root })
  const runner = makeRunner({ defaultCwd: env.root })
  const { bash } = makeTools(runner, { defaultCwd: env.root })
  const provider = scriptProvider([
    [
      {
        type: 'tool_call_delta',
        index: 0,
        callId: 'call-1',
        nameDelta: 'Bash',
        argsDelta: JSON.stringify({ command: 'git status --short' })
      },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ],
    [{ type: 'message_completed', finishReason: 'stop' }]
  ])
  const events = []
  const approvals = []
  const session = new Session({
    provider,
    approval: { async request(request) { approvals.push(request); return { outcome: 'allow', via: 'user' } } },
    resolveSnapshot: () => SNAPSHOT,
    tools: [bash],
    permissionPolicy: env.policy,
    onEvent: (event) => events.push(event)
  })
  t.after(() => session.dispose())
  session.submit('看下状态')
  await waitFor(() => events.some((event) => event.type === 'tool_result'), 8000)
  assert.equal(approvals.length, 0, '合格只读命令不应弹出审批')
  const results = events.filter((event) => event.type === 'tool_result')
  assert.equal(results.length, 1)
  assert.match(results[0].content, /exit_code: 0/)
})

test('T5-15 工作区内修改模式：普通命令走审批，拒绝后不执行', async () => {
  const env = makeEnv('workspace_edit')
  const { runner, spawned } = withSpawnCounter()
  const { bash } = makeTools(runner)
  const provider = scriptProvider([
    [
      {
        type: 'tool_call_delta',
        index: 0,
        callId: 'call-1',
        nameDelta: 'Bash',
        argsDelta: '{"command":"node -e \\"process.exit(0)\\""}'
      },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ],
    [{ type: 'message_completed', finishReason: 'stop' }]
  ])
  const events = []
  const session = new Session({
    provider,
    approval: { async request() { return { outcome: 'deny', via: 'user', feedback: '先别跑' } } },
    resolveSnapshot: () => SNAPSHOT,
    tools: [bash],
    permissionPolicy: env.policy,
    onEvent: (event) => events.push(event)
  })
  session.submit('跑')
  await waitFor(() => events.some((event) => event.type === 'tool_result'))
  const results = events.filter((event) => event.type === 'tool_result')
  assert.equal(results.length, 1)
  assert.match(results[0].content, /Denied|User feedback/)
  assert.equal(spawned.length, 0)
  session.dispose()
  env.cleanup()
})

test('T5-16 Session.dispose 终止仍在运行的后台任务', async () => {
  const runner = makeRunner()
  const { bash } = makeTools(runner)
  const provider = scriptProvider([
    [
      {
        type: 'tool_call_delta',
        index: 0,
        callId: 'call-1',
        nameDelta: 'Bash',
        argsDelta: '{"command":"node -e \\"setTimeout(()=>{},60000)\\"","run_in_background":true}'
      },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ],
    [{ type: 'message_completed', finishReason: 'stop' }]
  ])
  const events = []
  const session = new Session({
    provider,
    approval: { async request() { return { outcome: 'allow', via: 'user' } } },
    resolveSnapshot: () => SNAPSHOT,
    tools: [bash],
    disposers: [() => runner.dispose()],
    onEvent: (event) => events.push(event)
  })
  session.submit('后台跑个长任务')
  await new Promise((resolve) => setTimeout(resolve, 500))
  const results = events.filter((event) => event.type === 'tool_result')
  assert.equal(results.length, 1)
  const match = /background_task_id: (task-[\w-]+)/.exec(results[0].content)
  assert.ok(match, '应拿到后台任务 ID')
  session.dispose()
  const deadline = Date.now() + 5000
  let snapshot = runner.status(match[1])
  while (Date.now() < deadline && snapshot && snapshot.outcome === 'running') {
    await new Promise((resolve) => setTimeout(resolve, 50))
    snapshot = runner.status(match[1])
  }
  assert.equal(snapshot?.outcome, 'cancelled', 'Session.dispose 必须终止后台任务')
})
