import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'

test('AC-TRANSCRIPT-01 · Ink 帧依次保留思考、工具运行与结果、回答和系统通知', async (t) => {
  const { promise: requestTool, resolve: finishThinking } = Promise.withResolvers()
  const { promise: pendingRead, resolve: finishRead } = Promise.withResolvers()
  t.after(() => {
    finishThinking()
    finishRead('READ_RESULT')
  })
  let requests = 0
  const ui = await mountTty(t, {
    fullScreen: true, strategy: 'ascii', columns: 78, rows: 40, config: { model: 'fixture' },
    tools: [
      { name: 'Read', describe: () => 'read', execute: () => pendingRead },
      { name: 'Find', describe: () => 'find', execute: async () => { throw new Error('FIND_FAILURE') } }
    ],
    provider: { async *stream() {
      if (requests++ === 0) {
        yield { type: 'thinking_delta', text: 'THINK_SUMMARY\nTHINK_DETAILS', signature: 'PRIVATE_SIGNATURE' }
        await requestTool
        yield { type: 'tool_call_delta', index: 0, callId: 'read-1', nameDelta: 'Read', argsDelta: '{"path":"a.txt"}' }
        yield { type: 'tool_call_delta', index: 1, callId: 'find-1', nameDelta: 'Find', argsDelta: '{"pattern":"needle"}' }
        yield { type: 'message_completed', finishReason: 'tool_calls' }
        return
      }
      yield { type: 'text_delta', text: 'FINAL_ANSWER' }
      yield { type: 'message_completed', finishReason: 'stop' }
    } }
  })
  t.after(() => rmSync(ui.root, { recursive: true, force: true }))

  await ui.send('read the fixture\r')
  const thinking = await ui.waitFor((frame) => frame.includes('THINK_SUMMARY'))
  assert.doesNotMatch(thinking, /THINK_DETAILS|FINAL_ANSWER/)

  finishThinking()
  const pending = await ui.waitFor((frame) => frame.includes('* Read(a.txt)'))
  assert.doesNotMatch(pending, /READ_RESULT|FIND_FAILURE/)
  ui.session.enqueueNotification('<task-notification>INTERNAL_XML</task-notification>', 'AGENT_FINISHED')
  finishRead('READ_RESULT\nREAD_MORE')

  const done = await ui.waitFor((frame) =>
    !ui.session.isBusy && frame.includes('FINAL_ANSWER') && frame.includes('AGENT_FINISHED'))
  assert.match(done, /\+ Read\(a.txt\)/)
  assert.match(done, /! Find\(needle\)/)
  for (const text of ['THINK_SUMMARY', 'READ_RESULT', 'FIND_FAILURE', 'FINAL_ANSWER', 'AGENT_FINISHED']) {
    assert.equal(done.split(text).length - 1, 1, text)
  }
  assert.doesNotMatch(ui.raw(), /INTERNAL_XML|PRIVATE_SIGNATURE/)
})

test('AC-TRANSCRIPT-02 · 转录模式可以展开、收起指定的思考段', async (t) => {
  const ui = await mountTty(t, {
    strategy: 'ascii', fullScreen: true, columns: 78, rows: 30, config: { model: 'fixture' },
    provider: {
      async *stream() {
        yield { type: 'thinking_delta', text: 'REASONING_SUMMARY\nREASONING_DETAILS' }
        yield { type: 'text_delta', text: 'FINAL_RESPONSE' }
        yield { type: 'message_completed', finishReason: 'stop' }
      }
    }
  })
  t.after(() => rmSync(ui.root, { recursive: true, force: true }))
  await ui.send('show reasoning\r')
  await ui.waitFor((frame) => frame.includes('FINAL_RESPONSE'))
  await ui.send('\x0f')
  await ui.waitFor((frame) => frame.includes('Ctrl+E expand all'))
  await ui.send('\x1b[A')
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('REASONING_DETAILS'))
  await ui.send('\r')
  await ui.waitFor((frame) => !frame.includes('REASONING_DETAILS'))
  await ui.send('\x05')
  await ui.waitFor((frame) => frame.includes('REASONING_DETAILS'))
  await ui.send('\x0f')
  await ui.waitFor((frame) => !frame.includes('REASONING_DETAILS'))
})

test('同一助手消息的正文在思考增量前后保持连续', async (t) => {
  for (const [prefix, suffix] of [
    ['今天是 2', '026-11-24（周二）。'],
    ['子', 'agent 已返回 9 条新闻。']
  ]) {
    for (const columns of [112, 36]) {
      await t.test(prefix + ' / ' + columns, async (t) => {
        const { promise: finish, resolve: finishMessage } = Promise.withResolvers()
        t.after(finishMessage)
        const ui = await mountTty(t, {
          strategy: 'ascii', fullScreen: true, columns, rows: 32,
          config: { model: 'fixture' },
          provider: { async *stream() {
            yield { type: 'text_delta', text: prefix }
            yield { type: 'thinking_delta', text: 'TRACE_THINK' }
            yield { type: 'text_delta', text: suffix }
            await finish
            yield { type: 'message_completed', finishReason: 'stop' }
          } }
        })
        t.after(() => rmSync(ui.root, { recursive: true, force: true }))
        const messageIds = new Set()
        const off = ui.session.on((event) => {
          if (event.type === 'text_delta' || event.type === 'thinking_delta') messageIds.add(event.messageId)
        })
        t.after(off)

        await ui.send('check continuity\r')
        const live = await ui.waitFor((frame) => frame.includes(suffix) && frame.includes('TRACE_THINK'))
        finishMessage()
        const done = await ui.waitFor((frame) => !ui.session.isBusy && frame.includes(suffix))
        assert.equal(messageIds.size, 1)
        for (const frame of [live, done]) {
          assert.equal(frame.split(prefix + suffix).length - 1, 1, frame)
          assert.equal(frame.split('TRACE_THINK').length - 1, 1)
        }
      })
    }
  }
})
