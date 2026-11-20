// 0.5.4：命令补全选中后回车直接执行。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'

test('0.5.4 选中 /help 回车直接执行而非报未知命令', async (t) => {
  const ui = await mountTty(t, { fullScreen: true, columns: 90, rows: 30, config: { model: 'fixture' }, provider: { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } } })
  await ui.send('/')
  await ui.waitFor((f) => f.includes('/help'), 3000)
  await ui.send('\r')
  await ui.waitFor((f) => f.includes('/models') && !f.includes('未知命令'), 4000)
  assert.doesNotMatch(ui.last(), /未知命令/)
})
