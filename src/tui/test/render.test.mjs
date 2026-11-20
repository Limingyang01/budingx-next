import assert from 'node:assert/strict'
import { collapseReadSearch, visibleHistoryRange } from '../dist/tui/render/history-window.js'
import { test } from 'node:test'
import { reduceFrame, renderTextLines } from '../dist/tui/render/reducer.js'
import { initialFrame } from '../dist/tui/render/types.js'

const turnId = 'turn-1'

test('增量文本按帧合并而不是逐字符重排', () => {
  let frame = initialFrame()
  frame = reduceFrame(
    frame,
    {
      type: 'turn_started',
      turnId,
      snapshot: {
        modelId: 'm',
        model: 'x',
        baseUrlHost: 'h',
        capabilities: { tools: false }
      }
    },
    { width: 40 }
  )
  let accumulated = ''
  for (const character of '你好世界') {
    accumulated += character
    frame = reduceFrame(
      frame,
      { type: 'text_delta', turnId, messageId: 'm1', text: character },
      { width: 40 }
    )
    // The live text accumulates; it is not re-wrapped into lines per delta
    // (that quadratic re-wrap was the long-session lag cause).
    assert.equal(frame.liveText, accumulated)
    assert.equal(frame.transcript.length, 0)
  }
  assert.equal(frame.liveText, '你好世界')
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
  frame = reduceFrame(
    frame,
    {
      type: 'turn_started',
      turnId,
      snapshot: {
        modelId: 'm',
        model: 'x',
        baseUrlHost: 'h',
        capabilities: { tools: false }
      }
    },
    { width: 40 }
  )
  frame = reduceFrame(
    frame,
    { type: 'text_delta', turnId, messageId: 'm1', text: '答案' },
    { width: 40 }
  )
  frame = reduceFrame(
    frame,
    { type: 'message_completed', turnId, messageId: 'm1' },
    { width: 40 }
  )
  assert.equal(frame.liveText, '')
  assert.equal(frame.transcript.length, 1)
  assert.equal(frame.transcript[0].kind, 'assistant')
  assert.equal(frame.transcript[0].text, '答案')
  frame = reduceFrame(
    frame,
    { type: 'turn_finalized', turnId, outcome: 'completed' },
    { width: 40 }
  )
  // The finished answer stays in the transcript exactly once.
  assert.equal(frame.transcript.filter((entry) => entry.kind === 'assistant').length, 1)
  assert.equal(frame.transcript[0].text, '答案')
})

test('事件流回放得到排队指示、审批卡与状态', () => {
  let frame = initialFrame()
  const options = { width: 40 }
  frame = reduceFrame(
    frame,
    { type: 'input_queued', queueId: 'q1', preview: '补充' },
    options
  )
  assert.deepEqual(frame.queue, [{ id: 'q1', preview: '补充' }])
  frame = reduceFrame(
    frame,
    { type: 'input_injected', turnId, queueId: 'q1', boundary: 'intra_turn' },
    options
  )
  assert.deepEqual(frame.queue, [])
  frame = reduceFrame(
    frame,
    {
      type: 'approval_requested',
      turnId,
      requestId: 'r1',
      callId: 'c1',
      name: 'read_file',
      summary: 'read a.txt'
    },
    options
  )
  assert.equal(frame.approval.requestId, 'r1')
  frame = reduceFrame(
    frame,
    { type: 'approval_resolved', turnId, requestId: 'r1', outcome: 'allow', via: 'user' },
    options
  )
  assert.equal(frame.approval, undefined)
  frame = reduceFrame(frame, { type: 'status', state: 'streaming' }, options)
  assert.equal(frame.status.state, 'streaming')
  frame = reduceFrame(
    frame,
    { type: 'notice', level: 'warning', code: 'api_retry', text: 'retrying' },
    options
  )
  assert.equal(frame.notices.at(-1).text, 'retrying')
  frame = reduceFrame(
    frame,
    {
      type: 'turn_finalized',
      turnId,
      outcome: 'error',
      error: {
        class: 'auth',
        code: 'BUDINGX_PROVIDER_001',
        message: 'bad key',
        retryable: false
      }
    },
    options
  )
  assert.equal(frame.error, 'bad key')
})

test('工具调用与结果进入 live 区', () => {
  let frame = initialFrame()
  const options = { width: 40 }
  frame = reduceFrame(
    frame,
    {
      type: 'tool_call_completed',
      turnId,
      callId: 'c1',
      name: 'read_file',
      input: { path: 'a.txt' }
    },
    options
  )
  const toolEntry = frame.transcript.at(-1)
  assert.equal(toolEntry.kind, 'tool')
  assert.match(toolEntry.text, /read_file/)
  assert.equal(toolEntry.status, 'pending')
  frame = reduceFrame(
    frame,
    { type: 'tool_result', turnId, callId: 'c1', content: 'body', isError: false },
    options
  )
  const settled = frame.transcript.at(-1)
  assert.equal(settled.kind, 'tool')
  assert.equal(settled.status, 'success')
  assert.equal(settled.result, 'body')
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

test('G10/G11 回收指示清除且工具内容在终态保留', () => {
  let f = initialFrame()
  f = reduceFrame(f, { type: 'input_queued', queueId: 'q', preview: 'pending' })
  f = reduceFrame(f, {
    type: 'notice',
    level: 'info',
    code: 'queue_recycled',
    text: 'recycled'
  })
  assert.equal(f.queue.length, 0)
  f = reduceFrame(f, {
    type: 'tool_call_completed',
    turnId,
    callId: 'c',
    name: 'echo',
    input: {}
  })
  f = reduceFrame(f, {
    type: 'tool_result',
    turnId,
    callId: 'c',
    content: 'result body',
    isError: false
  })
  f = reduceFrame(f, { type: 'text_delta', turnId, messageId: 'm', text: 'answer' })
  f = reduceFrame(f, { type: 'turn_finalized', turnId, outcome: 'completed' })
  const tool = f.transcript.find((entry) => entry.kind === 'tool')
  assert.ok(tool, 'the tool call must stay in the transcript')
  assert.match(tool.text, /echo/)
  assert.match(tool.result, /result body/)
  assert.equal(tool.status, 'success')
})


test('virtual transcript selects a bounded range in a long history', () => {
  const offsets = Array.from({ length: 10001 }, (_, index) => index * 2)
  const range = visibleHistoryRange(offsets, 14000, 24)
  assert.ok(range.start < 7000 && range.end > 7000)
  assert.ok(range.end - range.start < 50)
})

test('only consecutive successful reads and searches in one turn are collapsed', () => {
  const row = (text, callId, status = 'success', turnId = 't') =>
    ({ kind: 'tool', text, callId, status, turnId, result: 'fixture' })
  const first = row('Read(a.ts)', '1')
  const second = row('Grep(needle)', '2')
  const error = row('Grep(failed)', '3', 'error')
  const nextTurn = row('Read(b.ts)', '4', 'success', 'next')
  const result = collapseReadSearch([first, second, error, nextTurn], false)
  assert.match(result[0].text, /2 次读取／搜索/)
  assert.deepEqual(result.slice(1), [error, nextTurn])
  assert.equal(result[0].result, 'Ctrl+O 展开详情')
})
