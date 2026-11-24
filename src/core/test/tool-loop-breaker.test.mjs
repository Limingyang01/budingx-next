import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Session } from '../../tui/dist/core/session.js'
import { ERROR_CODES } from '../../tui/dist/core/constants.js'
import { createSessionTranscript } from '../../tui/dist/storage/session-transcript.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: true }
}

function loopProvider(limit) {
  const calls = []
  let index = 0
  return {
    calls,
    provider: {
      async *stream(request) {
        calls.push(request)
        index += 1
        if (index > limit) {
          yield { type: 'message_completed', finishReason: 'stop' }
          return
        }
        yield {
          type: 'tool_call_delta',
          index: 0,
          callId: `call-${index}`,
          nameDelta: 'Read',
          argsDelta: '{"path":"missing.txt"}'
        }
        yield { type: 'message_completed', finishReason: 'tool_calls' }
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

test('FR-05 同一工具同一参数连续失败达到上限后熔断，不再空转', async () => {
  const { provider, calls } = loopProvider(20)
  const session = new Session({
    provider,
    approval: { async request() { return { outcome: 'allow', via: 'user' } } },
    resolveSnapshot: () => SNAPSHOT,
    tools: [
      {
        name: 'Read',
        summary: 'read a file',
        describe: () => 'read a file',
        async execute() {
          throw new Error('File not found: missing.txt')
        }
      }
    ]
  })
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('read the missing file')
  const event = await finalized
  assert.equal(event.outcome, 'error')
  assert.equal(event.error.code, ERROR_CODES.coreToolLoopDetected)
  assert.match(event.error.message, /stop retrying the same arguments/i)
  // The breaker must stop the loop early, not let it spin to maxIterations.
  assert.ok(calls.length <= 4, `expected the loop to stop early, got ${calls.length} model calls`)
})

test('FR-05 熔断原因写入转录并出现在回合失败原因里', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-sp005-loop-'))
  const sessionId = 'loop-session'
  const transcript = createSessionTranscript({ sessionId, home })
  const { provider, calls } = loopProvider(20)
  const session = new Session({
    provider,
    approval: { async request() { return { outcome: 'allow', via: 'user' } } },
    resolveSnapshot: () => SNAPSHOT,
    transcript,
    tools: [
      {
        name: 'Read',
        summary: 'read a file',
        describe: () => 'read a file',
        async execute() {
          throw new Error('File not found: missing.txt')
        }
      }
    ]
  })
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('read the missing file')
  const event = await finalized
  // The turn error carries the stable code.
  assert.equal(event.error.code, ERROR_CODES.coreToolLoopDetected)
  assert.match(event.error.message, /BUDINGX_CORE_010/)
  // The breaker explanation is durable in the transcript.
  const read = transcript.read()
  const steps = read.records.filter((record) => record.type === 'tool_step')
  const breakerStep = steps.find((step) => step.status === 'failed' && step.detail === ERROR_CODES.coreToolLoopDetected)
  assert.ok(breakerStep, 'the breaker step must be recorded in the transcript')
  // The tool was attempted at most the breaker limit times.
  const attempts = steps.filter((step) => step.name === 'Read')
  assert.ok(attempts.length <= 3, `expected at most 3 attempts, got ${attempts.length}`)
  assert.ok(calls.length <= 4)
})

test('FR-05 成功过的调用不计入连续失败计数', async () => {
  let attempt = 0
  const { provider } = {
    provider: {
      async *stream() {
        attempt += 1
        if (attempt <= 4) {
          yield {
            type: 'tool_call_delta',
            index: 0,
            callId: `call-${attempt}`,
            nameDelta: 'Read',
            argsDelta: '{"path":"missing.txt"}'
          }
          yield { type: 'message_completed', finishReason: 'tool_calls' }
          return
        }
        yield { type: 'message_completed', finishReason: 'stop' }
      }
    }
  }
  const session = new Session({
    provider,
    approval: { async request() { return { outcome: 'allow', via: 'user' } } },
    resolveSnapshot: () => SNAPSHOT,
    tools: [
      {
        name: 'Read',
        summary: 'read a file',
        describe: () => 'read a file',
        async execute() {
          // The first two attempts fail, the third succeeds, the fourth fails again.
          if (attempt === 3) return 'file content'
          throw new Error('File not found: missing.txt')
        }
      }
    ]
  })
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('read the missing file')
  const event = await finalized
  // Without a successful call in between the breaker would trip on attempt 3.
  assert.notEqual(event.error?.code, ERROR_CODES.coreToolLoopDetected)
});

test('FR-05 换参数反复试同一工具（同一错误码）也会熔断', async () => {
  const paths = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt', 'f.txt', 'g.txt', 'h.txt']
  let attempt = 0
  const { provider } = {
    provider: {
      async *stream() {
        const target = paths[attempt] ?? paths[paths.length - 1]
        attempt += 1
        if (attempt > 12) {
          yield { type: 'message_completed', finishReason: 'stop' }
          return
        }
        yield {
          type: 'tool_call_delta',
          index: 0,
          callId: `call-${attempt}`,
          nameDelta: 'Read',
          argsDelta: JSON.stringify({ path: target })
        }
        yield { type: 'message_completed', finishReason: 'tool_calls' }
      }
    }
  }
  const session = new Session({
    provider,
    approval: { async request() { return { outcome: 'allow', via: 'user' } } },
    resolveSnapshot: () => SNAPSHOT,
    tools: [
      {
        name: 'Read',
        summary: 'read a file',
        describe: () => 'read a file',
        async execute() {
          const error = new Error('File not found: ' + paths[attempt - 1])
          error.code = 'BUDINGX_WORKSPACE_002'
          throw error
        }
      }
    ]
  })
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('find the file')
  const event = await finalized
  assert.equal(event.outcome, 'error')
  assert.equal(event.error.code, ERROR_CODES.coreToolLoopDetected)
  assert.match(event.error.message, /same error/)
  assert.match(event.error.message, /switch to a different tool or strategy/i)
  // Five same-error failures in a row must stop the turn, not run to 12.
  assert.ok(attempt <= 7, `expected the streak breaker to stop early, got ${attempt} attempts`)
});
