// 0.5.4：流式阶段显示「正在思考」，不再出现「流式输出」措辞（真实 Ink 帧）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'

test('0.5.4 流式输出阶段状态栏显示正在思考而非流式输出', async (t) => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const provider = {
    async *stream() {
      yield { type: 'text_delta', text: 'partial answer' }
      await gate // hold the stream open so the streaming state is observable
      yield { type: 'message_completed', finishReason: 'stop' }
    }
  }
  const ui = await mountTty(t, {
    fullScreen: true, columns: 100, rows: 40, provider, config: { model: 'fixture' }
  })
  ui.session.submit('hello')
  await ui.waitFor((frame) => frame.includes('正在思考'), 5000)
  const frame = ui.last()
  assert.match(frame, /正在思考/)
  assert.doesNotMatch(frame, /流式输出/)
  assert.doesNotMatch(frame, /请求中/)
  release()
  await ui.waitFor(() => !ui.session.isBusy, 5000)
})
