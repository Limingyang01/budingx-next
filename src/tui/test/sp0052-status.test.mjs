// 状态栏与推理强度选择（真实 Ink 帧）。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { createAgentRuntime } from '../dist/tui/runtime.js'
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
        usage: () => ({ usedTokens: 84000, maxTokens: 256000, percentUsed: 32.8, source: 'provider' })
      },
      effort: {
        current: () => effort,
        set: (next) => { effort = next },
        choices: ['low', 'medium', 'high']
      }
    }
  })
  await ui.send('hello')
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('ok') && !ui.session.isBusy)
  const frame = ui.last()
  assert.match(frame, /⊙ 中 · \/effort · 84k\/256k tokens \(32\.8%\)/)
})

test('/effort opens the selector, can cancel, and sends the chosen level to the model', async (t) => {
  const requests = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":84000,"completion_tokens":1}}\n\ndata: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  await once(server, 'listening')
  const commandOverrides = {}
  const ui = await mountTty(t, {
    fullScreen: true,
    columns: 100,
    rows: 40,
    config: { model: 'fixture', baseUrl: `http://127.0.0.1:${server.address().port}/v1` },
    commandOverrides,
    sessionFactory: ({ gateway, getConfig, configStore }) => {
      const runtime = createAgentRuntime({
        cwd: process.cwd(), getConfig, configStore, approval: gateway,
        contextBudget: { maxTokens: 256000 }
      })
      commandOverrides.effort = runtime.effort
      commandOverrides.contextUsage = runtime.contextUsage
      return runtime.session
    }
  })
  async function submit(line) {
    await ui.send(line)
    await ui.send('\r')
  }
  await submit('/effort')
  await ui.waitFor((frame) => frame.includes('选择思考强度'))
  await ui.send('\x1b[B')
  await ui.send('\x1b')
  await ui.waitFor((frame) => !frame.includes('选择思考强度') && frame.includes('⊙ 中 · /effort'))
  await submit('/effort')
  await ui.waitFor((frame) => frame.includes('选择思考强度'))
  await ui.send('\x1b[B')
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('⊙ 高 · /effort'))
  await submit('hello')
  await ui.waitFor((frame) => !ui.session.isBusy && frame.includes('84k/256k tokens (32.8%)'))
  assert.deepEqual(requests.map((body) => body.reasoning_effort), ['high'])
  await submit('/effort low')
  await ui.waitFor((frame) => frame.includes('⊙ 低 · /effort'))
  await submit('again')
  await ui.waitFor(() => requests.length === 2 && !ui.session.isBusy)
  assert.deepEqual(requests.map((body) => body.reasoning_effort), ['high', 'low'])
})
