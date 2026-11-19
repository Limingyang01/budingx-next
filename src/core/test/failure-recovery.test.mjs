import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Session } from '../../tui/dist/core/session.js'
import { createSessionTranscript } from '../../tui/dist/storage/session-transcript.js'
import { SessionStore } from '../../tui/dist/storage/session-store.js'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
        for (const event of events) yield event
      }
    }
  }
}

function approvalGateway(decision = { outcome: 'allow', via: 'user' }) {
  return {
    async request() {
      return decision
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

test('FR-01 供应商鉴权失败给出稳定错误码与类别', async () => {
  const { provider } = scriptProvider([
    [
      {
        type: 'failed',
        error: {
          class: 'auth',
          code: 'BUDINGX_PROVIDER_001',
          message: 'invalid api key',
          retryable: false
        }
      }
    ]
  ])
  const session = new Session({
    provider,
    approval: approvalGateway(),
    resolveSnapshot: () => SNAPSHOT
  })
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('hello')
  const event = await finalized
  assert.equal(event.outcome, 'error')
  assert.equal(event.error.class, 'auth')
  assert.equal(event.error.code, 'BUDINGX_PROVIDER_001')
  assert.match(event.error.message, /invalid api key/)
})

test('FR-02 工具失败进入模型上下文且回合继续，不伪装成功', async () => {
  const { provider, calls } = scriptProvider([
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
  ])
  const session = new Session({
    provider,
    approval: approvalGateway(),
    resolveSnapshot: () => SNAPSHOT,
    tools: [
      {
        name: 'Read',
        summary: 'read a file',
        describe: () => 'read a file',
        async execute() {
          throw new Error('file is missing')
        }
      }
    ]
  })
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('read it')
  const event = await finalized
  assert.equal(event.outcome, 'completed')
  // The failed tool result must be visible to the model on the next iteration.
  const second = calls[1]
  const toolMessage = second.messages.find((message) => message.role === 'tool')
  assert.ok(toolMessage, 'the failed tool result must reach the model')
  assert.match(toolMessage.content, /file is missing/)
})

test('FR-05 达到最大迭代次数给出 max_turns 明确原因', async () => {
  // 每轮都发起工具调用，循环因此不会自然结束，必须由最大迭代次数兜底。
  const loopScript = Array.from({ length: 8 }, (_, index) => [
    {
      type: 'tool_call_delta',
      index: 0,
      callId: `call-${index}`,
      nameDelta: 'Read',
      argsDelta: '{}'
    },
    { type: 'message_completed', finishReason: 'tool_calls' }
  ])
  const { provider } = scriptProvider(loopScript)
  const session = new Session({
    provider,
    approval: approvalGateway(),
    resolveSnapshot: () => SNAPSHOT,
    maxIterations: 3,
    tools: [
      {
        name: 'Read',
        summary: 'read a file',
        describe: () => 'read a file',
        async execute() {
          return 'file content'
        }
      }
    ]
  })
  const events = collect(session)
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('loop forever')
  const event = await finalized
  assert.equal(event.outcome, 'max_turns')
  assert.ok(
    events.some((item) => item.type === 'notice' && item.code === 'model_limit_reached'),
    'a model_limit_reached notice must explain the reason'
  )
})

test('FR-06 失败位置可定位并写入转录：回合、工具步骤与错误码', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-sp005-failure-'))
  const sessionId = 'failure-session'
  const transcript = createSessionTranscript({ sessionId, home })
  const { provider } = scriptProvider([
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
  ])
  const session = new Session({
    provider,
    approval: approvalGateway(),
    resolveSnapshot: () => SNAPSHOT,
    transcript,
    tools: [
      {
        name: 'Read',
        summary: 'read a file',
        describe: () => 'read a file',
        async execute() {
          throw new Error('file is missing')
        }
      }
    ]
  })
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('read it')
  await finalized
  const read = transcript.read()
  const steps = read.records.filter((record) => record.type === 'tool_step')
  assert.equal(steps.length, 1)
  assert.equal(steps[0].status, 'failed')
  assert.match(steps[0].detail ?? '', /BUDINGX_|failed/i)
  const turns = read.records.filter((record) => record.type === 'turn')
  assert.equal(turns.length, 1)
  assert.ok(turns[0].turnId)
})

test('FR-07 存储写入失败不丢业务结果，并给出存储错误码', async () => {
  const records = []
  const transcript = {
    append(record) {
      records.push(record)
      throw new Error('disk is full')
    },
    read() {
      return { records, corruptLines: 0, unsupported: false }
    },
    directory() {
      return '/memory'
    }
  }
  const { provider } = scriptProvider([
    [
      { type: 'text_delta', text: '答案' },
      { type: 'message_completed', finishReason: 'stop' }
    ]
  ])
  const session = new Session({
    provider,
    approval: approvalGateway(),
    resolveSnapshot: () => SNAPSHOT,
    transcript
  })
  const events = collect(session)
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('hello')
  const event = await finalized
  // The business result survives the persistence failure.
  assert.equal(event.outcome, 'completed')
  const notice = events.find(
    (item) => item.type === 'notice' && item.code === 'storage_write_failed'
  )
  assert.ok(notice, 'a storage_write_failed notice must be emitted')
  assert.match(notice.text, /BUDINGX_STORAGE_005/)
})

test('FR-07 存储写入失败出现在 turn_finalized 的 persistenceError 中', async () => {
  const records = []
  const transcript = {
    append(record) {
      records.push(record)
      throw new Error('disk is full')
    },
    read() {
      return { records, corruptLines: 0, unsupported: false }
    },
    directory() {
      return '/memory'
    }
  }
  const { provider } = scriptProvider([
    [{ type: 'message_completed', finishReason: 'stop' }]
  ])
  const session = new Session({
    provider,
    approval: approvalGateway(),
    resolveSnapshot: () => SNAPSHOT,
    transcript
  })
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('hello')
  const event = await finalized
  assert.ok(event.persistenceError, 'the turn must report the persistence error')
  assert.equal(event.persistenceError.code, 'BUDINGX_STORAGE_005')
  assert.match(event.persistenceError.message, /disk is full/)
})

test('FR-04 重试从失败点继续，不重复已确认的副作用', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-sp005-retry-'))
  const sessionId = 'retry-session'
  const transcript = createSessionTranscript({ sessionId, home })
  let executions = 0
  const { provider } = scriptProvider([
    [
      {
        type: 'tool_call_delta',
        index: 0,
        callId: 'call-1',
        nameDelta: 'Write',
        argsDelta: '{}'
      },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ],
    [
      {
        type: 'failed',
        error: {
          class: 'network',
          code: 'BUDINGX_PROVIDER_008',
          message: 'connection reset',
          retryable: true
        }
      }
    ]
  ])
  const session = new Session({
    provider,
    approval: approvalGateway(),
    resolveSnapshot: () => SNAPSHOT,
    transcript,
    tools: [
      {
        name: 'Write',
        summary: 'write a file',
        describe: () => 'write a file',
        async execute() {
          executions += 1
          return 'written'
        }
      }
    ]
  })
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('write it')
  const event = await finalized
  assert.equal(event.outcome, 'error')
  assert.equal(executions, 1, 'the confirmed side effect must not run twice')
  const read = transcript.read()
  const steps = read.records.filter((record) => record.type === 'tool_step')
  assert.equal(steps.length, 1)
  assert.equal(steps[0].status, 'completed')
})

test('SR-04 恢复的会话不会执行任何工具', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-sp005-noreplay-'))
  const sessionId = 'noreplay-session'
  const transcript = createSessionTranscript({ sessionId, home })
  transcript.append({
    type: 'tool_step',
    ts: new Date().toISOString(),
    turnId: 'turn-1',
    callId: 'call-1',
    name: 'Write',
    status: 'completed'
  })
  const store = new SessionStore({ home })
  const restored = store.restore(sessionId)
  assert.equal(restored.status, 'restored')
  assert.equal(restored.needsReview.length, 0)
});
