// 0.5.4：短终端首屏仍显示模型/端点/工作目录，不再只剩 logo 一行。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'

test('0.5.4 短终端（rows<18）首屏保留模型与工作目录行', async (t) => {
  const ui = await mountTty(t, {
    fullScreen: true, columns: 100, rows: 14,
    config: { model: 'fixture-model', baseUrl: 'https://fixture.invalid/v1', apiKey: 'k' }
  })
  await ui.waitFor((frame) => frame.includes('fixture-model') && frame.includes('fixture.invalid'), 4000)
  const frame = ui.last()
  assert.match(frame, /budingx v/)
  assert.match(frame, /fixture-model/)
})
