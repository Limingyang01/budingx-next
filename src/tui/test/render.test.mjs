import assert from 'node:assert/strict'
import { renderToString } from 'ink'
import { createElement } from 'react'
import stringWidth from 'string-width'
import { collapseReadSearch, HistoryWindow, visibleHistoryRange } from '../dist/tui/render/history-window.js'
import { test } from 'node:test'
import { stripVTControlCharacters } from 'node:util'
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

test('流式和恢复转录均保留各段思考，助手正文连续', () => {
  const messageId = 'assistant-1'
  const content = [
    ['thinking', '初步'],
    ['thinking', '判断'],
    ['text', '阶段一。'],
    ['thinking', '再次核对'],
    ['text', '最终结论。']
  ]
  let live = initialFrame()
  for (const [kind, text] of content) {
    live = reduceFrame(live, { type: kind + '_delta', turnId, messageId, text })
  }
  live = reduceFrame(live, { type: 'message_completed', turnId, messageId })
  live = reduceFrame(live, { type: 'turn_finalized', turnId, outcome: 'completed' })
  assert.deepEqual(live.transcript.map(({ kind, text }) => [kind, text]), [
    ['thinking', '初步判断'],
    ['thinking', '再次核对'],
    ['assistant', '阶段一。最终结论。']
  ])
  assert.equal(live.lastAnswer, '阶段一。最终结论。')

  const restored = reduceFrame(initialFrame(), { type: 'conversation_restored', messages: [{
    id: messageId,
    role: 'assistant',
    blocks: content.map(([type, text]) => ({ type, text, signature: 'private protocol metadata' }))
  }] })
  assert.deepEqual(restored.transcript, live.transcript)
  const thinking = restored.transcript.filter((entry) => entry.kind === 'thinking')
  assert.ok(thinking.every((entry) => entry.id))
  assert.notEqual(thinking[0].id, thinking[1].id)
  assert.doesNotMatch(JSON.stringify(restored.transcript), /private protocol metadata/)
})

test('实时和恢复的超长思考限制在有限正文，并保留 Unicode 边界', () => {
  const messageId = 'assistant-large'
  const text = 'x'.repeat(8191) + '😀' + 'IGNORE_BEYOND_DISPLAY_BOUND'
  const live = reduceFrame(initialFrame(), { type: 'thinking_delta', turnId, messageId, text })
  const restored = reduceFrame(initialFrame(), { type: 'conversation_restored', messages: [{
    id: messageId,
    role: 'assistant',
    blocks: [{ type: 'thinking', text }]
  }] })
  assert.deepEqual(restored.transcript, live.transcript)
  const entry = restored.transcript[0]
  assert.equal(entry.truncated, true)
  assert.equal(entry.text, 'x'.repeat(8191))
})

test('工具结果按调用 ID 更新同一卡片，通知注入后只留系统转录', () => {
  const notification = '子代理「审核」已结束'
  let frame = reduceFrame(initialFrame(), {
    type: 'tool_call_completed', turnId, callId: 'call-1', name: 'Read', input: { path: 'a' }
  })
  frame = reduceFrame(frame, { type: 'tool_result', turnId, callId: 'call-1', content: 'first', isError: false })
  frame = reduceFrame(frame, { type: 'tool_result', turnId, callId: 'call-1', content: 'updated', isError: true })
  frame = reduceFrame(frame, { type: 'notice', level: 'info', code: 'agent_notification', text: notification })
  frame = reduceFrame(frame, {
    type: 'input_injected', turnId, queueId: 'notification', boundary: 'intra_turn',
    text: '<task-notification>raw</task-notification>', notification: true, display: notification
  })
  assert.deepEqual(frame.transcript.map(({ kind, text, status, result }) => [kind, text, status, result]), [
    ['tool', 'Read(a)', 'error', 'updated'],
    ['meta', notification, undefined, undefined]
  ])
  assert.equal(frame.notices.length, 0)
})

test('恢复有显示元数据的子代理通知不会把原始内容当作用户输入', () => {
  const display = '子代理「验证」已结束'
  const raw = '<task-notification>internal payload</task-notification>'
  const frame = reduceFrame(initialFrame(), { type: 'conversation_restored', messages: [
    { id: 'notice', role: 'user', notificationDisplay: display, blocks: [{ type: 'text', text: raw }] },
    { id: 'user', role: 'user', blocks: [{ type: 'text', text: raw }] }
  ] })
  assert.deepEqual(frame.transcript, [
    { kind: 'meta', text: display },
    { kind: 'user', text: raw }
  ])
})

test('Ink 折叠思考只占一行，单项切换覆盖全量切换，工具结果完整显示一次', () => {
  const entries = [
    { kind: 'thinking', id: 'a', text: '第一个摘要'.repeat(12) + '\nTHOUGHT_A_DETAIL' },
    { kind: 'thinking', id: 'b', text: 'Second summary\nTHOUGHT_B_DETAIL' },
    { kind: 'thinking', id: 'missing', text: '' },
    { kind: 'tool', text: 'Read(a)', turnId, callId: 'c', status: 'success', result: 'first row\nTOOL_DETAIL' },
    { kind: 'assistant', text: 'ANSWER_ONCE' }
  ]
  const columns = 37
  const render = (expanded, toggledIds = []) => renderToString(createElement(HistoryWindow, {
    entries, expanded, width: columns, height: 24, offset: 0, ascii: true, fullScreen: false,
    thinkingView: { selectedId: 'b', toggledIds: new Set(toggledIds) }
  }), { columns })
  const collapsed = render(false)
  assert.doesNotMatch(collapsed, /THOUGHT_[AB]_DETAIL|TOOL_DETAIL/)
  assert.match(stripVTControlCharacters(collapsed), /^\s*>.*Second summary/m)
  assert.match(collapsed, /Thinking text unavailable/i)
  assert.equal(collapsed.split('\n').filter((line) => line.includes('摘要')).length, 1)
  const individual = render(false, ['a'])
  assert.match(individual, /THOUGHT_A_DETAIL/)
  assert.doesNotMatch(individual, /THOUGHT_B_DETAIL|TOOL_DETAIL/)
  const allExceptOne = render(true, ['b'])
  assert.match(allExceptOne, /THOUGHT_A_DETAIL/)
  assert.doesNotMatch(allExceptOne, /THOUGHT_B_DETAIL/)
  assert.equal(allExceptOne.match(/TOOL_DETAIL/g)?.length, 1)
  assert.equal(allExceptOne.match(/ANSWER_ONCE/g)?.length, 1)
  assert.ok(collapsed.split('\n').every((line) => stringWidth(line) <= columns))
  assert.ok(allExceptOne.split('\n').every((line) => stringWidth(line) <= columns))
})

test('长转录首次挂载在中间偏移时直接显示该位置附近的思考段', () => {
  const entries = Array.from({ length: 480 }, (_, index) => (
    index === 300 ? { kind: 'thinking', id: 'restored', text: 'RESTORED_ANCHOR' }
      : { kind: 'plain', text: `entry ${index}` }
  ))
  const frame = renderToString(createElement(HistoryWindow, {
    entries, width: 60, height: 24, offset: 300, ascii: true, fullScreen: true, expanded: false,
    thinkingView: { selectedId: 'restored', toggledIds: new Set() },
    onTargetOffset: () => {},
    onPriorRowsChanged: () => {}
  }), { columns: 60 })
  assert.match(frame, /> Thinking - RESTORED_ANCHOR/)
  assert.doesNotMatch(frame, /entry 120|entry 450/)
})
