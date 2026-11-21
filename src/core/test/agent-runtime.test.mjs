// SP007 T4 RED→GREEN：子代理运行时＋会话扩展（design §4.1/§4.2，AC SA-03…10/14/16、RD-16）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from '../../tui/dist/core/session.js'
import {
  createAgentRegistry,
  MAX_CONCURRENT_AGENTS,
  SUBAGENT_MAX_TURNS,
  SUBAGENT_TOKEN_LIMIT
} from '../../tui/dist/core/agent-runtime.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await sleep(10)
  }
  throw new Error('waitFor timeout')
}

const SNAPSHOT = { modelId: 'test-model', model: 'test-model', baseUrlHost: 'example.test', capabilities: { tools: true } }

function textEvents(text, usage = { inputTokens: 10, outputTokens: 5 }) {
  return [
    { type: 'text_delta', text },
    { type: 'message_completed', finishReason: 'stop', usage }
  ]
}

function toolCallEvents(callId, name, args = '{}', usage = { inputTokens: 10, outputTokens: 5 }) {
  return [
    { type: 'tool_call_delta', index: 0, callId, nameDelta: name, argsDelta: args },
    { type: 'message_completed', finishReason: 'tool_calls', usage }
  ]
}

// scripts：事件数组或 (request)=>事件数组；{__delay} 延时、{__hang} 挂起直到 abort。
function makeProvider(scripts) {
  const requests = []
  let call = 0
  let active = 0
  let maxActive = 0
  const provider = {
    requests,
    get maxActive() { return maxActive },
    stream(request) {
      requests.push(request)
      // scripts 可以是「脚本数组」或「单脚本的事件平铺数组」（首元素非数组/函数即平铺）。
      const scriptList = Array.isArray(scripts[0]) || typeof scripts[0] === 'function' ? scripts : [scripts]
      const script = scriptList[Math.min(call, scriptList.length - 1)]
      call++
      const events = typeof script === 'function' ? script(request) : script
      return (async function* () {
        active++
        maxActive = Math.max(maxActive, active)
        try {
          for (const event of events) {
            if (event.__delay) {
              await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, event.__delay)
                request.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')) }, { once: true })
              })
              continue
            }
            if (event.__hang) {
              await new Promise((_, reject) => {
                request.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
              })
              continue
            }
            yield event
          }
        } finally {
          active--
        }
      })()
    }
  }
  return provider
}

function fakePolicy(mode) {
  let current = mode
  return {
    getMode: () => current,
    setMode: (next) => { current = next },
    decide: () => ({ action: 'allow', reason: 'test allow' }),
    remember: () => {},
    canRemember: () => true
  }
}

function memoryTranscript(agentId) {
  const records = []
  return {
    records,
    outputFile: `/mem/subagents/agent-${agentId}.jsonl`,
    append(record) { records.push(record) },
    read: () => ({ records, corruptLines: 0, unsupported: false }),
    directory: () => '/mem/subagents'
  }
}

function toolStub(name, capability = 'read') {
  return {
    name,
    describe: () => name,
    capability: () => capability,
    execute: async () => `${name} result`
  }
}

const PARENT_TOOLS = [
  toolStub('Read'), toolStub('Write', 'write'), toolStub('Bash', 'execute'),
  toolStub('Agent'), toolStub('TaskOutput'), toolStub('TaskStop'),
  toolStub('AskUserQuestion'), toolStub('EnterPlanMode'), toolStub('ExitPlanMode'),
  toolStub('mcp__srv__tool')
]

function makeParent(provider) {
  return new Session({
    provider: provider ?? makeProvider([textEvents('parent ok')]),
    approval: { request: async () => ({ outcome: 'allow', via: 'user' }) },
    resolveSnapshot: () => SNAPSHOT,
    permissionPolicy: fakePolicy('full_access'),
    queueAutostartMs: 100000
  })
}

function def(overrides = {}) {
  return { name: 'test-agent', description: 'test agent', source: 'user', body: 'You are a test subagent.', ...overrides }
}

function makeRegistry(overrides = {}) {
  const parentSession = overrides.parentSession ?? makeParent()
  const childProvider = overrides.provider ?? makeProvider([textEvents('child done')])
  const approvalLog = []
  let activeApprovals = 0
  let maxActiveApprovals = 0
  const parentApproval = {
    async request(request) {
      approvalLog.push(request)
      activeApprovals++
      maxActiveApprovals = Math.max(maxActiveApprovals, activeApprovals)
      await sleep(20)
      activeApprovals--
      return { outcome: 'allow', via: 'user' }
    }
  }
  const childPolicies = []
  const transcripts = new Map()
  const registry = createAgentRegistry({
    parentSession,
    tools: overrides.tools ?? PARENT_TOOLS,
    provider: childProvider,
    resolveSnapshot: () => SNAPSHOT,
    approval: parentApproval,
    policy: fakePolicy(overrides.parentMode ?? 'full_access'),
    createChildPolicy: (mode) => {
      const policy = fakePolicy(mode)
      policy.decide = (request) => request.tool === 'Write'
        ? { action: 'ask', reason: 'approval required' }
        : { action: 'allow', reason: 'ok' }
      childPolicies.push({ mode, policy })
      return policy
    },
    createTranscript: (agentId) => {
      const transcript = memoryTranscript(agentId)
      transcripts.set(agentId, transcript)
      return transcript
    },
    environment: 'cwd: /test',
    ...overrides.registry
  })
  return {
    registry, parentSession, childProvider, approvalLog, childPolicies, transcripts,
    maxActiveApprovals: () => maxActiveApprovals
  }
}

function spawnOptions(overrides = {}) {
  return {
    definition: def(),
    prompt: 'do the task',
    description: 'test task',
    callId: 'call-1',
    turnId: 'turn-1',
    ...overrides
  }
}

const terminal = (record) => record && ['completed', 'failed', 'cancelled'].includes(record.state)

test('常量与参考预算一致', () => {
  assert.equal(MAX_CONCURRENT_AGENTS, 10)
  assert.equal(SUBAGENT_MAX_TURNS, 30)
  assert.equal(SUBAGENT_TOKEN_LIMIT, 100000)
})

test('独立上下文：子请求不含父历史，系统提示含定义正文与环境', async () => {
  const { registry, parentSession, childProvider } = makeRegistry()
  parentSession.restoreHistory([
    { id: 'p1', role: 'user', blocks: [{ type: 'text', text: 'PARENT_SECRET_HISTORY' }] }
  ])
  const result = await registry.spawn(spawnOptions())
  assert.equal(result.status, 'completed')
  const request = childProvider.requests[0]
  assert.ok(!JSON.stringify(request.messages).includes('PARENT_SECRET_HISTORY'))
  const system = request.messages.find((message) => message.role === 'system')
  assert.ok(system.content.includes('You are a test subagent.'))
  assert.ok(system.content.includes('cwd: /test'))
  const user = request.messages.find((message) => message.role === 'user')
  assert.ok(JSON.stringify(user.content).includes('do the task'))
})

test('initialPrompt 前置首条用户消息', async () => {
  const { registry, childProvider } = makeRegistry()
  await registry.spawn(spawnOptions({ definition: def({ initialPrompt: 'INITIAL CONTEXT' }) }))
  const user = childProvider.requests[0].messages.find((message) => message.role === 'user')
  const text = JSON.stringify(user.content)
  assert.ok(text.includes('INITIAL CONTEXT'))
  assert.ok(text.indexOf('INITIAL CONTEXT') < text.indexOf('do the task'))
})

test('工具裁剪：恒禁表、白名单、disallowedTools', async () => {
  const namesOf = (request) => (request.tools ?? []).map((tool) => tool.name)
  const forbidden = ['Agent', 'TaskOutput', 'TaskStop', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode']
  {
    const { registry, childProvider } = makeRegistry()
    await registry.spawn(spawnOptions())
    const names = namesOf(childProvider.requests[0])
    for (const name of forbidden) assert.ok(!names.includes(name), `${name} 应被裁剪`)
    assert.ok(names.includes('Read') && names.includes('Write') && names.includes('Bash') && names.includes('mcp__srv__tool'))
  }
  {
    const { registry, childProvider } = makeRegistry()
    await registry.spawn(spawnOptions({ definition: def({ tools: ['Read', 'Write'] }) }))
    assert.deepEqual(namesOf(childProvider.requests[0]).sort(), ['Read', 'Write'])
  }
  {
    const { registry, childProvider } = makeRegistry()
    await registry.spawn(spawnOptions({ definition: def({ disallowedTools: ['Bash'] }) }))
    assert.ok(!namesOf(childProvider.requests[0]).includes('Bash'))
  }
})

test('后台代理额外白名单＋mcp 恒许', async () => {
  const { registry, childProvider } = makeRegistry()
  const result = await registry.spawn(spawnOptions({ runInBackground: true }))
  assert.equal(result.status, 'async_launched')
  await waitFor(() => terminal(registry.get(result.agentId)))
  const names = (childProvider.requests[0].tools ?? []).map((tool) => tool.name)
  assert.ok(names.includes('Read') && names.includes('Write') && names.includes('Bash') && names.includes('mcp__srv__tool'))
  assert.ok(!names.includes('Agent') && !names.includes('AskUserQuestion'))
})

test('权限上限 min(父, def)，子策略独立实例', async () => {
  {
    const { registry, childPolicies } = makeRegistry({ parentMode: 'full_access' })
    await registry.spawn(spawnOptions({ definition: def({ permissionMode: 'workspace_edit' }) }))
    assert.equal(childPolicies[0].mode, 'workspace_edit')
  }
  {
    const { registry, childPolicies } = makeRegistry({ parentMode: 'read_only' })
    await registry.spawn(spawnOptions({ definition: def({ permissionMode: 'full_access' }) }))
    assert.equal(childPolicies[0].mode, 'read_only')
  }
  {
    const { registry, childPolicies } = makeRegistry({ parentMode: 'workspace_edit' })
    await registry.spawn(spawnOptions())
    assert.equal(childPolicies[0].mode, 'workspace_edit')
  }
})

test('sync 审批转发父网关且串行（同一时刻最多一个）', async () => {
  const provider = makeProvider([
    (request) => request.messages.some((message) => message.role === 'tool')
      ? textEvents('done')
      : toolCallEvents('w1', 'Write')
  ])
  const { registry, approvalLog, maxActiveApprovals } = makeRegistry({ provider })
  const [a, b] = await Promise.all([
    registry.spawn(spawnOptions({ callId: 'call-a' })),
    registry.spawn(spawnOptions({ callId: 'call-b', description: 'second task' }))
  ])
  assert.equal(a.status, 'completed')
  assert.equal(b.status, 'completed')
  assert.equal(approvalLog.length, 2)
  assert.equal(maxActiveApprovals(), 1)
})

test('background 自动拒绝审批，不打扰父网关', async () => {
  const provider = makeProvider([
    (request) => request.messages.some((message) => message.role === 'tool')
      ? textEvents('done after deny')
      : toolCallEvents('w1', 'Write')
  ])
  const { registry, approvalLog, transcripts } = makeRegistry({ provider })
  const result = await registry.spawn(spawnOptions({ runInBackground: true }))
  await waitFor(() => terminal(registry.get(result.agentId)))
  assert.equal(approvalLog.length, 0)
  assert.equal(registry.get(result.agentId).state, 'completed')
  const transcript = transcripts.get(result.agentId)
  const toolRecord = transcript.records.find((record) =>
    record.type === 'message' && record.role === 'tool' &&
    record.blocks.some((block) => block.type === 'tool_result' && /Denied/i.test(block.content)))
  assert.ok(toolRecord, '后台审批应被自动拒绝并回灌')
})

test('maxTurns 耗尽 → max_turns 结果可见', async () => {
  const provider = makeProvider([toolCallEvents('r1', 'Read')])
  const { registry } = makeRegistry({ provider })
  const result = await registry.spawn(spawnOptions({ definition: def({ maxTurns: 1 }) }))
  assert.equal(result.status, 'max_turns')
  assert.ok(result.toolUses >= 1)
  assert.equal(registry.get(result.agentId).state, 'completed')
})

test('token 预算终止 → AGENT_BUDGET', async () => {
  const provider = makeProvider([
    (request) => request.messages.some((message) => message.role === 'tool')
      ? textEvents('done')
      : toolCallEvents('r1', 'Read', '{}', { inputTokens: 60, outputTokens: 10 })
  ])
  const { registry } = makeRegistry({ provider, registry: { tokenLimit: 50 } })
  const result = await registry.spawn(spawnOptions())
  assert.equal(result.status, 'budget')
  assert.equal(result.code, 'AGENT_BUDGET')
})

test('父取消中止 sync 子；background 子存活', async () => {
  {
    const provider = makeProvider([{ __delay: 300 }, ...textEvents('done')])
    const { registry } = makeRegistry({ provider })
    const controller = new AbortController()
    const pending = registry.spawn(spawnOptions({ parentSignal: controller.signal }))
    await sleep(50)
    controller.abort()
    const result = await pending
    assert.equal(result.status, 'cancelled')
    assert.equal(result.code, 'AGENT_CANCELLED')
  }
  {
    const provider = makeProvider([{ __delay: 100 }, ...textEvents('background survives')])
    const { registry, parentSession } = makeRegistry({ provider })
    const controller = new AbortController()
    const result = await registry.spawn(spawnOptions({ runInBackground: true, parentSignal: controller.signal }))
    controller.abort()
    await waitFor(() => terminal(registry.get(result.agentId)))
    assert.equal(registry.get(result.agentId).state, 'completed')
    assert.ok(parentSession.queuedInputs.length >= 1)
  }
})

test('stop 抑制通知', async () => {
  const provider = makeProvider([{ __delay: 300 }, ...textEvents('done')])
  const { registry, parentSession } = makeRegistry({ provider })
  const result = await registry.spawn(spawnOptions({ runInBackground: true }))
  const stopped = registry.stop(result.agentId)
  assert.equal(stopped.ok, true)
  await waitFor(() => terminal(registry.get(result.agentId)))
  assert.equal(registry.get(result.agentId).state, 'cancelled')
  assert.equal(registry.get(result.agentId).notified, false)
  await sleep(50)
  assert.equal(parentSession.queuedInputs.length, 0)
})

test('结果＝最后 assistant 文本＋usage 尾注；超限截断', async () => {
  {
    const provider = makeProvider([
      (request) => request.messages.some((message) => message.role === 'tool')
        ? textEvents('FINAL ANSWER')
        : toolCallEvents('r1', 'Read')
    ])
    const { registry } = makeRegistry({ provider })
    const result = await registry.spawn(spawnOptions())
    assert.ok(result.text.includes('FINAL ANSWER'))
    assert.ok(result.text.includes('<usage>total_tokens: '))
    assert.ok(result.text.includes('tool_uses: 1'))
    assert.ok(/duration_ms: \d+/.test(result.text))
  }
  {
    const provider = makeProvider([textEvents('x'.repeat(500))])
    const { registry } = makeRegistry({ provider, registry: { resultCharLimit: 100 } })
    const result = await registry.spawn(spawnOptions())
    assert.ok(result.text.includes('[truncated'))
    assert.ok(result.text.indexOf('x'.repeat(101)) === -1)
  }
})

test('provider 失败 → AGENT_FAILED 稳定码', async () => {
  const provider = makeProvider([
    [{ type: 'failed', error: { class: 'network', code: 'NET', message: 'boom failed', retryable: false } }]
  ])
  const { registry } = makeRegistry({ provider })
  const result = await registry.spawn(spawnOptions())
  assert.equal(result.status, 'failed')
  assert.equal(result.code, 'AGENT_FAILED')
  assert.ok(result.text.includes('boom failed'))
})

test('sidechain 转录记录消息（含 model）与回合结局', async () => {
  const { registry, transcripts } = makeRegistry()
  const result = await registry.spawn(spawnOptions())
  const transcript = transcripts.get(result.agentId)
  assert.ok(transcript.records.some((record) => record.type === 'message' && record.model === 'test-model'))
  assert.ok(transcript.records.some((record) => record.type === 'turn' && record.outcome === 'completed'))
})

test('后台终态 → task-notification 注入父队列且防重', async () => {
  const { registry, parentSession } = makeRegistry()
  const result = await registry.spawn(spawnOptions({ runInBackground: true }))
  await waitFor(() => terminal(registry.get(result.agentId)))
  await waitFor(() => parentSession.queuedInputs.length > 0)
  assert.equal(parentSession.queuedInputs.length, 1)
  const text = parentSession.queuedInputs[0].text
  assert.ok(text.includes('<task-notification>'))
  assert.ok(text.includes('<status>completed</status>'))
  assert.ok(text.includes(result.agentId))
  assert.ok(text.includes('child done'))
  await sleep(60)
  assert.equal(parentSession.queuedInputs.length, 1)
})

test('background(callId) 即返 async_launched，子继续跑并通知', async () => {
  const provider = makeProvider([{ __delay: 150 }, ...textEvents('late answer')])
  const { registry, parentSession } = makeRegistry({ provider })
  const pending = registry.spawn(spawnOptions({ callId: 'call-b' }))
  await sleep(40)
  assert.equal(registry.background('call-b'), true)
  const result = await pending
  assert.equal(result.status, 'async_launched')
  const record = registry.get(result.agentId)
  assert.equal(record.background, true)
  await waitFor(() => terminal(record))
  assert.equal(record.state, 'completed')
  await waitFor(() => parentSession.queuedInputs.length > 0)
  assert.ok(parentSession.queuedInputs[0].text.includes('late answer'))
})

test('并发闸：超过上限排队等待', async () => {
  const provider = makeProvider([{ __delay: 80 }, ...textEvents('done')])
  const { registry } = makeRegistry({ provider, registry: { maxConcurrent: 2 } })
  const results = await Promise.all([
    registry.spawn(spawnOptions({ callId: 'c1' })),
    registry.spawn(spawnOptions({ callId: 'c2' })),
    registry.spawn(spawnOptions({ callId: 'c3' }))
  ])
  assert.ok(results.every((result) => result.status === 'completed'))
  assert.ok(provider.maxActive <= 2, `并发应≤2，实际 ${provider.maxActive}`)
})

test('taskOutput：阻塞取最终答案；未知 id 报错；超时返回 running', async () => {
  const provider = makeProvider([{ __delay: 120 }, ...textEvents('output answer')])
  const { registry } = makeRegistry({ provider })
  await assert.rejects(() => registry.taskOutput('no-such-agent'), /no-such-agent/)
  const result = await registry.spawn(spawnOptions({ runInBackground: true }))
  const early = await registry.taskOutput(result.agentId, { block: false })
  assert.equal(early.status, 'running')
  const timed = await registry.taskOutput(result.agentId, { block: true, timeoutMs: 20 })
  assert.equal(timed.status, 'running')
  const final = await registry.taskOutput(result.agentId, { block: true, timeoutMs: 5000 })
  assert.equal(final.status, 'completed')
  assert.ok(final.text.includes('output answer'))
})

test('agent_* 事件经父会话发布', async () => {
  const { registry, parentSession } = makeRegistry()
  const events = []
  parentSession.on((event) => events.push(event))
  const result = await registry.spawn(spawnOptions())
  const started = events.find((event) => event.type === 'agent_started')
  const finished = events.find((event) => event.type === 'agent_finished')
  assert.ok(started)
  assert.equal(started.agentType, 'test-agent')
  assert.equal(started.callId, 'call-1')
  assert.ok(finished)
  assert.equal(finished.agentId, result.agentId)
  assert.equal(finished.outcome, 'completed')
  assert.equal(finished.tokens, 15)
})

test('Session.enqueueNotification：队列标记＋空闲自动开回合＋转录带模型', async () => {
  const provider = makeProvider([textEvents('ok')])
  const transcript = memoryTranscript('parent')
  const session = new Session({
    provider,
    approval: { request: async () => ({ outcome: 'allow', via: 'user' }) },
    resolveSnapshot: () => SNAPSHOT,
    transcript,
    queueAutostartMs: 5
  })
  const events = []
  session.on((event) => events.push(event))
  session.enqueueNotification('<task-notification><status>completed</status></task-notification>', '子代理已完成')
  assert.equal(session.queuedInputs.length, 1)
  assert.equal(session.queuedInputs[0].notification, true)
  const queued = events.find((event) => event.type === 'input_queued')
  assert.equal(queued.notification, true)
  assert.ok(events.some((event) => event.type === 'notice' && event.code === 'agent_notification'))
  await waitFor(() => provider.requests.length > 0)
  assert.ok(JSON.stringify(provider.requests[0].messages).includes('task-notification'))
  await waitFor(() => !session.isBusy)
  assert.ok(transcript.records.some((record) => record.type === 'message' && record.role === 'assistant' && record.model === 'test-model'))
  session.dispose()
})

test('Session.performance：请求计时 p50/p95 与首 token', async () => {
  const provider = makeProvider([{ __delay: 10 }, ...textEvents('ok')])
  const session = new Session({
    provider,
    approval: { request: async () => ({ outcome: 'allow', via: 'user' }) },
    resolveSnapshot: () => SNAPSHOT,
    queueAutostartMs: 100000
  })
  for (let index = 0; index < 3; index++) {
    session.submit(`question ${index}`)
    await waitFor(() => !session.isBusy)
  }
  const performance = session.performance
  assert.equal(performance.requests, 3)
  assert.ok(performance.requestMs.p50 >= 10)
  assert.ok(performance.requestMs.p95 >= performance.requestMs.p50)
  assert.ok(performance.firstTokenMs)
  assert.ok(performance.firstTokenMs.last >= 10)
  assert.ok(performance.memoryRssBytes > 0)
  assert.equal(performance.inputTokens, 30)
  session.dispose()
})
