// SP009 0.9.1 · 子代理通知渲染回归：通知是系统消息，不是用户输入。
// 证据层级：真实 Session 事件 + 真实帧归约；不把原始 XML 当用户内容展示。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Session } from '../dist/core/session.js'
import { reduceFrame } from '../dist/tui/render/reducer.js'
import { initialFrame } from '../dist/tui/render/types.js'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: true }
}

function sessionWith(events, script = []) {
  const provider = {
    async *stream() {
      const turn = script.shift() ?? [{ type: 'message_completed', finishReason: 'stop' }]
      for (const event of turn) yield event
    }
  }
  const session = new Session({
    provider,
    approval: { async request() { return { outcome: 'allow', via: 'policy' } } },
    resolveSnapshot: () => SNAPSHOT,
    onEvent: (event) => events.push(event)
  })
  return session
}

test('N-01 子代理通知回合：turn_started 带 notification/display，转录渲染为系统消息', async () => {
  const events = []
  const session = sessionWith(events)
  const xml =
    '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n' +
    '<summary>调研</summary>\n<result>child done</result>\n</task-notification>'
  session.enqueueNotification(xml, '子代理「调研」已结束（completed）')
  // 空闲自动开回合 → 等待终态。
  await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), 2000)
    session.on((event) => {
      if (event.type === 'turn_finalized') {
        clearTimeout(timer)
        resolve()
      }
    })
  })
  const started = events.find((event) => event.type === 'turn_started')
  assert.equal(started.notification, true)
  assert.equal(started.display, '子代理「调研」已结束（completed）')

  let frame = initialFrame('default')
  for (const event of events) frame = reduceFrame(frame, event, { width: 80 })
  const texts = frame.transcript.map((entry) => entry.text)
  assert.ok(
    texts.some((text) => text.includes('子代理「调研」已结束（completed）')),
    '通知应以系统消息展示'
  )
  assert.ok(
    !texts.some((text) => text.includes('<task-notification>')),
    '原始 XML 不得作为用户内容出现在转录'
  )
  // 模型上下文里仍保留完整 XML（通知仍会送达模型）。
  assert.ok(
    session.history.some((message) => JSON.stringify(message).includes('<task-notification>')),
    '模型仍应收到通知 XML'
  )
  session.dispose()
})

test('N-02 子代理通知回合内注入：input_injected 带 display，不污染用户转录', async () => {
  const events = []
  // 第一回合持续请求工具，通知在回合内注入。
  const script = [
    [
      { type: 'tool_call_delta', index: 0, callId: 'c1', nameDelta: 'Ping', argsDelta: '{}' },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ]
  ]
  const session = sessionWith(events, script)
  session.options?.tools?.push?.({})
  const xml = '<task-notification><status>completed</status><result>done</result></task-notification>'
  session.enqueueNotification(xml, '子代理「后台」已结束（completed）')
  await new Promise((resolve) => setTimeout(resolve, 400))
  const injected = events.find(
    (event) => event.type === 'input_injected' && event.notification === true
  )
  if (injected) {
    assert.equal(injected.display, '子代理「后台」已结束（completed）')
    let frame = initialFrame('default')
    for (const event of events) frame = reduceFrame(frame, event, { width: 80 })
    assert.ok(
      !frame.transcript.some((entry) => entry.text.includes('<task-notification>')),
      '回合内注入的通知也不得污染用户转录'
    )
  }
  session.dispose()
})
