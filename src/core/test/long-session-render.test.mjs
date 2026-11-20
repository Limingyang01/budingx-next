// 0.5.2 长会话渲染与上下文用量回归。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reduceFrame } from '../../tui/dist/tui/render/reducer.js'
import { initialFrame } from '../../tui/dist/tui/render/types.js'
import { visibleHistoryRange } from '../../tui/dist/tui/render/history-window.js'
import { formatTokens } from '../../tui/dist/tui/commands.js'
import { Session } from '../../tui/dist/core/session.js'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: false }
}

test('0.5.2 流式增量不做全文重排：reducer 只累积原文', () => {
  let frame = initialFrame()
  frame = reduceFrame(frame, { type: 'turn_started', turnId: 't', startedAt: 1, userText: 'q' }, { width: 40 })
  // A long answer arriving in many deltas must stay O(1) per delta.
  const chunk = 'x'.repeat(200)
  const started = process.hrtime.bigint()
  for (let i = 0; i < 400; i++) {
    frame = reduceFrame(frame, { type: 'text_delta', turnId: 't', messageId: 'm1', text: chunk }, { width: 40 })
  }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
  assert.equal(frame.liveText.length, 400 * 200)
  // The old implementation re-wrapped the whole text per delta (~quadratic).
  // 80k chars must stay well under this budget on any CI machine.
  assert.ok(elapsedMs < 400, `400 deltas over 80k chars took ${elapsedMs.toFixed(0)}ms`)
})

test('0.5.2 完成后的回答进入 transcript 且只进入一次', () => {
  let frame = initialFrame()
  frame = reduceFrame(frame, { type: 'turn_started', turnId: 't', startedAt: 1, userText: 'q' }, { width: 40 })
  frame = reduceFrame(frame, { type: 'text_delta', turnId: 't', messageId: 'm1', text: 'answer' }, { width: 40 })
  frame = reduceFrame(frame, { type: 'message_completed', turnId: 't', messageId: 'm1' }, { width: 40 })
  frame = reduceFrame(frame, { type: 'turn_finalized', turnId: 't', outcome: 'completed', finishedAt: 2 }, { width: 40 })
  const answers = frame.transcript.filter((entry) => entry.kind === 'assistant')
  assert.equal(answers.length, 1)
  assert.equal(answers[0].text, 'answer')
  assert.equal(frame.liveText, '')
})

test('0.5.2 虚拟范围在长历史下保持有界', () => {
  const offsets = Array.from({ length: 20001 }, (_, index) => index * 3)
  const range = visibleHistoryRange(offsets, 30000, 40, 80)
  assert.ok(range.start >= 0)
  assert.ok(range.end - range.start < 200, 'the mounted range must stay bounded')
  assert.ok(offsets[range.start] <= 30000)
})

test('0.5.2 token 文本紧凑且不丢量级', () => {
  assert.equal(formatTokens(0), '0')
  assert.equal(formatTokens(999), '999')
  assert.equal(formatTokens(1234), '1.2k')
  assert.equal(formatTokens(12000), '12k')
  assert.equal(formatTokens(200000), '200k')
  assert.equal(formatTokens(1500000), '1.5M')
})

test('0.5.2 会话记录 provider 汇报的真实用量，并随清空重置', async () => {
  const provider = {
    async *stream() {
      yield { type: 'text_delta', text: 'hi' }
      yield {
        type: 'message_completed',
        finishReason: 'stop',
        usage: { inputTokens: 4321, outputTokens: 12 }
      }
    }
  }
  const session = new Session({
    provider,
    approval: { async request() { return { outcome: 'allow', via: 'user' } } },
    resolveSnapshot: () => SNAPSHOT
  })
  const finalized = new Promise((resolve) => {
    const off = session.on((event) => {
      if (event.type === 'turn_finalized') {
        off()
        resolve(event)
      }
    })
  })
  session.submit('hello')
  await finalized
  assert.deepEqual(session.usage, { inputTokens: 4321, outputTokens: 12 })
  session.clearHistory()
  assert.equal(session.usage, undefined)
})

test('0.5.2 推理强度随请求下发，且未设置时不发送', async () => {
  const requests = []
  const provider = {
    async *stream(request) {
      requests.push(request)
      yield { type: 'message_completed', finishReason: 'stop' }
    }
  }
  let effort
  const session = new Session({
    provider,
    approval: { async request() { return { outcome: 'allow', via: 'user' } } },
    resolveSnapshot: () => SNAPSHOT,
    resolveReasoningEffort: () => effort
  })
  const run = () => new Promise((resolve) => {
    const off = session.on((event) => {
      if (event.type === 'turn_finalized') {
        off()
        resolve()
      }
    })
    session.submit('go')
  })
  await run()
  assert.equal(requests[0].reasoningEffort, undefined)
  effort = 'high'
  await run()
  assert.equal(requests[1].reasoningEffort, 'high')
})