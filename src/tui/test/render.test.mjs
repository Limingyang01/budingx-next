import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reduceFrame, renderTextLines } from '../dist/tui/render/reducer.js'
import { initialFrame } from '../dist/tui/render/types.js'

const turnId = 'turn-1'

test('增量文本按帧合并而不是逐字符重排', () => {
  let frame = initialFrame()
  frame = reduceFrame(frame, { type: 'turn_started', turnId, snapshot: { modelId: 'm', model: 'x', baseUrlHost: 'h', capabilities: { tools: false } } }, { width: 40 })
  for (const character of '你好世界') {
    frame = reduceFrame(frame, { type: 'text_delta', turnId, messageId: 'm1', text: character }, { width: 40 })
    assert.equal(frame.liveLines.length, 1)
  }
  assert.equal(frame.liveText, '你好世界')
  assert.deepEqual(frame.liveLines, ['你好世界'])
})

test('CJK 与 emoji 按显示宽度折行且不切字', () => {
  assert.deepEqual(renderTextLines('你好', 4), ['你好'])
  assert.deepEqual(renderTextLines('你好', 3), ['你', '好'])
  assert.deepEqual(renderTextLines('a👍b', 3), ['a👍', 'b'])
  for (const line of renderTextLines('你好世界', 5)) {
    assert.ok(line.length > 0)
  }
})

test('终态切换原子：live 段只进入 static 一次且不丢段', () => {
  let frame = initialFrame()
  frame = reduceFrame(frame, { type: 'turn_started', turnId, snapshot: { modelId: 'm', model: 'x', baseUrlHost: 'h', capabilities: { tools: false } } }, { width: 40 })
  frame = reduceFrame(frame, { type: 'text_delta', turnId, messageId: 'm1', text: '答案' }, { width: 40 })
  frame = reduceFrame(frame, { type: 'message_completed', turnId, messageId: 'm1' }, { width: 40 })
  assert.equal(frame.liveLines.length, 0)
  assert.deepEqual(frame.staticLines, ['答案', ''])
  frame = reduceFrame(frame, { type: 'turn_finalized', turnId, outcome: 'completed' }, { width: 40 })
  assert.deepEqual(frame.staticLines, ['答案', ''])
})

test('事件流回放得到排队指示、审批卡与状态', () => {
  let frame = initialFrame()
  const options = { width: 40 }
  frame = reduceFrame(frame, { type: 'input_queued', queueId: 'q1', preview: '补充' }, options)
  assert.deepEqual(frame.queue, [{ id: 'q1', preview: '补充' }])
  frame = reduceFrame(frame, { type: 'input_injected', turnId, queueId: 'q1', boundary: 'intra_turn' }, options)
  assert.deepEqual(frame.queue, [])
  frame = reduceFrame(frame, { type: 'approval_requested', turnId, requestId: 'r1', callId: 'c1', name: 'read_file', summary: 'read a.txt' }, options)
  assert.equal(frame.approval.requestId, 'r1')
  frame = reduceFrame(frame, { type: 'approval_resolved', turnId, requestId: 'r1', outcome: 'allow', via: 'user' }, options)
  assert.equal(frame.approval, undefined)
  frame = reduceFrame(frame, { type: 'status', state: 'streaming' }, options)
  assert.equal(frame.status.state, 'streaming')
  frame = reduceFrame(frame, { type: 'notice', level: 'warning', code: 'api_retry', text: 'retrying' }, options)
  assert.equal(frame.notices.at(-1).text, 'retrying')
  frame = reduceFrame(frame, { type: 'turn_finalized', turnId, outcome: 'error', error: { class: 'auth', code: 'BUDINGX_PROVIDER_001', message: 'bad key', retryable: false } }, options)
  assert.equal(frame.error, 'bad key')
})

test('工具调用与结果进入 live 区', () => {
  let frame = initialFrame()
  const options = { width: 40 }
  frame = reduceFrame(frame, { type: 'tool_call_completed', turnId, callId: 'c1', name: 'read_file', input: { path: 'a.txt' } }, options)
  assert.match(frame.liveLines[0], /read_file/)
  frame = reduceFrame(frame, { type: 'tool_result', turnId, callId: 'c1', content: 'body', isError: false }, options)
  assert.match(frame.liveLines.at(-1), /c1/)
})

test('宽度变化后重排不错位也不丢字', () => {
  const text = '这是一段用于检查换行重排的中文回答文本'
  const wide = renderTextLines(text, 40)
  const narrow = renderTextLines(text, 12)
  assert.equal(wide.join(''), text)
  assert.equal(narrow.join(''), text)
  assert.ok(narrow.length > wide.length)
  for (const line of narrow) {
    assert.ok(line.length > 0)
  }
})
