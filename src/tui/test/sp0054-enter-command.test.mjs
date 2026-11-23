// 0.5.4：命令补全选中后回车直接执行。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'

test('0.5.4 选中 /help 回车直接执行而非报未知命令', async (t) => {
  const ui = await mountTty(t, { fullScreen: true, columns: 90, rows: 30, config: { model: 'fixture' }, provider: { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } } })
  await ui.send('/')
  await ui.waitFor((f) => f.includes('/help'), 3000)
  await ui.send('\r')
  // 帮助正文较长，全屏下只渲染可见部分；用累计输出断言「帮助已执行」这一契约，
  // 而不是依赖某一帧恰好包含某一行（Ink 局部重绘顺序不稳定）。
  await ui.waitFor(() => ui.raw().includes('命令：') && !ui.last().includes('未知命令'), 4000)
  assert.doesNotMatch(ui.last(), /未知命令/)
  assert.match(ui.raw(), /命令：/)
})
