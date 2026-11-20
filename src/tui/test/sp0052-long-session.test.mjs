// 0.5.2 长会话压测：真实 Ink 帧下的流式延迟与内存。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'
import { Session as SessionImpl } from '../dist/core/session.js'

// 默认规模刻意保持轻量：整套测试并行运行时，过重的夹具会让相邻用例
// 因资源争用偶发超时。需要更强压力时用 LONG_HISTORY / LONG_DELTAS / LONG_CHARS 覆盖。
const HISTORY = Number(process.env.LONG_HISTORY || 400)
const DELTAS = Number(process.env.LONG_DELTAS || 40)
const CHARS = Number(process.env.LONG_CHARS || 300)

test('0.5.2 长会话 + 长回答：无秒级卡顿帧', async (t) => {
  const provider = {
    async *stream() {
      for (let i = 0; i < DELTAS; i++) {
        yield { type: 'text_delta', text: 'sentence ' + i + ' ' + 'x'.repeat(CHARS) + ' ' }
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      yield { type: 'message_completed', finishReason: 'stop', usage: { inputTokens: 120000, outputTokens: 900 } }
    }
  }
  const ui = await mountTty(t, {
    fullScreen: true, columns: 100, rows: 40, provider, config: { model: 'fixture' },
    commandOverrides: {
      contextUsage: { usage: () => ({ usedTokens: 120000, maxTokens: 200000, percentUsed: 60, source: 'provider' }) },
      effort: { current: () => 'medium', set: () => {}, choices: ['low', 'medium', 'high'] }
    },
    sessionFactory: ({ gateway }) => {
      const session = new SessionImpl({
        provider,
        approval: gateway,
        resolveSnapshot: () => ({ modelId: 'm1', model: 'fixture', baseUrlHost: 'fixture.invalid', capabilities: { tools: false } })
      })
      const entries = []
      for (let i = 0; i < HISTORY; i++) {
        entries.push({ id: 'm' + (i * 2), role: 'user', blocks: [{ type: 'text', text: 'Question ' + i }] })
        entries.push({ id: 'm' + (i * 2 + 1), role: 'assistant', blocks: [{ type: 'text', text: 'Answer ' + i + ' with some content here. '.repeat(3) }] })
      }
      session.restoreHistory(entries)
      return session
    }
  })
  const gaps = []
  let last = Date.now()
  ui.stdout.on('data', () => { const now = Date.now(); gaps.push(now - last); last = now })
  const started = Date.now()
  ui.session.submit('go')
  await ui.waitFor(() => ui.session.isBusy === false, 30000)
  const elapsed = Date.now() - started
  const worst = gaps.length > 0 ? Math.max(...gaps) : 0
  console.log('history entries =', HISTORY * 2, '| stream =', elapsed, 'ms | frames =', gaps.length, '| worst gap =', worst, 'ms')
  // A visible freeze is a frame gap of a second or more; this scenario must
  // stay far below that.
  assert.ok(worst < 400, 'worst frame gap ' + worst + 'ms must stay under 400ms')
  assert.match(ui.last(), /上下文 60% · 120k\/200k/)
  assert.match(ui.last(), /⊙ medium · \/effort/)
})