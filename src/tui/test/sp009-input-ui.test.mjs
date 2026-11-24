import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'

test('AC-INPUT-01/02 Ink 暂存草稿并要求确认长粘贴，全文保留', async (t) => {
  const requests = []
  const provider = {
    async *stream(request) {
      requests.push(request)
      yield { type: 'text_delta', text: 'OK' }
      yield { type: 'message_completed', finishReason: 'stop' }
    }
  }
  const ui = await mountTty(t, { config: { model: 'fixture' }, provider, fullScreen: true, rows: 28 })
  await ui.send('先前记录\r')
  await ui.waitFor(() => requests.length === 1 && !ui.session.isBusy)
  ui.stdin.write('\x1b[200~多行草稿\n第二行\x1b[201~')
  await ui.waitFor((frame) => frame.includes('第二行'))
  await ui.send('\x13')
  await ui.waitFor((frame) => frame.includes('草稿已暂存'))
  await ui.send('\x12')
  await ui.waitFor((frame) => frame.includes('搜索输入历史'))
  await ui.send('\x1b')
  await ui.send('\x13')
  await ui.waitFor((frame) => frame.includes('草稿已取回') && frame.includes('第二行'))
  assert.equal(requests.length, 1)

  await ui.send('\r')
  await ui.waitFor(() => requests.length === 2 && !ui.session.isBusy)
  const clipboard = '  长文本前缀\n' + '中'.repeat(10_001) + '\n尾行  '
  ui.stdin.write('\x1b[200~' + clipboard + '\x1b[201~')
  await ui.waitFor((frame) => frame.includes('长粘贴已折叠'))
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('再按 Enter 发送'))
  assert.equal(requests.length, 2)
  await ui.send('\r')
  await ui.waitFor(() => requests.length === 3 && !ui.session.isBusy)
  assert.equal(requests.at(-1).messages.filter((message) => message.role === 'user').at(-1).content, clipboard)
})
