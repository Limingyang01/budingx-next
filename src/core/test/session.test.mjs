import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Session } from '../../tui/dist/core/session.js'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: true }
}

function scriptProvider(script) {
  const calls = []
  return {
    calls,
    provider: {
      async *stream(request) {
        calls.push(request)
        const events = script.shift() ?? [
          { type: 'message_completed', finishReason: 'stop' }
        ]
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
}

function blockingProvider() {
  return {
    async *stream(request) {
      await new Promise((resolve) => {
        if (request.signal?.aborted) resolve()
        else request.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      yield {
        type: 'failed',
        error: {
          class: 'aborted',
          code: 'BUDINGX_PROVIDER_007',
          message: 'Request cancelled by the user',
          retryable: false
        }
      }
    }
  }
}

function approvalGateway(decision) {
  const requests = []
  return {
    requests,
    gateway: {
      async request(request) {
        requests.push(request)
        return decision
      }
    }
  }
}

function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function tick(ms = 5) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Provider that holds the first call open so the test can interact with a
 * running turn (queueing, cancelling) instead of racing it.
 */
function gatedProvider(script, gate, calls = []) {
  return {
    calls,
    provider: {
      async *stream(request) {
        calls.push(request)
        if (calls.length === 1) {
          await gate.promise
        }
        const events = script.shift() ?? [
          { type: 'message_completed', finishReason: 'stop' }
        ]
        for (const event of events) yield event
      }
    }
  }
}

function waitFor(session, predicate) {
  return new Promise((resolve) => {
    const off = session.on((event) => {
      if (predicate(event)) {
        off()
        resolve(event)
      }
    })
  })
}

function collect(session) {
  const events = []
  session.on((event) => events.push(event))
  return events
}

test('一次完整回合的事件顺序符合契约且终态至多一次', async () => {
  const { provider } = scriptProvider([
    [
      { type: 'text_delta', text: '你好' },
      { type: 'message_completed', finishReason: 'stop' }
    ]
  ])
  const session = new Session({
    provider,
    approval: approvalGateway({ outcome: 'allow', via: 'user' }).gateway,
    resolveSnapshot: () => SNAPSHOT
  })
  const events = collect(session)
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('hi')
  const final = await finalized

  assert.equal(final.outcome, 'completed')
  assert.equal(
    events.filter((event) => event.type === 'turn_finalized').length,
    1
  )
  const types = events.map((event) => event.type)
  assert.equal(types[0], 'turn_started')
  assert.ok(types.indexOf('text_delta') < types.indexOf('message_completed'))
  assert.ok(types.indexOf('message_completed') < types.indexOf('turn_finalized'))
  assert.deepEqual(types.slice(-2), ['status', 'turn_finalized'])
  assert.equal(events.at(-2).state, 'idle')
})

test('事件形状可 JSON 序列化且与 UI 类型无关', async () => {
  const { provider } = scriptProvider([
    [
      { type: 'text_delta', text: '你好' },
      { type: 'message_completed', finishReason: 'stop' }
    ]
  ])
  const session = new Session({
    provider,
    approval: approvalGateway({ outcome: 'allow', via: 'user' }).gateway,
    resolveSnapshot: () => SNAPSHOT
  })
  const events = collect(session)
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('hi')
  await finalized
  for (const event of events) {
    assert.deepEqual(JSON.parse(JSON.stringify(event)), event)
  }
  const started = events.find((event) => event.type === 'turn_started')
  assert.deepEqual(started.snapshot, SNAPSHOT)
  assert.equal('apiKey' in started.snapshot, false)
})

test('工具回合为每个 tool_use 回填恰好一个 tool_result 并可续跑至收敛', async () => {
  const { provider, calls } = scriptProvider([
    [
      {
        type: 'tool_call_delta',
        index: 0,
        callId: 'call_1',
        nameDelta: 'read_file',
        argsDelta: '{"path":"a.txt"}'
      },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ],
    [
      { type: 'text_delta', text: 'done' },
      { type: 'message_completed', finishReason: 'stop' }
    ]
  ])
  const executed = []
  const session = new Session({
    provider,
    approval: approvalGateway({ outcome: 'allow', via: 'user' }).gateway,
    resolveSnapshot: () => SNAPSHOT,
    tools: [
      {
        name: 'read_file',
        summary: 'Read a file',
        describe: (input) => `read ${input.path}`,
        async execute(input) {
          executed.push(input)
          return 'file body'
        }
      }
    ]
  })
  const events = collect(session)
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('read it')
  const final = await finalized

  assert.equal(final.outcome, 'completed')
  assert.equal(calls.length, 2)
  assert.deepEqual(executed, [{ path: 'a.txt' }])
  const results = events.filter((event) => event.type === 'tool_result')
  assert.equal(results.length, 1)
  assert.equal(results[0].content, 'file body')
  assert.equal(results[0].isError, false)
  const toolMessage = session.history.find((message) => message.role === 'tool')
  assert.equal(toolMessage.blocks[0].type, 'tool_result')
})

test('并行工具调用按调用顺序各回填一个结果', async () => {
  const { provider } = scriptProvider([
    [
      {
        type: 'tool_call_delta',
        index: 0,
        callId: 'call_1',
        nameDelta: 'first',
        argsDelta: '{}'
      },
      {
        type: 'tool_call_delta',
        index: 1,
        callId: 'call_2',
        nameDelta: 'second',
        argsDelta: '{}'
      },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ],
    [{ type: 'message_completed', finishReason: 'stop' }]
  ])
  const order = []
  const session = new Session({
    provider,
    approval: approvalGateway({ outcome: 'allow', via: 'user' }).gateway,
    resolveSnapshot: () => SNAPSHOT,
    tools: [
      {
        name: 'first',
        describe: () => 'first',
        async execute() {
          order.push('first')
          return '1'
        }
      },
      {
        name: 'second',
        describe: () => 'second',
        async execute() {
          order.push('second')
          return '2'
        }
      }
    ]
  })
  const events = collect(session)
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('go')
  await finalized
  assert.deepEqual(order, ['first', 'second'])
  assert.equal(events.filter((event) => event.type === 'tool_result').length, 2)
})

test('未知工具名与非法参数产生错误结果给模型且不崩溃', async () => {
  const { provider, calls } = scriptProvider([
    [
      {
        type: 'tool_call_delta',
        index: 0,
        callId: 'call_1',
        nameDelta: 'missing_tool',
        argsDelta: '{}'
      },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ],
    [{ type: 'message_completed', finishReason: 'stop' }]
  ])
  const session = new Session({
    provider,
    approval: approvalGateway({ outcome: 'allow', via: 'user' }).gateway,
    resolveSnapshot: () => SNAPSHOT,
    tools: []
  })
  const events = collect(session)
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('go')
  const final = await finalized
  assert.equal(final.outcome, 'completed')
  assert.equal(calls.length, 2)
  const result = events.find((event) => event.type === 'tool_result')
  assert.equal(result.isError, true)
  assert.match(result.content, /Unknown tool/)
})

test('回合进行中切换模型不影响本回合快照，下一回合使用新快照', async () => {
  const snapshots = [
    { ...SNAPSHOT, modelId: 'm1', model: 'model-one' },
    { ...SNAPSHOT, modelId: 'm2', model: 'model-two' }
  ]
  let index = 0
  const { provider, calls } = scriptProvider([
    [{ type: 'message_completed', finishReason: 'stop' }],
    [{ type: 'message_completed', finishReason: 'stop' }]
  ])
  const session = new Session({
    provider,
    approval: approvalGateway({ outcome: 'allow', via: 'user' }).gateway,
    resolveSnapshot: () => snapshots[Math.min(index++, snapshots.length - 1)]
  })
  const events = collect(session)
  let finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('first')
  await finalized
  assert.equal(calls[0].model, 'model-one')

  finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('second')
  await finalized
  assert.equal(calls[1].model, 'model-two')
  const started = events.filter((event) => event.type === 'turn_started')
  assert.equal(started[0].snapshot.model, 'model-one')
  assert.equal(started[1].snapshot.model, 'model-two')
})

test('active 时再次提交入队且不产生交错写历史', async () => {
  const gate = deferred()
  const { provider } = gatedProvider(
    [
      [
        { type: 'text_delta', text: 'a' },
        { type: 'message_completed', finishReason: 'stop' }
      ]
    ],
    gate
  )
  const session = new Session({
    provider,
    approval: approvalGateway({ outcome: 'allow', via: 'user' }).gateway,
    resolveSnapshot: () => SNAPSHOT
  })
  const events = collect(session)
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('first')
  await tick()
  session.submit('second')
  session.submit('third')
  assert.equal(session.queuedInputs.length, 2)
  const queued = events.filter((event) => event.type === 'input_queued')
  assert.equal(queued.length, 2)
  assert.equal(queued[0].preview, 'second')
  assert.equal(queued[1].preview, 'third')
  gate.resolve()
  await finalized
  session.dispose()
})

test('审批：deny 合成拒绝结果回填、会话继续且无挂起泄漏', async () => {
  const { provider, calls } = scriptProvider([
    [
      {
        type: 'tool_call_delta',
        index: 0,
        callId: 'call_1',
        nameDelta: 'dangerous',
        argsDelta: '{"path":"/etc/passwd"}'
      },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ],
    [{ type: 'message_completed', finishReason: 'stop' }]
  ])
  const { gateway, requests } = approvalGateway({
    outcome: 'deny',
    via: 'user'
  })
  let executed = 0
  const session = new Session({
    provider,
    approval: gateway,
    resolveSnapshot: () => SNAPSHOT,
    tools: [
      {
        name: 'dangerous',
        describe: (input) => `read ${input.path}`,
        requiresApproval: () => true,
        async execute() {
          executed++
          return 'should not run'
        }
      }
    ]
  })
  const events = collect(session)
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('go')
  const final = await finalized

  assert.equal(final.outcome, 'completed')
  assert.equal(executed, 0)
  assert.equal(calls.length, 2)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].name, 'dangerous')
  assert.match(requests[0].summary, /passwd/)
  assert.ok(requests[0].requestId)
  const requested = events.find((event) => event.type === 'approval_requested')
  const resolved = events.find((event) => event.type === 'approval_resolved')
  assert.equal(resolved.requestId, requested.requestId)
  assert.equal(resolved.outcome, 'deny')
  const result = events.find((event) => event.type === 'tool_result')
  assert.equal(result.isError, true)
})

test('审批：allow 正常执行且按 id 匹配', async () => {
  const { provider } = scriptProvider([
    [
      {
        type: 'tool_call_delta',
        index: 0,
        callId: 'call_1',
        nameDelta: 'dangerous',
        argsDelta: '{}'
      },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ],
    [{ type: 'message_completed', finishReason: 'stop' }]
  ])
  const { gateway } = approvalGateway({ outcome: 'allow', via: 'user' })
  let executed = 0
  const session = new Session({
    provider,
    approval: gateway,
    resolveSnapshot: () => SNAPSHOT,
    tools: [
      {
        name: 'dangerous',
        describe: () => 'dangerous',
        requiresApproval: () => true,
        async execute() {
          executed++
          return 'ran'
        }
      }
    ]
  })
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('go')
  await finalized
  assert.equal(executed, 1)
})

test('打断在有界时间内取消模型请求并给出 cancelled 终态', async () => {
  const session = new Session({
    provider: blockingProvider(),
    approval: approvalGateway({ outcome: 'allow', via: 'user' }).gateway,
    resolveSnapshot: () => SNAPSHOT
  })
  const events = collect(session)
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  const started = Date.now()
  session.submit('long task')
  session.interrupt('user')
  const final = await finalized
  const elapsed = Date.now() - started
  assert.equal(final.outcome, 'cancelled')
  assert.ok(elapsed < 6000, `cancel took ${elapsed}ms`)
  assert.equal(
    events.filter((event) => event.type === 'turn_finalized').length,
    1
  )
})

test('打断后保留部分输出并为孤儿 tool_use 补合成 error 结果', async () => {
  const { provider } = scriptProvider([
    [
      { type: 'text_delta', text: 'partial' },
      {
        type: 'tool_call_delta',
        index: 0,
        callId: 'call_1',
        nameDelta: 'dangerous',
        argsDelta: '{}'
      },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ]
  ])
  // The approval never resolves on its own: the interrupt cancels it.
  const gateway = {
    async request() {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return { outcome: 'allow', via: 'user' }
    }
  }
  let executed = 0
  const session = new Session({
    provider,
    approval: gateway,
    resolveSnapshot: () => SNAPSHOT,
    tools: [
      {
        name: 'dangerous',
        describe: () => 'dangerous',
        requiresApproval: () => true,
        async execute() {
          executed++
          return 'ran'
        }
      }
    ]
  })
  const events = collect(session)
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('go')
  await tick(10)
  session.interrupt('user')
  const final = await finalized

  assert.equal(final.outcome, 'cancelled')
  assert.equal(executed, 0)
  const assistant = session.history.find((message) => message.role === 'assistant')
  assert.ok(assistant.blocks.some((block) => block.type === 'text'))
  const toolResult = session.history.find((message) => message.role === 'tool')
  assert.ok(toolResult, 'orphan tool_use must get a synthetic result')
  assert.equal(toolResult.blocks[0].isError, true)
  assert.ok(
    assistant.blocks.some((block) => block.type === 'interrupt_mark'),
    'interrupt mark must be recorded'
  )
  const results = events.filter((event) => event.type === 'tool_result')
  assert.equal(results.length, 1)
})

test('纯取消且无新输入时把用户原文还原到输入框并移除该回合内容', async () => {
  const session = new Session({
    provider: blockingProvider(),
    approval: approvalGateway({ outcome: 'allow', via: 'user' }).gateway,
    resolveSnapshot: () => SNAPSHOT
  })
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('original request')
  await new Promise((resolve) => setTimeout(resolve, 10))
  session.interrupt('user')
  const final = await finalized
  assert.equal(final.outcome, 'cancelled')
  assert.equal(final.restoreText, 'original request')
  assert.equal(session.history.length, 0)
})

test('执行中输入的排队项在工具结果回填后按序注入且不重复', async () => {
  const gate = deferred()
  const { provider, calls } = gatedProvider(
    [
      [
        {
          type: 'tool_call_delta',
          index: 0,
          callId: 'call_1',
          nameDelta: 'step',
          argsDelta: '{}'
        },
        { type: 'message_completed', finishReason: 'tool_calls' }
      ],
      [{ type: 'message_completed', finishReason: 'stop' }]
    ],
    gate,
    []
  )
  const session = new Session({
    provider,
    approval: approvalGateway({ outcome: 'allow', via: 'user' }).gateway,
    resolveSnapshot: () => SNAPSHOT,
    tools: [
      {
        name: 'step',
        describe: () => 'step',
        async execute() {
          return 'step done'
        }
      }
    ]
  })
  const events = collect(session)
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('start')
  await tick()
  session.submit('补充一')
  session.submit('补充二')
  assert.equal(session.queuedInputs.length, 2)
  gate.resolve()
  await finalized

  const injected = events.filter((event) => event.type === 'input_injected')
  assert.equal(injected.length, 2)
  assert.equal(injected[0].boundary, 'intra_turn')
  assert.notEqual(injected[0].queueId, injected[1].queueId)
  assert.equal(calls.length, 2)
  const secondCallTexts = calls[1].messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
  assert.ok(secondCallTexts.includes('补充一'))
  assert.ok(secondCallTexts.includes('补充二'))
  assert.ok(
    secondCallTexts.indexOf('补充一') < secondCallTexts.indexOf('补充二')
  )
  const toolResults = calls[1].messages.filter((m) => m.role === 'tool')
  assert.equal(toolResults.length, 1)
  session.dispose()
})

test('回合结束后剩余排队项自动起新回合并标记 inter_turn 边界', async () => {
  const gate = deferred()
  const { provider, calls } = gatedProvider(
    [
      [{ type: 'message_completed', finishReason: 'stop' }],
      [{ type: 'message_completed', finishReason: 'stop' }]
    ],
    gate,
    []
  )
  const session = new Session({
    provider,
    approval: approvalGateway({ outcome: 'allow', via: 'user' }).gateway,
    resolveSnapshot: () => SNAPSHOT,
    queueAutostartMs: 5
  })
  const events = collect(session)
  session.submit('first')
  await tick()
  session.submit('queued for later')
  gate.resolve()
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  await finalized
  const second = waitFor(session, (event) => event.type === 'turn_finalized')
  await second
  assert.equal(calls.length, 2)
  const injected = events.filter((event) => event.type === 'input_injected')
  assert.equal(injected.length, 1)
  assert.equal(injected[0].boundary, 'inter_turn')
  session.dispose()
})

test('驻留窗口内回收排队项会发通知并把文本交回宿主', async () => {
  const gate = deferred()
  const { provider } = gatedProvider(
    [[{ type: 'message_completed', finishReason: 'stop' }]],
    gate,
    []
  )
  const session = new Session({
    provider,
    approval: approvalGateway({ outcome: 'allow', via: 'user' }).gateway,
    resolveSnapshot: () => SNAPSHOT,
    queueAutostartMs: 200
  })
  const events = collect(session)
  session.submit('first')
  await tick()
  session.submit('keep me')
  gate.resolve()
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  await finalized
  const recycled = session.recycleQueued()
  assert.deepEqual(recycled, ['keep me'])
  assert.equal(session.queuedInputs.length, 0)
  assert.ok(events.some((event) => event.code === 'queue_recycled'))
  session.dispose()
})

test('会话状态集合与迁移受约束', async () => {
  const { provider } = scriptProvider([
    [{ type: 'message_completed', finishReason: 'stop' }]
  ])
  const session = new Session({
    provider,
    approval: approvalGateway({ outcome: 'allow', via: 'user' }).gateway,
    resolveSnapshot: () => SNAPSHOT
  })
  assert.equal(session.currentState, 'idle')
  const states = new Set()
  const events = collect(session)
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('hi')
  await finalized
  for (const event of events) {
    if (event.type === 'status') states.add(event.state)
  }
  assert.ok(states.has('requesting'))
  assert.ok(states.has('idle'))
  assert.equal(session.currentState, 'idle')
})
