// L1 Ink + actual Core/Storage/Provider + local HTTP wire; no external models.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mountTty } from './helpers/mount-tty.mjs'
import { createConfiguredSession } from '../dist/tui/runtime.js'
import { createOpenAiProvider } from '../dist/provider/openai.js'
import { Session } from '../dist/core/session.js'
async function endpoint(t, handle) {
  const requests = []
  const server = createServer(async (req, res) => {
    let text = ''
    for await (const chunk of req) text += chunk
    const body = JSON.parse(text)
    requests.push({ body, key: req.headers.authorization, url: req.url })
    await handle(body, res, requests.length)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  return { baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', requests }
}
function stream(res, delta, reason = 'stop') {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  res.end(
    'data: ' +
      JSON.stringify({ choices: [{ delta, finish_reason: reason }] }) +
      '\n\ndata: [DONE]\n\n'
  )
}
const configured = ({ getConfig, gateway, configStore }) =>
  createConfiguredSession(getConfig, gateway, configStore)
test('W1 UI 配置两模型、隐藏密钥、真实 HTTP 切换和默认持久化', async (t) => {
  const a = await endpoint(t, (_, res) => stream(res, { content: 'wire-answer-A' }))
  const b = await endpoint(t, (_, res) => stream(res, { content: 'wire-answer-B' }))
  const ui = await mountTty(t, { sessionFactory: configured })
  for (const [label, url, key, model] of [
    ['a', a.baseUrl, 'fixture-key-A', 'model-A'],
    ['b', b.baseUrl, 'fixture-key-B', 'model-B']
  ]) {
    await ui.send('/provider add ' + label + ' ' + url + ' ' + model + '\r')
    await ui.send('/provider key ' + label + '\r')
    await ui.waitFor((frame) => frame.includes('隐藏输入'))
    await ui.send(key + '\r')
    await ui.waitFor((frame) => frame.includes('密钥已保存'))
  }
  await ui.send('/model a\r')
  await ui.send('first\r')
  await ui.waitFor((frame) => frame.includes('wire-answer-A') && !ui.session.isBusy)
  await ui.send('/model b\r')
  await ui.send('second\r')
  await ui.waitFor((frame) => frame.includes('wire-answer-B') && !ui.session.isBusy)
  assert.deepEqual(
    a.requests.map((r) => [r.body.model, r.key]),
    [['model-A', 'Bearer fixture-key-A']]
  )
  assert.deepEqual(
    b.requests.map((r) => [r.body.model, r.key]),
    [['model-B', 'Bearer fixture-key-B']]
  )
  assert.equal(b.requests[0].body.messages.at(-1).content, 'second')
  assert.ok(
    b.requests[0].body.messages.some(
      (m) => m.role === 'assistant' && m.content === 'wire-answer-A'
    )
  )
  await ui.send('/provider default b\r')
  const stored = ui.configStore.load()
  assert.equal(stored.defaultModelId, stored.models.find((m) => m.label === 'b').id)
  assert.equal(ui.raw().includes('fixture-key-A'), false)
  assert.equal(ui.raw().includes('fixture-key-B'), false)
})
test('W2 HTTP 鉴权失败可见、不污染历史，修正密钥后续聊', async (t) => {
  const api = await endpoint(t, (_, res, n) => {
    if (n === 1) {
      res.writeHead(401)
      res.end('{"error":{"code":"invalid_api_key"}}')
    } else stream(res, { content: 'wire-recovered' })
  })
  const ui = await mountTty(t, {
    sessionFactory: configured,
    config: { baseUrl: api.baseUrl, model: 'm', apiKey: 'fixture-invalid' }
  })
  await ui.send('fail\r')
  await ui.waitFor((frame) => frame.includes('401') && !ui.session.isBusy)
  assert.equal(ui.session.history.length, 0)
  await ui.send('/provider add good ' + api.baseUrl + ' m\r')
  await ui.send('/provider key good\r')
  await ui.send('fixture-valid\r')
  await ui.send('/model good\r')
  await ui.send('recover\r')
  await ui.waitFor((frame) => frame.includes('wire-recovered') && !ui.session.isBusy)
  assert.deepEqual(api.requests[1].body.messages, [{ role: 'user', content: 'recover' }])
  assert.equal(ui.raw().includes('fixture-invalid'), false)
  assert.equal(ui.raw().includes('fixture-valid'), false)
})
test('W3 Ink Esc 取消真实 HTTP reader，保留部分回答并能重新发起', async (t) => {
  let closed = false
  const api = await endpoint(t, (_, res, n) => {
    if (n > 1) {
      stream(res, { content: 'after-cancel' })
      return
    }
    res.on('close', () => (closed = true))
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(
      'data: ' +
        JSON.stringify({ choices: [{ delta: { content: 'wire-partial' } }] }) +
        '\n\n'
    )
  })
  const ui = await mountTty(t, {
    sessionFactory: configured,
    config: { baseUrl: api.baseUrl, model: 'm' }
  })
  await ui.send('long task\r')
  await ui.waitFor((frame) => frame.includes('wire-partial'))
  await ui.send('\x1b')
  await ui.waitFor(() => !ui.session.isBusy && closed)
  assert.match(ui.last(), /wire-partial/)
  await ui.send('next task\r')
  await ui.waitFor((frame) => frame.includes('after-cancel') && !ui.session.isBusy)
  assert.equal(api.requests.length, 2)
})
test('W4 真实 HTTP 工具回合与 Ink 审批拒绝、允许都续跑', async (t) => {
  for (const decision of ['n', 'y']) {
    let executions = 0
    const api = await endpoint(t, (body, res, n) => {
      if (n === 1) {
        assert.equal(body.tools[0].function.name, 'echo')
        stream(
          res,
          {
            tool_calls: [
              {
                index: 0,
                id: 'call-echo',
                type: 'function',
                function: { name: 'echo', arguments: '{"text":"ok"}' }
              }
            ]
          },
          'tool_calls'
        )
      } else {
        assert.ok(
          body.messages.some((m) => m.role === 'tool' && m.tool_call_id === 'call-echo')
        )
        stream(res, { content: 'tool-finished-' + decision })
      }
    })
    const ui = await mountTty(t, {
      sessionFactory: ({ gateway }) =>
        new Session({
          provider: createOpenAiProvider({ baseUrl: api.baseUrl }),
          approval: gateway,
          resolveSnapshot: () => ({
            modelId: 'fixture',
            model: 'm',
            baseUrlHost: new URL(api.baseUrl).host,
            capabilities: { tools: true }
          }),
          tools: [
            {
              name: 'echo',
              describe: () => 'fixture echo',
              requiresApproval: () => true,
              execute: async () => {
                executions++
                return 'echo-result'
              }
            }
          ]
        }),
      config: { model: 'm', baseUrl: api.baseUrl }
    })
    await ui.send('use echo\r')
    await ui.waitFor((frame) => frame.includes('需要审批'))
    await ui.send(decision)
    if (decision === 'n') {
      // SP003 T18c: n opens the optional feedback step; Esc denies.
      await ui.waitFor((frame) => frame.includes('拒绝反馈'))
      await ui.send('\x1b')
    }
    await ui.waitFor(
      (frame) => frame.includes('tool-finished-' + decision) && !ui.session.isBusy
    )
    assert.equal(executions, decision === 'y' ? 1 : 0)
    assert.equal(ui.gateway.pendingRequests.length, 0)
  }
})
