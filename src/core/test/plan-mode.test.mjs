// SP004 T11 · 单一计划模式状态转换（design §6.2–§6.3，AC TP-03…TP-05）。
// Session 用脚本化 provider + 合成计划宿主驱动；计划存储复用 T10 实现。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Session } from '../../tui/dist/core/session.js'
import { createPlanStore } from '../../tui/dist/plan/store.js'
import { validateBeforeExecute } from '../../tui/dist/plan/validate.js'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: true }
}

const BASE_FILES = { 'src/app.ts': 'digest-app', 'notes.txt': 'digest-notes' }
const HEAD_A = 'a'.repeat(40)
const HEAD_B = 'b'.repeat(40)

function scriptProvider(script) {
  return {
    async *stream() {
      const events = script.shift() ?? [{ type: 'message_completed', finishReason: 'stop' }]
      for (const event of events) yield event
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

function toolTurn(name, args = {}) {
  return [
    [
      {
        type: 'tool_call_delta',
        index: 0,
        callId: `call-${name}`,
        nameDelta: name,
        argsDelta: JSON.stringify(args)
      },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ],
    [{ type: 'message_completed', finishReason: 'stop' }]
  ]
}

/**
 * 合成权限策略：read 恒允许；写/执行在 read_only 下拒绝、工作区档位询问；
 * `blocked` 集合模拟底层硬 deny（如数据根/凭据），计划模式不得覆盖。
 */
function makePolicy(mode = 'read_only', { blocked = [] } = {}) {
  let current = mode
  const listeners = []
  const remembered = []
  return {
    remembered,
    getMode: () => current,
    setMode(next) {
      current = next
      for (const listener of listeners) listener(next)
    },
    onModeChanged(listener) {
      listeners.push(listener)
    },
    canRemember: () => true,
    remember(request) {
      remembered.push(request)
    },
    decide(request) {
      if (blocked.includes(request.tool)) {
        return { action: 'deny', reason: `${request.tool} touches protected user data` }
      }
      if (request.capability === 'read') return { action: 'allow', reason: 'read' }
      if (current === 'read_only') {
        return { action: 'deny', reason: 'The read-only mode does not allow this operation' }
      }
      if (current === 'full_access') return { action: 'allow', reason: 'full access' }
      return { action: 'ask', reason: 'needs confirmation' }
    }
  }
}

function makeTool(name, capability, executed) {
  return {
    name,
    describe: () => `调用 ${name}`,
    capability: () => capability,
    target: () => ({ path: 'notes.txt', kind: 'file' }),
    prepareApproval: () => ({
      preview: [`${name} 预览`],
      execute: async () => {
        executed.push(name)
        return `${name} done`
      }
    }),
    async execute() {
      executed.push(name)
      return `${name} done`
    }
  }
}

function makeGateway(decision) {
  const requests = []
  let settle
  const gateway = {
    async request(request) {
      requests.push(request)
      if (decision === 'manual') {
        return new Promise((resolve) => {
          settle = resolve
        })
      }
      return typeof decision === 'function' ? decision(request) : decision
    }
  }
  return {
    requests,
    gateway,
    resolve(decision = { outcome: 'allow', via: 'user' }) {
      settle?.(decision)
    }
  }
}

function makePlanHost({ text = '# 计划\n1. 步骤一', files = BASE_FILES, head = HEAD_A } = {}) {
  const state = {
    planText: text,
    snapshot: { root: '/repo', head, files: { ...files } }
  }
  const store = createPlanStore({ snapshot: () => state.snapshot, now: () => 1000 })
  const host = {
    store,
    state,
    setText(value) {
      state.planText = value
    },
    async readPlanText() {
      return store.current()?.draftText ?? state.planText
    },
    snapshot: () => state.snapshot,
    diff(baseline, current) {
      const drift = []
      if (baseline.root !== current.root) {
        drift.push({ item: 'root', expected: baseline.root, actual: current.root })
      }
      if ((baseline.head ?? '') !== (current.head ?? '')) {
        drift.push({ item: 'head', expected: baseline.head ?? '', actual: current.head ?? '' })
      }
      for (const path of Object.keys({ ...baseline.files, ...current.files })) {
        if ((baseline.files[path] ?? '') !== (current.files[path] ?? '')) {
          drift.push({
            item: `files:${path}`,
            expected: baseline.files[path] ?? '',
            actual: current.files[path] ?? ''
          })
        }
      }
      return drift
    },
    validate: (plan) => validateBeforeExecute(plan, state.snapshot)
  }
  return host
}

function makeSession({ script = [], tools = [], policy, planMode, approval }) {
  const events = []
  const session = new Session({
    provider: scriptProvider(script),
    approval: approval.gateway,
    resolveSnapshot: () => SNAPSHOT,
    tools,
    permissionPolicy: policy,
    planMode,
    onEvent: (event) => events.push(event)
  })
  return { session, events }
}

async function runToolTurn(session, events, name) {
  const before = events.filter((event) => event.type === 'tool_result').length
  session.submit(`调用 ${name}`)
  await waitFor(
    () => events.filter((event) => event.type === 'tool_result').length > before,
    8000
  )
  return events.filter((event) => event.type === 'tool_result').at(-1)
}

test('T11-1 进入计划模式：记录原档位与基线并保持单一状态', async () => {
  const policy = makePolicy('read_only')
  const planMode = makePlanHost()
  const { session, events } = makeSession({
    policy,
    planMode,
    approval: makeGateway({ outcome: 'allow', via: 'user' })
  })
  const result = session.enterPlanMode()
  assert.equal(result.ok, true)
  assert.deepEqual(session.planMode, {
    active: true,
    phase: 'research',
    originalMode: 'read_only'
  })
  assert.equal(policy.getMode(), 'workspace_edit')
  assert.deepEqual(
    events.filter((event) => event.type === 'plan_mode_changed'),
    [{ type: 'plan_mode_changed', active: true, phase: 'research', originalMode: 'read_only' }]
  )
  assert.equal(session.enterPlanMode().ok, false, '不允许嵌套进入计划模式')
  session.dispose()
})

test('T11-2 调研期只读：底层已准许的只读不请求批准', async () => {
  const policy = makePolicy('read_only')
  const executed = []
  const approval = makeGateway({ outcome: 'deny', via: 'user' })
  const { session, events } = makeSession({
    script: toolTurn('ReadNotes'),
    tools: [makeTool('ReadNotes', 'read', executed)],
    policy,
    planMode: makePlanHost(),
    approval
  })
  session.enterPlanMode()
  const result = await runToolTurn(session, events, 'ReadNotes')
  assert.equal(result.isError, false)
  assert.match(result.content, /ReadNotes done/)
  assert.equal(approval.requests.length, 0)
  assert.deepEqual(executed, ['ReadNotes'])
  session.dispose()
})

test('T11-3 调研期写：一次性批准后执行，下一次再次询问且不记忆', async () => {
  const policy = makePolicy('read_only')
  const executed = []
  const approval = makeGateway({ outcome: 'allow_session', via: 'user' })
  const { session, events } = makeSession({
    script: [...toolTurn('WriteNotes'), ...toolTurn('WriteNotes')],
    tools: [makeTool('WriteNotes', 'write', executed)],
    policy,
    planMode: makePlanHost(),
    approval
  })
  session.enterPlanMode()
  const first = await runToolTurn(session, events, 'WriteNotes')
  assert.equal(first.isError, false)
  assert.match(first.content, /WriteNotes done/)
  assert.equal(approval.requests.length, 1)
  const second = await runToolTurn(session, events, 'WriteNotes')
  assert.equal(second.isError, false)
  assert.equal(approval.requests.length, 2, '计划模式的一次性批准不得跨调用复用')
  assert.equal(approval.requests[1].callId, 'call-WriteNotes')
  assert.deepEqual(policy.remembered, [], '一次性批准不应写入权限记忆')
  assert.equal(session.planMode.phase, 'research')
  session.dispose()
})

test('T11-4 调研期：底层硬拒绝优先，计划模式不覆盖也不询问', async () => {
  const policy = makePolicy('read_only', { blocked: ['ProtectedWrite'] })
  const executed = []
  const approval = makeGateway({ outcome: 'allow', via: 'user' })
  const { session, events } = makeSession({
    script: toolTurn('ProtectedWrite'),
    tools: [makeTool('ProtectedWrite', 'write', executed)],
    policy,
    planMode: makePlanHost(),
    approval
  })
  session.enterPlanMode()
  const result = await runToolTurn(session, events, 'ProtectedWrite')
  assert.equal(result.isError, true)
  assert.match(result.content, /Denied: ProtectedWrite touches protected user data/)
  assert.equal(approval.requests.length, 0)
  assert.deepEqual(executed, [])
  session.dispose()
})

test('T11-5 待批期间不得启动副作用', async () => {
  const policy = makePolicy('read_only')
  const host = makePlanHost()
  host.store.create('实现 X', [{ title: '步骤一' }])
  const executed = []
  const approval = makeGateway('manual')
  const { session, events } = makeSession({
    script: toolTurn('WriteNotes'),
    tools: [makeTool('WriteNotes', 'write', executed)],
    policy,
    planMode: host,
    approval
  })
  session.enterPlanMode()
  const pending = session.exitPlanMode()
  await waitFor(() => approval.requests.length === 1)
  assert.equal(session.planMode.phase, 'pending')

  const denied = await runToolTurn(session, events, 'WriteNotes')
  assert.equal(denied.isError, true)
  assert.match(denied.content, /Plan approval pending/)
  assert.equal(approval.requests.length, 1, '待批期间不得再发起工具批准')
  assert.deepEqual(executed, [])

  approval.resolve({ outcome: 'allow', via: 'user' })
  const result = await pending
  assert.equal(result.ok, true)
  assert.equal(session.planMode.active, false)
  session.dispose()
})

test('T11-6 ExitPlanMode 缺文件或空计划：工具错误且停留在调研', async () => {
  const policy = makePolicy('read_only')
  const host = makePlanHost()
  host.store.create('实现 X', [{ title: '步骤一' }])
  const approval = makeGateway({ outcome: 'allow', via: 'user' })
  const { session } = makeSession({ policy, planMode: host, approval })
  session.enterPlanMode()

  host.setText(undefined)
  const missing = await session.exitPlanMode()
  assert.equal(missing.ok, false)
  assert.match(missing.message, /缺失或为空/)
  assert.equal(policy.getMode(), 'workspace_edit')
  assert.equal(session.planMode.phase, 'research')

  host.setText('   \n  ')
  const empty = await session.exitPlanMode()
  assert.equal(empty.ok, false)
  assert.match(empty.message, /缺失或为空/)
  assert.equal(approval.requests.length, 0)
  assert.equal(host.store.current().approval, 'none')
  session.dispose()
})

test('T11-7 批准：携带计划标识/版本、用户编辑正文与指纹，随后恢复原档位', async () => {
  const policy = makePolicy('read_only')
  const host = makePlanHost()
  host.store.create('实现 X', [{ title: '步骤一' }])
  const approval = makeGateway((request) => {
    assert.equal(typeof request.planId, 'string')
    assert.equal(typeof request.planVersion, 'number')
    return { outcome: 'allow', via: 'user', editedText: '# 用户改后的计划' }
  })
  const { session, events } = makeSession({ policy, planMode: host, approval })
  session.enterPlanMode()
  const result = await session.exitPlanMode()
  assert.equal(result.ok, true)
  assert.equal(result.edited, true)
  const plan = host.store.current()
  assert.equal(plan.approval, 'approved')
  assert.equal(plan.approvedText, '# 用户改后的计划')
  assert.equal(typeof plan.fingerprint, 'string')
  assert.ok(plan.fingerprint.length > 0)
  assert.equal(policy.getMode(), 'read_only', '批准后恢复原权限档位')
  assert.equal(session.planMode.active, false)
  assert.deepEqual(
    events.filter((event) => event.type === 'plan_mode_changed').at(-1),
    { type: 'plan_mode_changed', active: false, originalMode: 'read_only' }
  )
  session.dispose()
})

test('T11-8 拒绝与取消：保持调研并记录反馈', async () => {
  const policy = makePolicy('read_only')
  const host = makePlanHost()
  host.store.create('实现 X', [{ title: '步骤一' }])
  const approval = makeGateway({
    outcome: 'deny',
    via: 'user',
    feedback: '先补测试再动 src/app.ts'
  })
  const { session } = makeSession({ policy, planMode: host, approval })
  session.enterPlanMode()
  const rejected = await session.exitPlanMode()
  assert.equal(rejected.ok, false)
  assert.match(rejected.message, /先补测试再动 src\/app\.ts/)
  assert.equal(host.store.current().approval, 'rejected')
  assert.match(host.store.current().approvedText, /拒绝原因/)
  assert.equal(policy.getMode(), 'workspace_edit', '拒绝后停留在调研档位')
  assert.equal(session.planMode.phase, 'research')

  const cancelApproval = makeGateway({ outcome: 'cancelled', via: 'user' })
  const second = makeSession({ policy, planMode: host, approval: cancelApproval })
  second.session.enterPlanMode()
  const cancelled = await second.session.exitPlanMode()
  assert.equal(cancelled.ok, false)
  assert.equal(cancelled.cancelled, true)
  assert.equal(second.session.planMode.phase, 'research')
  second.session.dispose()
  session.dispose()
})

test('T11-9 研究期工作区漂移：拒绝批准且计划保持未批准', async () => {
  const policy = makePolicy('read_only')
  const host = makePlanHost()
  host.store.create('实现 X', [{ title: '步骤一' }])
  const approval = makeGateway({ outcome: 'allow', via: 'user' })
  const { session } = makeSession({ policy, planMode: host, approval })
  session.enterPlanMode()
  host.state.snapshot = {
    ...host.state.snapshot,
    head: HEAD_B,
    files: { ...BASE_FILES, 'src/app.ts': 'digest-changed' }
  }
  const result = await session.exitPlanMode()
  assert.equal(result.ok, false)
  assert.match(result.message, /漂移/)
  assert.deepEqual(
    result.drift.map((item) => item.item).sort(),
    ['files:src/app.ts', 'head']
  )
  assert.equal(approval.requests.length, 0)
  assert.equal(host.store.current().approval, 'none')
  assert.equal(policy.getMode(), 'workspace_edit')
  session.dispose()
})

test('T11-10 计划漂移阻止写入，重新审批后才能执行', async () => {
  const policy = makePolicy('full_access')
  const host = makePlanHost()
  host.store.create('实现 X', [{ title: '步骤一' }])
  const executed = []
  const approval = makeGateway(() => ({
    outcome: 'allow', via: 'user', editedText: '# 用户已修改的计划\n1. 修改 notes.txt'
  }))
  const { session, events } = makeSession({
    script: [...toolTurn('WriteNotes'), ...toolTurn('WriteNotes'), ...toolTurn('WriteNotes')],
    tools: [makeTool('WriteNotes', 'write', executed)],
    policy,
    planMode: host,
    approval
  })
  session.enterPlanMode()
  const result = await session.exitPlanMode()
  assert.equal(result.ok, true)
  assert.equal(policy.getMode(), 'full_access')

  host.state.snapshot = {
    ...host.state.snapshot,
    files: { ...BASE_FILES, 'notes.txt': 'digest-drifted' }
  }
  const blocked = await runToolTurn(session, events, 'WriteNotes')
  assert.equal(blocked.isError, true)
  assert.match(blocked.content, /Plan drifted before execution/)
  assert.match(blocked.content, /files:notes\.txt/)
  assert.deepEqual(executed, [], '漂移后不得执行副作用')
  assert.equal(host.store.current().approval, 'none', '漂移后撤销旧的审批证据')
  assert.equal(host.store.current().fingerprint, undefined)
  assert.equal(session.planMode.phase, 'research')
  assert.equal(policy.getMode(), 'workspace_edit')

  const denied = await runToolTurn(session, events, 'WriteNotes')
  assert.equal(denied.isError, true)
  assert.match(denied.content, /fresh plan approval/)
  assert.deepEqual(executed, [])

  const reapproved = await session.exitPlanMode()
  assert.equal(reapproved.ok, true)
  assert.equal(approval.requests.length, 2)
  assert.notEqual(approval.requests[0].requestId, approval.requests[1].requestId)
  assert.notEqual(approval.requests[0].planVersion, approval.requests[1].planVersion)
  assert.equal(approval.requests[1].planText, '# 用户已修改的计划\n1. 修改 notes.txt')
  assert.ok(approval.requests[1].preview.some((line) => line.includes('files:notes.txt')))
  assert.equal(policy.getMode(), 'full_access')
  const resumed = await runToolTurn(session, events, 'WriteNotes')
  assert.equal(resumed.isError, false)
  assert.deepEqual(executed, ['WriteNotes'])
  session.dispose()
})

test('用户确认期间出现漂移不会批准新状态', async () => {
  const policy = makePolicy('full_access')
  const host = makePlanHost()
  host.store.create('实现 X', [{ title: '步骤一' }])
  const approval = makeGateway('manual')
  const { session } = makeSession({ policy, planMode: host, approval })
  assert.equal(session.enterPlanMode().ok, true)
  const pending = session.exitPlanMode()
  await waitFor(() => approval.requests.length === 1)
  host.state.snapshot = {
    ...host.state.snapshot,
    files: { ...BASE_FILES, 'notes.txt': 'during-review' }
  }
  approval.resolve()
  const first = await pending
  assert.equal(first.ok, false)
  assert.match(first.message, /漂移/)
  assert.equal(host.store.current().fingerprint, undefined)
  assert.equal(session.planMode.phase, 'research')

  const reopened = session.exitPlanMode()
  await waitFor(() => approval.requests.length === 2)
  approval.resolve()
  assert.equal((await reopened).ok, true)
  assert.equal(policy.getMode(), 'full_access')
  session.dispose()
})

test('单独的工具批准等待期间出现漂移仍阻止写入', async () => {
  const policy = makePolicy('workspace_edit')
  const host = makePlanHost()
  host.store.create('实现 X', [{ title: '步骤一' }])
  const executed = []
  const approval = makeGateway((request) => {
    if (request.name === 'WriteNotes') {
      host.state.snapshot = {
        ...host.state.snapshot,
        files: { ...BASE_FILES, 'notes.txt': 'while-tool-approval-waits' }
      }
    }
    return { outcome: 'allow', via: 'user' }
  })
  const { session, events } = makeSession({
    policy,
    planMode: host,
    script: toolTurn('WriteNotes'),
    tools: [makeTool('WriteNotes', 'write', executed)],
    approval
  })
  session.enterPlanMode()
  assert.equal((await session.exitPlanMode()).ok, true)
  const blocked = await runToolTurn(session, events, 'WriteNotes')
  assert.equal(approval.requests.length, 2)
  assert.equal(blocked.isError, true)
  assert.match(blocked.content, /files:notes\.txt/)
  assert.deepEqual(executed, [])
  assert.equal(session.planMode.phase, 'research')
  session.dispose()
})

test('T11-11 计划批准不自动授予 Git/命令特权', async () => {
  const policy = makePolicy('read_only')
  const host = makePlanHost()
  host.store.create('实现 X', [{ title: '步骤一' }])
  const executed = []
  const approval = makeGateway({ outcome: 'allow', via: 'user' })
  const { session, events } = makeSession({
    script: [...toolTurn('RunTests'), ...toolTurn('Bash')],
    tools: [makeTool('RunTests', 'execute', executed), makeTool('Bash', 'execute', executed)],
    policy,
    planMode: host,
    approval
  })
  session.enterPlanMode()
  const approved = await session.exitPlanMode()
  assert.equal(approved.ok, true)
  for (const name of ['RunTests', 'Bash']) {
    const result = await runToolTurn(session, events, name)
    assert.equal(result.isError, true)
    assert.match(result.content, /Denied/)
  }
  assert.deepEqual(executed, [], '计划批准不授予命令执行能力')
  assert.equal(approval.requests.length, 1, '仅计划审批；硬性拒绝不得再询问')
  assert.equal(approval.requests[0].name, 'ExitPlanMode')
  session.dispose()
})

test('T11-12 显式退出调研：恢复原权限档位并丢弃待批计划', async () => {
  const policy = makePolicy('read_only')
  const host = makePlanHost()
  host.store.create('实现 X', [{ title: '步骤一' }])
  const { session, events } = makeSession({
    policy,
    planMode: host,
    approval: makeGateway({ outcome: 'allow', via: 'user' })
  })
  session.enterPlanMode()
  const left = session.leavePlanMode()
  assert.equal(left.ok, true)
  assert.equal(policy.getMode(), 'read_only')
  assert.equal(session.planMode.active, false)
  assert.deepEqual(
    events.filter((event) => event.type === 'plan_mode_changed').at(-1),
    { type: 'plan_mode_changed', active: false, originalMode: 'read_only' }
  )
  assert.equal(session.leavePlanMode().ok, false)
  session.dispose()
})

test('T11-13 无计划宿主或未进入计划模式时退出是稳定错误', async () => {
  const policy = makePolicy('read_only')
  const { session } = makeSession({
    policy,
    approval: makeGateway({ outcome: 'allow', via: 'user' })
  })
  const result = await session.exitPlanMode()
  assert.equal(result.ok, false)
  assert.match(result.message, /宿主未提供计划模式集成/)
  assert.equal(session.enterPlanMode().ok, false)
  session.dispose()
})
