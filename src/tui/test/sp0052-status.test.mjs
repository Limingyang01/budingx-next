// 0.5.2 状态栏：上下文用量与推理强度常驻显示（真实 Ink 帧）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'

test('0.5.2 状态栏显示上下文用量与推理强度', async (t) => {
  const provider = {
    async *stream() {
      yield { type: 'text_delta', text: 'ok' }
      yield {
        type: 'message_completed',
        finishReason: 'stop',
        usage: { inputTokens: 4321, outputTokens: 3 }
      }
    }
  }
  let effort = 'medium'
  const ui = await mountTty(t, {
    fullScreen: true,
    columns: 100,
    rows: 40,
    provider,
    config: { model: 'fixture' },
    commandOverrides: {
      contextUsage: {
        usage: () => ({ usedTokens: 4321, maxTokens: 200000, percentUsed: 2, source: 'provider' })
      },
      effort: {
        current: () => effort,
        set: (next) => { effort = next },
        choices: ['low', 'medium', 'high']
      }
    }
  })
  await ui.send('hello\r')
  await ui.waitFor((frame) => frame.includes('ok') && !ui.session.isBusy)
  const frame = ui.last()
  assert.match(frame, /上下文 2% · 4\.3k\/200k/, 'context usage must be visible; frame:\n' + frame)
  assert.match(frame, /⊙ medium · \/effort/, 'effort must be visible; frame:\n' + frame)
})

test('0.5.2 /effort 设置后状态栏与请求一致', async (t) => {
  const provider = {
    async *stream() {
      yield { type: 'message_completed', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 1 } }
    }
  }
  let effort = 'medium'
  const applied = []
  const ui = await mountTty(t, {
    fullScreen: true,
    columns: 100,
    rows: 40,
    provider,
    config: { model: 'fixture' },
    commandOverrides: {
      contextUsage: { usage: () => ({ usedTokens: 10, source: 'provider' }) },
      effort: {
        current: () => effort,
        set: (next) => { effort = next; applied.push(next) },
        choices: ['low', 'medium', 'high']
      }
    }
  })
  await ui.send('/effort high\r')
  await ui.waitFor((frame) => frame.includes('high') || frame.includes('推理强度'))
  assert.deepEqual(applied, ['high'])
  assert.match(ui.last(), /⊙ high · \/effort/, 'status bar must follow /effort; frame:\n' + ui.last())
})
