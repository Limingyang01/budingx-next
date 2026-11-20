// 0.5.4 命令菜单：/ 唤起全部、短描述、单一 permissions。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'
import { commandCandidates } from '../dist/tui/render/completion.js'

test('0.5.4 commandCandidates 不再截断为 5', () => {
  const names = ['help','models','permissions','rules','diff','undo','rewind','clear','new','resume','context','compact','cost','plan','exit']
  const all = commandCandidates('', names)
  assert.equal(all.length, names.length)
})

test('0.5.4 / 菜单显示全部命令+短描述，无[命令]文案，单一 permissions', async (t) => {
  const ui = await mountTty(t, { fullScreen: true, columns: 90, rows: 40, config: { model: 'fixture' }, provider: { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } } })
  await ui.send('/')
  await ui.waitFor((f) => f.includes('/permissions') && f.includes('权限白名单'), 3000)
  const frame = ui.last()
  assert.doesNotMatch(frame, /\[命令\]|\[cmd\]/)
  // 向下导航可到达更多命令（超过旧的 5 条上限）
  for (let i = 0; i < 12; i++) await ui.send('\x1b[B')
  await ui.waitFor((f) => /\/cost|\/plan|\/exit|\/memory/.test(f), 3000)
  await ui.send('\x1b')
})
