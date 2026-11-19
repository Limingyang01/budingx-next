// SP004 agent-observability T26：Core 追踪端口与 Session 接线。
// 覆盖 OB-11…OB-16、OB-21。用假 tracer 记录调用序列，不依赖任何网络。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Session } from '../../tui/dist/core/session.js'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: true }
}

/** 记录所有埋点调用的假 tracer。 */
function recordingTracer(options = {}) {
  const calls = []
  let counter = 0
  const tracer = {
    calls,
    begin(name, attributes, parent) {
      if (options.throwOnBegin) throw new Error('tracer begin failed')
      const handle = { id: `h${++counter}` }
      calls.push({ op: 'begin', name, attributes, parent, handle })
      return handle
    },
    end(handle, outcome, error) {
      if (options.throwOnEnd) throw new Error('tracer end failed')
      calls.push({ op: 'end', handle, outcome, error })
    },
    setAttributes(handle, attributes) {
      if (options.throwOnAttributes) throw new Error('tracer attributes failed')
      calls.push({ op: 'setAttributes', handle, attributes })
    },
    setPayload(handle, key, value) {
      if (options.throwOnPayload) throw new Error('tracer payload failed')
      calls.push({ op: 'setPayload', handle, key, value })
    }
  }
  return tracer
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
        for (const event of events) yield event
      }
    }
  }
}

function toolHandler(overrides = {}) {
  return {
    name: 'Read',
    parameters: { type: 'object', properties: {} },
    summary: 'read',
    describe: () => 'read file',
    async execute() {
      return 'file body'
    },
    ...overrides
  }
}

/** 构造最小 Session，注入 tracer 与可选工具。 */
function makeSession(options = {}) {
  const scripted = scriptProvider(options.script ?? [])
  const session = new Session({
    provider: scripted.provider,
    approval: { async request() { return { outcome: 'allow', via: 'user' } } },
    resolveSnapshot: () => SNAPSHOT,
    ...(options.tools ? { tools: options.tools } : {}),
    ...(options.tracer ? { tracer: options.tracer } : {}),
    ...(options.id ? { id: options.id } : {})
  })
  return { session, provider: scripted }
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

/**
 * submit() 是即发即忘：回合在后台继续。测试必须等待 turn_finalized，
 * 否则观测收尾尚未发生。
 */
async function submitAndWait(session, text) {
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit(text)
  return finalized
}

const begins = (tracer, name) =>
  tracer.calls.filter((call) => call.op === 'begin' && call.name === name)
const ends = (tracer, handle) =>
  tracer.calls.filter((call) => call.op === 'end' && call.handle === handle)

test('no tracer means no instrumentation calls and no error', async () => {
  const { session } = makeSession()
  await submitAndWait(session, 'hello')
  assert.equal(session.state, 'idle')
})

test('one root agent.run observation per turn with session, turn and run id', async () => {
  const tracer = recordingTracer()
  const { session } = makeSession({ tracer, id: 'session-1' })
  await submitAndWait(session, 'hello')

  const roots = begins(tracer, 'agent.run')
  assert.equal(roots.length, 1)
  const attrs = roots[0].attributes
  assert.equal(attrs['session.id'], 'session-1')
  assert.equal(typeof attrs['turn.id'], 'string')
  assert.ok(attrs['turn.id'])
  assert.equal(typeof attrs['langfuse.trace.metadata.runId'], 'string')
  assert.equal(attrs['langfuse.observation.type'], 'agent')
  assert.equal(roots[0].parent, undefined)
})

test('each provider stream creates a model.request child of the turn root', async () => {
  const tracer = recordingTracer()
  const { session } = makeSession({
    tracer,
    script: [[{ type: 'message_completed', finishReason: 'stop' }]]
  })
  await submitAndWait(session, 'hello')

  const roots = begins(tracer, 'agent.run')
  const models = begins(tracer, 'model.request')
  assert.equal(models.length, 1)
  assert.equal(models[0].parent, roots[0].handle)
  assert.equal(models[0].attributes['langfuse.observation.type'], 'generation')
  assert.equal(models[0].attributes['gen_ai.request.model'], 'test-model')
})

test('usage is written on the model observation when the provider reports it', async () => {
  const tracer = recordingTracer()
  const { session } = makeSession({
    tracer,
    script: [
      [
        {
          type: 'message_completed',
          finishReason: 'stop',
          usage: { inputTokens: 12, outputTokens: 5 }
        }
      ]
    ]
  })
  await submitAndWait(session, 'hello')

  const model = begins(tracer, 'model.request')[0]
  const usageCall = tracer.calls.find(
    (call) =>
      call.op === 'setAttributes' &&
      call.handle === model.handle &&
      call.attributes['langfuse.observation.usage_details'] !== undefined
  )
  assert.ok(usageCall, 'usage details must be set on the model observation')
  const details = JSON.parse(usageCall.attributes['langfuse.observation.usage_details'])
  assert.equal(details.input, 12)
  assert.equal(details.output, 5)
})

test('a later provider call without usage must not inherit the previous usage', async () => {
  const tracer = recordingTracer()
  const { session } = makeSession({
    tracer,
    script: [
      [
        {
          type: 'tool_call_delta',
          index: 0,
          callId: 'call-1',
          nameDelta: 'Read',
          argsDelta: '{}'
        },
        {
          type: 'message_completed',
          finishReason: 'tool_calls',
          usage: { inputTokens: 12, outputTokens: 5 }
        }
      ],
      [{ type: 'message_completed', finishReason: 'stop' }]
    ],
    tools: [toolHandler()]
  })
  await submitAndWait(session, 'hello')

  const models = begins(tracer, 'model.request')
  assert.equal(models.length, 2)
  const usageCalls = tracer.calls.filter(
    (call) =>
      call.op === 'setAttributes' &&
      call.attributes['langfuse.observation.usage_details'] !== undefined
  )
  assert.equal(usageCalls.length, 1)
  assert.equal(usageCalls[0].handle, models[0].handle)
})

test('tool observation is created before the permission decision and names the call', async () => {
  const tracer = recordingTracer()
  const { session } = makeSession({
    tracer,
    script: [
      [
        {
          type: 'tool_call_delta',
          index: 0,
          callId: 'call-1',
          nameDelta: 'Read',
          argsDelta: '{}'
        },
        { type: 'message_completed', finishReason: 'tool_calls' }
      ],
      [{ type: 'message_completed', finishReason: 'stop' }]
    ],
    tools: [toolHandler()]
  })
  await submitAndWait(session, 'hello')

  const roots = begins(tracer, 'agent.run')
  const tools = begins(tracer, 'tool.Read')
  assert.equal(tools.length, 1)
  assert.equal(tools[0].parent, roots[0].handle)
  assert.equal(tools[0].attributes['gen_ai.tool.call.id'], 'call-1')
  assert.equal(tools[0].attributes['langfuse.observation.type'], 'tool')
})

test('successful tool ends with success and failed tool ends with error', async () => {
  const tracer = recordingTracer()
  const { session } = makeSession({
    tracer,
    script: [
      [
        {
          type: 'tool_call_delta',
          index: 0,
          callId: 'call-1',
          nameDelta: 'Read',
          argsDelta: '{}'
        }
      ],
      [{ type: 'message_completed', finishReason: 'stop' }]
    ],
    tools: [toolHandler()]
  })
  await submitAndWait(session, 'hello')

  const tool = begins(tracer, 'tool.Read')[0]
  const toolEnds = ends(tracer, tool.handle)
  assert.equal(toolEnds.length, 1)
  assert.equal(toolEnds[0].outcome, 'success')
})

test('a denied tool ends as blocked', async () => {
  const tracer = recordingTracer()
  const { session } = makeSession({
    tracer,
    script: [
      [
        {
          type: 'tool_call_delta',
          index: 0,
          callId: 'call-1',
          nameDelta: 'Read',
          argsDelta: '{}'
        }
      ],
      [{ type: 'message_completed', finishReason: 'stop' }]
    ],
    tools: [toolHandler()]
  })
  session.options.permissionPolicy = {
    decide: () => ({ action: 'deny', reason: 'not allowed' }),
    remember: () => {},
    getMode: () => 'read',
    setMode: () => {},
    onModeChanged: () => {}
  }
  await submitAndWait(session, 'hello')

  const tool = begins(tracer, 'tool.Read')[0]
  const toolEnds = ends(tracer, tool.handle)
  assert.equal(toolEnds.length, 1)
  assert.equal(toolEnds[0].outcome, 'blocked')
})

test('a failed turn ends the root observation with error', async () => {
  const tracer = recordingTracer()
  const { session } = makeSession({
    tracer,
    script: [
      [
        {
          type: 'failed',
          error: {
            class: 'unknown',
            code: 'BUDINGX_PROVIDER_001',
            message: 'boom',
            retryable: false
          }
        }
      ]
    ]
  })
  await submitAndWait(session, 'hello')

  const root = begins(tracer, 'agent.run')[0]
  const rootEnds = ends(tracer, root.handle)
  assert.equal(rootEnds.length, 1)
  assert.equal(rootEnds[0].outcome, 'error')
})

test('a cancelled turn ends the root observation with cancelled exactly once', async () => {
  const tracer = recordingTracer()
  const { session } = makeSession({
    tracer,
    script: [
      [
        {
          type: 'tool_call_delta',
          index: 0,
          callId: 'call-1',
          nameDelta: 'Read',
          argsDelta: '{}'
        },
        { type: 'message_completed', finishReason: 'tool_calls' }
      ]
    ],
    tools: [toolHandler()]
  })
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('hello')
  await new Promise((resolve) => setTimeout(resolve, 10))
  session.interrupt()
  const event = await finalized

  const root = begins(tracer, 'agent.run')[0]
  const rootEnds = ends(tracer, root.handle)
  assert.equal(rootEnds.length, 1)
  assert.ok(['cancelled', 'success'].includes(rootEnds[0].outcome))
  assert.equal(event.turnId, root.attributes['turn.id'])
})

test('two turns in one session share the session id but differ in turn id', async () => {
  const tracer = recordingTracer()
  const { session } = makeSession({ tracer, id: 'session-2' })
  await submitAndWait(session, 'first')
  await submitAndWait(session, 'second')

  const roots = begins(tracer, 'agent.run')
  assert.equal(roots.length, 2)
  assert.equal(roots[0].attributes['session.id'], 'session-2')
  assert.equal(roots[1].attributes['session.id'], 'session-2')
  assert.notEqual(roots[0].attributes['turn.id'], roots[1].attributes['turn.id'])
})

test('a tracer that throws never breaks the turn', async () => {
  const tracer = recordingTracer({
    throwOnBegin: true,
    throwOnEnd: true,
    throwOnAttributes: true,
    throwOnPayload: true
  })
  const { session } = makeSession({ tracer })
  await submitAndWait(session, 'hello')
  assert.equal(session.state, 'idle')
})

test('a failing root leaves no orphan child observations', async () => {
  const tracer = recordingTracer()
  let count = 0
  const flaky = {
    begin(name, attributes, parent) {
      count++
      if (name === 'agent.run') return undefined
      return { id: `h${count}` }
    },
    end() {},
    setAttributes() {},
    setPayload() {}
  }
  const { session } = makeSession({ tracer: flaky, script: [] })
  await submitAndWait(session, 'hello')
  const models = begins(tracer, 'model.request')
  assert.equal(models.length, 0)
})
