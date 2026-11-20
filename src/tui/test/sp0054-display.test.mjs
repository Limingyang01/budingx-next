// 0.5.4 显示修复：时长格式化、过程性提示收起、追问卡收起。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatDuration, reduceFrame } from '../dist/tui/render/reducer.js'
import { initialFrame } from '../dist/tui/render/types.js'

const opts = { width: 80 }

test('0.5.4 时长按 小时/分钟/秒 格式化，省略为零的高位', () => {
  assert.equal(formatDuration(0), '0 秒')
  assert.equal(formatDuration(49), '49 秒')
  assert.equal(formatDuration(469), '7 分钟 49 秒')
  assert.equal(formatDuration(3600), '1 小时')
  assert.equal(formatDuration(3661), '1 小时 1 分钟 1 秒')
  assert.equal(formatDuration(469, false), '7m 49s')
  assert.equal(formatDuration(3661, false), '1h 1m 1s')
})

test('0.5.4 完成 meta 使用格式化时长而非总秒数', () => {
  let frame = initialFrame()
  frame = reduceFrame(frame, { type: 'turn_started', turnId: 't', startedAt: 1000, userText: 'q' }, opts)
  frame = reduceFrame(frame, { type: 'turn_finalized', turnId: 't', outcome: 'completed', finishedAt: 1000 + 469000 }, opts)
  const meta = frame.transcript.find((entry) => entry.kind === 'meta')
  assert.match(meta.text, /用时 7 分钟 49 秒/)
  assert.doesNotMatch(meta.text, /469 秒/)
})

test('0.5.4 同一代码提示只保留最新一条（重试不堆叠）', () => {
  let frame = initialFrame()
  frame = reduceFrame(frame, { type: 'notice', level: 'info', code: 'api_retry', text: 'attempt 1/5' }, opts)
  frame = reduceFrame(frame, { type: 'notice', level: 'info', code: 'api_retry', text: 'attempt 2/5' }, opts)
  assert.equal(frame.notices.length, 1)
  assert.equal(frame.notices[0].text, 'attempt 2/5')
})

test('0.5.4 回合结束收起过程性提示，保留告警/错误类提示', () => {
  let frame = initialFrame()
  frame = reduceFrame(frame, { type: 'turn_started', turnId: 't', startedAt: 1, userText: 'q' }, opts)
  frame = reduceFrame(frame, { type: 'notice', level: 'info', code: 'api_retry', text: 'retrying' }, opts)
  frame = reduceFrame(frame, { type: 'notice', level: 'info', code: 'stream_fallback', text: 'fallback' }, opts)
  frame = reduceFrame(frame, { type: 'notice', level: 'error', code: 'storage_write_failed', text: 'write failed' }, opts)
  frame = reduceFrame(frame, { type: 'turn_finalized', turnId: 't', outcome: 'completed', finishedAt: 2 }, opts)
  assert.equal(frame.notices.length, 1)
  assert.equal(frame.notices[0].code, 'storage_write_failed')
})

test('0.5.4 追问答案交付后卡片收起，不再占位', () => {
  let frame = initialFrame()
  frame = reduceFrame(frame, {
    type: 'question_requested', turnId: 't', callId: 'call-q',
    question: { questionId: 'q1', callId: 'call-q', questions: [{ question: 'Q?', options: [], multiSelect: false }], allowFreeText: true, createdAt: 1 }
  }, opts)
  assert.ok(frame.question)
  frame = reduceFrame(frame, { type: 'question_answered', turnId: 't', callId: 'call-q', questionId: 'q1', answers: { 'Q?': 'A' } }, opts)
  assert.equal(frame.question.state, 'answered')
  frame = reduceFrame(frame, { type: 'tool_result', turnId: 't', callId: 'call-q', content: '用户已回答以下问题：Q? A', isError: false }, opts)
  assert.equal(frame.question, undefined)
})
