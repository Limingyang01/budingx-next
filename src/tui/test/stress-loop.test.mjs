// 回归：长会话 + 多回合 + resize 不应触发 React 无限重渲染（Maximum update depth）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'

test('regression: long session many turns and resizes do not loop', async (t) => {
  const errors = []
  const origError = console.error
  console.error = (...args) => { errors.push(args.map((a) => String(a && a.stack ? a.stack : a)).join(' ')); origError(...args) }
  t.after(() => { console.error = origError })
  let n = 0
  const ui = await mountTty(t, {
    fullScreen: true, columns: 100, rows: 30,
    config: { model: 'fixture' },
    provider: { async *stream() {
      n += 1
      for (let i = 0; i < 5; i++) yield { type: 'text_delta', text: 'row ' + n + '.' + i + ' ' }
      yield { type: 'message_completed', finishReason: 'stop' }
    } }
  })
  for (let turn = 0; turn < 80; turn++) {
    ui.session.submit('q' + turn)
    await ui.waitFor(() => !ui.session.isBusy, 8000)
  }
  await ui.resize(70, 24)
  await ui.waitFor((f) => f.includes('q79'), 4000)
  await ui.resize(110, 34)
  await ui.waitFor((f) => f.includes('q79'), 4000)
  assert.deepEqual(errors.filter((e) => /Maximum update depth|infinite/i.test(e)), [])
})
