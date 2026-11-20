// 0.5.4 面板级回归：/resume /context /rewind 交互面板。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'

const idle = { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } }

test('0.5.4 /resume 打开当前工作区会话选择面板', async (t) => {
  const ui = await mountTty(t, {
    fullScreen: true, columns: 90, rows: 24, provider: idle, config: { model: 'fixture' },
    commandOverrides: { sessions: { list: () => [{ sessionId: 's1', title: '旧会话', updatedAt: '2026-11-20', turns: 3 }], resume: () => ({ ok: true, messages: [] }) } }
  })
  await ui.send('/resume\r')
  await ui.waitFor((f) => f.includes('恢复会话') && f.includes('旧会话'), 4000)
  await ui.send('\x1b')
})

test('0.5.4 /context 打开占用网格面板', async (t) => {
  const ui = await mountTty(t, {
    fullScreen: true, columns: 90, rows: 24, provider: idle, config: { model: 'fixture' },
    commandOverrides: {
      contextUsage: { usage: () => ({ usedTokens: 50000, maxTokens: 200000, percentUsed: 25, source: 'provider' }) },
      context: { budget: () => ({ estimatedTokens: 50000, maxTokens: 200000, reservedOutputTokens: 50000, triggerTokens: 127500, messages: 10, breakdown: [] }) }
    }
  })
  await ui.send('/context\r')
  await ui.waitFor((f) => f.includes('上下文窗口占用') && f.includes('System'), 4000)
  await ui.send('\x1b')
})

test('0.5.4 /rewind 打开检查点面板并回滚', async (t) => {
  const ui = await mountTty(t, { fullScreen: true, columns: 90, rows: 24, provider: idle, config: { model: 'fixture' } })
  ui.session.submit('第一个问题')
  await ui.waitFor(() => !ui.session.isBusy, 4000)
  ui.session.submit('第二个问题')
  await ui.waitFor(() => !ui.session.isBusy, 4000)
  await ui.send('/rewind\r')
  await ui.waitFor((f) => f.includes('回滚到检查点') && f.includes('第一个问题'), 4000)
  await ui.send('\x1b')
})
