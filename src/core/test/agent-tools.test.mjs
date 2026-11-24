// SP007 T5 RED→GREEN：Agent/TaskOutput/TaskStop 工具＋dispatchTools 连续并发安全组并行
// （design §4.1，AC SA-03/05/08/09/10/15）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from '../../tui/dist/core/session.js'
import { createAgentRegistry } from '../../tui/dist/core/agent-runtime.js'
import { createAgentTools } from '../../tui/dist/core/agent-tools.js'
import { BUILT_IN_AGENTS } from '../../tui/dist/core/agent-definitions.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(predicate, timeoutMs = 8000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await sleep(10)
  }
  throw new Error('waitFor timeout')
}
const SNAPSHOT = { modelId: 'm', model: 'm', baseUrlHost: 'h', capabilities: { tools: true } }
function textEvents(text, usage = { inputTokens: 10, outputTokens: 5 }) {
  return [{ type: 'text_delta', text }, { type: 'message_completed', finishReason: 'stop', usage }]
}
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
        } finally { active-- }
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
    decide: () => ({ action: 'allow', reason: 'ok' }),
    remember: () => {},
    canRemember: () => true
  }
}
function toolStub(name, capability = 'read') {
  return { name, describe: () => name, capability: () => capability, execute: async () => name + ' result' }
}
function ctx(overrides = {}) {
  return { signal: new AbortController().signal, callId: 'c1', turnId: 't1', emit: () => {}, approved: true, ...overrides }
}
function makeRegistry(overrides = {}) {
  const parentSession = overrides.parentSession ?? new Session({
    provider: makeProvider([textEvents('parent ok')]),
    approval: { request: async () => ({ outcome: 'allow', via: 'user' }) },
    resolveSnapshot: () => SNAPSHOT,
    permissionPolicy: fakePolicy('full_access'),
    queueAutostartMs: 100000
  })
  return createAgentRegistry({
    parentSession,
    tools: overrides.tools ?? [toolStub('Read'), toolStub('Write', 'write'), toolStub('Bash', 'execute')],
    provider: overrides.provider ?? makeProvider([textEvents('child done')]),
    resolveSnapshot: () => SNAPSHOT,
    approval: { request: async () => ({ outcome: 'allow', via: 'user' }) },
    policy: fakePolicy('full_access'),
    createChildPolicy: (mode) => fakePolicy(mode),
    environment: 'cwd: /test',
    ...overrides.registry
  })
}
const DEFS = BUILT_IN_AGENTS

test('createAgentTools 返回 Agent/TaskOutput/TaskStop，Agent 并发安全且只读', () => {
  const registry = makeRegistry()
  const tools = createAgentTools(registry, DEFS)
  assert.deepEqual(tools.map((t) => t.name), ['Agent', 'TaskOutput', 'TaskStop'])
  const agent = tools[0]
  assert.equal(agent.concurrencySafe, true)
  assert.equal(agent.capability({}), 'read')
  assert.equal(agent.requiresApproval?.({}) ?? false, false)
  registry.dispose()
})

test('Agent 入参 schema：description/prompt 必填', () => {
  const registry = makeRegistry()
  const [agent] = createAgentTools(registry, DEFS)
  const schema = agent.parameters
  assert.equal(schema.type, 'object')
  assert.deepEqual(schema.required, ['description', 'prompt'])
  assert.ok(schema.properties.subagent_type)
  assert.ok(schema.properties.run_in_background)
  registry.dispose()
})

test('Agent.describe 含类型与描述', () => {
  const registry = makeRegistry()
  const [agent] = createAgentTools(registry, DEFS)
  assert.match(agent.describe({ subagent_type: 'Explore', description: 'scan code' }), /Explore/)
  assert.match(agent.describe({ subagent_type: 'Explore', description: 'scan code' }), /scan code/)
  registry.dispose()
})

test('未知 subagent_type 报错并列出可用类型', async () => {
  const registry = makeRegistry()
  const [agent] = createAgentTools(registry, DEFS)
  await assert.rejects(
    () => agent.execute({ description: 'd', prompt: 'p', subagent_type: 'nope' }, ctx()),
    (error) => /nope/.test(error.message) && /general-purpose/.test(error.message)
  )
  registry.dispose()
})

test('省略 subagent_type → general-purpose；sync 返回最终文本＋usage 尾注', async () => {
  const registry = makeRegistry()
  const [agent] = createAgentTools(registry, DEFS)
  const result = await agent.execute({ description: 'd', prompt: 'do it' }, ctx())
  assert.match(result, /child done/)
  assert.match(result, /<usage>/)
  assert.match(result, /total_tokens/)
  registry.dispose()
})

test('run_in_background 即返 async_launched', async () => {
  const registry = makeRegistry({ provider: makeProvider([{ __hang: true }]) })
  const [agent] = createAgentTools(registry, DEFS)
  const result = await agent.execute({ description: 'd', prompt: 'p', run_in_background: true }, ctx())
  assert.match(result, /async_launched/)
  const records = registry.list()
  assert.equal(records.length, 1)
  assert.equal(records[0].background, true)
  registry.dispose()
})

test('子代理失败 → 抛错带 AGENT_FAILED 稳定码', async () => {
  const registry = makeRegistry({ provider: makeProvider([{ type: 'failed', error: { class: 'network', message: 'boom', retryable: true } }]) })
  const [agent] = createAgentTools(registry, DEFS)
  await assert.rejects(
    () => agent.execute({ description: 'd', prompt: 'p' }, ctx()),
    (error) => error.code === 'AGENT_FAILED' && /boom/.test(error.message)
  )
  registry.dispose()
})

test('TaskOutput：block=false 运行中返 running；未知 id 报错', async () => {
  const registry = makeRegistry({ provider: makeProvider([{ __hang: true }]) })
  const [agent, taskOutput] = createAgentTools(registry, DEFS)
  await agent.execute({ description: 'd', prompt: 'p', run_in_background: true }, ctx())
  const agentId = registry.list()[0].agentId
  const running = await taskOutput.execute({ agent_id: agentId, block: false }, ctx())
  assert.match(running, /running/)
  await assert.rejects(() => taskOutput.execute({ agent_id: 'missing' }, ctx()), /missing/)
  registry.dispose()
})

test('TaskOutput：block=true 超时返回 running（timeout 上限 600000）', async () => {
  const registry = makeRegistry({ provider: makeProvider([{ __hang: true }]) })
  const [agent, taskOutput] = createAgentTools(registry, DEFS)
  assert.equal(taskOutput.parameters.properties.timeout.maximum, 600000)
  await agent.execute({ description: 'd', prompt: 'p', run_in_background: true }, ctx())
  const agentId = registry.list()[0].agentId
  const started = Date.now()
  const result = await taskOutput.execute({ agent_id: agentId, block: true, timeout: 60 }, ctx())
  assert.match(result, /running/)
  assert.ok(Date.now() - started < 2000)
  registry.dispose()
})

test('TaskStop：停止并抑制通知；未知 id 报错', async () => {
  const registry = makeRegistry({ provider: makeProvider([{ __hang: true }]) })
  const [agent, , taskStop] = createAgentTools(registry, DEFS)
  await agent.execute({ description: 'd', prompt: 'p', run_in_background: true }, ctx())
  const agentId = registry.list()[0].agentId
  const result = await taskStop.execute({ agent_id: agentId }, ctx())
  assert.match(result, /Stopped|stopped/)
  assert.equal(registry.get(agentId).stopped, true)
  await assert.rejects(() => taskStop.execute({ agent_id: 'missing' }, ctx()), /missing/)
  registry.dispose()
})

// ---- dispatchTools 并行分组（完整会话链路）----
function twoAgentCalls() {
  return [
    { type: 'tool_call_delta', index: 0, callId: 'call-A', nameDelta: 'Agent', argsDelta: JSON.stringify({ description: 'task a', prompt: 'TASK-A' }) },
    { type: 'tool_call_delta', index: 1, callId: 'call-B', nameDelta: 'Agent', argsDelta: JSON.stringify({ description: 'task b', prompt: 'TASK-B' }) },
    { type: 'message_completed', finishReason: 'tool_calls', usage: { inputTokens: 10, outputTokens: 5 } }
  ]
}
function wireSession(parentProvider, childProvider, extraTools = []) {
  const tools = [...extraTools]
  const session = new Session({
    provider: parentProvider,
    tools,
    approval: { request: async () => ({ outcome: 'allow', via: 'user' }) },
    resolveSnapshot: () => SNAPSHOT,
    permissionPolicy: fakePolicy('full_access'),
    queueAutostartMs: 100000
  })
  const registry = makeRegistry({ parentSession: session, provider: childProvider, tools })
  tools.push(...createAgentTools(registry, DEFS))
  return { session, registry }
}
function childByPrompt() {
  return makeProvider([(request) => {
    const blob = JSON.stringify(request.messages)
    const isA = blob.includes('TASK-A')
    return [{ __delay: isA ? 80 : 10 }, ...textEvents(isA ? 'answer-A' : 'answer-B')]
  }])
}

test('连续两个 Agent 并行执行，结果按调用原序回灌', async () => {
  const childProvider = childByPrompt()
  const { session, registry } = wireSession(makeProvider([twoAgentCalls(), textEvents('all done')]), childProvider)
  const results = []
  session.on((e) => { if (e.type === 'tool_result') results.push({ callId: e.callId, content: e.content }) })
  session.submit('go')
  await waitFor(() => !session.isBusy)
  assert.ok(childProvider.maxActive >= 2, 'children should run concurrently, maxActive=' + childProvider.maxActive)
  assert.deepEqual(results.map((r) => r.callId), ['call-A', 'call-B'])
  assert.match(results[0].content, /answer-A/)
  assert.match(results[1].content, /answer-B/)
  registry.dispose()
  session.dispose()
})

test('AC-SUBAGENT-02 失败的并行子代理回灌结构化诊断，主回合与相邻子代理继续', async () => {
  const call = (nameDelta, callId, args) => [
    { type: 'tool_call_delta', index: 0, callId, nameDelta, argsDelta: JSON.stringify(args) },
    { type: 'message_completed', finishReason: 'tool_calls' }
  ]
  const child = makeProvider([(request) => {
    const messages = JSON.stringify(request.messages)
    if (messages.includes('TASK-B')) return textEvents('other agent done')
    if (!messages.includes('background facts')) return call('Read', 'read', { path: 'notes.md' })
    const failed = request.messages.filter((message) => message.role === 'tool').length
    return call('WebFetch', 'fetch-' + failed, { url: 'https://example.test/missing' })
  }])
  const fetch = {
    ...toolStub('WebFetch', 'network'),
    execute: async () => { throw Object.assign(new Error('HTTP 503'), { code: 'BUDINGX_WEB_HTTP_ERROR' }) }
  }
  const sessionProvider = makeProvider([twoAgentCalls(), textEvents('parent recovered')])
  const { session, registry } = wireSession(sessionProvider, child, [
    { ...toolStub('Read'), execute: async () => 'background facts' },
    fetch
  ])
  try {
    const results = []
    let outcome
    session.on((event) => {
      if (event.type === 'tool_result') results.push(event)
      if (event.type === 'turn_finalized') outcome = event.outcome
    })
    session.submit('start both agents')
    await waitFor(() => !session.isBusy)
    assert.equal(outcome, 'completed')
    assert.equal(results[0].isError, true)
    const failure = JSON.parse(results[0].content.split('\n')[1])
    assert.equal(failure.code, 'BUDINGX_CORE_010')
    assert.equal(failure.failedTool.name, 'WebFetch')
    assert.equal(failure.failedTool.errorCode, 'BUDINGX_WEB_HTTP_ERROR')
    assert.match(JSON.stringify(failure.failedTool), /example\.test\/missing/)
    assert.equal(failure.completedTools[0].name, 'Read')
    assert.match(failure.completedTools[0].output, /background facts/)
    assert.match(failure.suggestion, /different/)
    assert.equal(results[1].isError, false)
    assert.match(results[1].content, /other agent done/)
  } finally {
    registry.dispose()
    session.dispose()
  }
})

test('AC-SUBAGENT-02 父 Agent 重复派发相同失败任务仍会熔断', async () => {
  let id = 0
  const parent = makeProvider([() => [
    {
      type: 'tool_call_delta', index: 0, callId: 'retry-' + ++id, nameDelta: 'Agent',
      argsDelta: '{"description":"repeat","prompt":"same failing task"}'
    },
    { type: 'message_completed', finishReason: 'tool_calls' }
  ]])
  const child = makeProvider([{
    type: 'failed', error: { class: 'unknown', code: 'FIXTURE_ERROR', message: 'cannot continue', retryable: false }
  }])
  const { session, registry } = wireSession(parent, child)
  try {
    const finalized = new Promise((resolve) => session.on((event) => {
      if (event.type === 'turn_finalized') resolve(event)
    }))
    session.submit('repeat a failing task')
    const event = await finalized
    assert.equal(event.outcome, 'error')
    assert.equal(event.error.code, 'BUDINGX_CORE_010')
    assert.equal(event.error.toolFailure.code, 'AGENT_FAILED')
    assert.equal(id, 3)
  } finally {
    registry.dispose()
    session.dispose()
  }
})

test('非并发安全工具隔断分组：Agent 之间夹 Read 仍顺序', async () => {
  const childProvider = childByPrompt()
  const calls = [
    { type: 'tool_call_delta', index: 0, callId: 'call-A', nameDelta: 'Agent', argsDelta: JSON.stringify({ description: 'a', prompt: 'TASK-A' }) },
    { type: 'tool_call_delta', index: 1, callId: 'call-R', nameDelta: 'Read', argsDelta: '{}' },
    { type: 'tool_call_delta', index: 2, callId: 'call-B', nameDelta: 'Agent', argsDelta: JSON.stringify({ description: 'b', prompt: 'TASK-B' }) },
    { type: 'message_completed', finishReason: 'tool_calls', usage: { inputTokens: 10, outputTokens: 5 } }
  ]
  const { session, registry } = wireSession(makeProvider([calls, textEvents('done')]), childProvider, [toolStub('Read')])
  session.submit('go')
  await waitFor(() => !session.isBusy)
  assert.equal(childProvider.maxActive, 1, 'agents must not overlap when separated by a sequential tool')
  registry.dispose()
  session.dispose()
})

test('并行组内父取消 → 整组取消', async () => {
  const { session, registry } = wireSession(makeProvider([twoAgentCalls(), textEvents('done')]), makeProvider([{ __hang: true }]))
  let outcome
  session.on((e) => { if (e.type === 'turn_finalized') outcome = e.outcome })
  session.submit('go')
  await waitFor(() => session.state === 'tool_running')
  session.interrupt()
  await waitFor(() => !session.isBusy)
  assert.equal(outcome, 'cancelled')
  registry.dispose()
  session.dispose()
})
