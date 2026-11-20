// SP005 复审回归：熔断计数的签名规范化与按回合重置。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Session } from '../../tui/dist/core/session.js'
import { ERROR_CODES } from '../../tui/dist/core/constants.js'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: true }
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

function failingRead() {
  return {
    name: 'Read',
    summary: 'read a file',
    describe: () => 'read a file',
    async execute() {
      throw new Error('File not found: missing.txt')
    }
  }
}

test('FR-05 换 JSON 键序不能绕过「同参数空转」熔断', async () => {
  const variants = ['{"path":"missing.txt","mode":"r"}', '{"mode":"r","path":"missing.txt"}']
  let attempt = 0
  const provider = {
    async *stream() {
      const args = variants[attempt % variants.length]
      attempt += 1
      if (attempt > 6) {
        yield { type: 'message_completed', finishReason: 'stop' }
        return
      }
      yield {
        type: 'tool_call_delta',
        index: 0,
        callId: `call-${attempt}`,
        nameDelta: 'Read',
        argsDelta: args
      }
      yield { type: 'message_completed', finishReason: 'tool_calls' }
    }
  }
  const session = new Session({
    provider,
    approval: { async request() { return { outcome: 'allow', via: 'user' } } },
    resolveSnapshot: () => SNAPSHOT,
    tools: [failingRead()]
  })
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('read the missing file')
  const event = await finalized
  assert.equal(event.error?.code, ERROR_CODES.coreToolLoopDetected)
})

test('FR-05 熔断计数按回合重置，不跨回合累积成误判', async () => {
  // Every turn produces two failures and then stops. Without a per-turn reset
  // the third failure of the session (first call of turn two) would trip the
  // breaker even though the failures are unrelated across turns.
  let streamCalls = 0
  const provider = {
    async *stream() {
      const indexInTurn = streamCalls % 3
      streamCalls += 1
      if (indexInTurn === 2) {
        yield { type: 'message_completed', finishReason: 'stop' }
        return
      }
      yield {
        type: 'tool_call_delta',
        index: 0,
        callId: `call-${streamCalls}`,
        nameDelta: 'Read',
        argsDelta: '{"path":"missing.txt"}'
      }
      yield { type: 'message_completed', finishReason: 'tool_calls' }
    }
  }
  const session = new Session({
    provider,
    approval: { async request() { return { outcome: 'allow', via: 'user' } } },
    resolveSnapshot: () => SNAPSHOT,
    tools: [failingRead()]
  })

  const first = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('first turn')
  const firstEvent = await first
  assert.notEqual(firstEvent.error?.code, ERROR_CODES.coreToolLoopDetected)

  const second = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('second turn')
  const secondEvent = await second
  assert.notEqual(
    secondEvent.error?.code,
    ERROR_CODES.coreToolLoopDetected,
    'failures from a previous turn must not trip the breaker'
  )
})
