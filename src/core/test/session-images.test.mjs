// SP007 T7 RED→GREEN：会话图片链路（design §4.4，AC MM-07/08/09、PC-05）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from '../../tui/dist/core/session.js'

const IMG = { id: 1, mediaType: 'image/png', data: 'aGVsbG8=', width: 4, height: 4 }
function snap(vision) {
  return { modelId: 'm', model: 'm', baseUrlHost: 'h', capabilities: { tools: true, ...(vision === undefined ? {} : { vision }) } }
}
function textEvents(text) {
  return [{ type: 'text_delta', text }, { type: 'message_completed', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 5 } }]
}
function failEvents(message, cls = 'bad_request') {
  return [{ type: 'failed', error: { class: cls, code: 'BUDINGX_TEST', message, retryable: false } }]
}
function makeProvider(scripts) {
  let call = 0
  const requests = []
  return {
    requests,
    stream(request) {
      requests.push(request)
      const script = scripts[Math.min(call, scripts.length - 1)]
      call++
      return (async function* () { for (const e of script) yield e })()
    }
  }
}
function makeSession(provider, vision, extra = {}) {
  return new Session({
    provider,
    approval: { request: async () => ({ outcome: 'allow', via: 'user' }) },
    resolveSnapshot: () => snap(vision),
    permissionPolicy: { getMode: () => 'full_access', setMode: () => {}, decide: () => ({ action: 'allow', reason: 'ok' }), remember: () => {}, canRemember: () => true },
    queueAutostartMs: 100000,
    ...extra
  })
}
async function run(session) {
  const events = []
  session.on((e) => events.push(e))
  session.submit('describe', { images: [IMG] })
  const started = Date.now()
  while (session.isBusy && Date.now() - started < 5000) await new Promise((r) => setTimeout(r, 5))
  return events
}
function userContent(request) {
  return request.messages.find((m) => m.role === 'user').content
}

test('MM-07：submit images → user 消息含 image 块，请求 content 为 text＋image_url parts', async () => {
  const provider = makeProvider([textEvents('ok')])
  const session = makeSession(provider, true)
  await run(session)
  const content = userContent(provider.requests[0])
  assert.ok(Array.isArray(content))
  assert.equal(content[0].type, 'text')
  assert.match(content[0].text, /describe/)
  const img = content.find((p) => p.type === 'image_url')
  assert.equal(img.image_url.url, 'data:image/png;base64,aGVsbG8=')
  session.dispose()
})

test('MM-07：纯文本路径字节级不变（无 images → string content）', async () => {
  const provider = makeProvider([textEvents('ok')])
  const session = makeSession(provider, true)
  session.submit('hello')
  const started = Date.now()
  while (session.isBusy && Date.now() - started < 5000) await new Promise((r) => setTimeout(r, 5))
  assert.equal(typeof userContent(provider.requests[0]), 'string')
  session.dispose()
})

test('MM-08：vision===false → 前置拒绝 notice image_rejected，不发请求', async () => {
  const provider = makeProvider([textEvents('ok')])
  const session = makeSession(provider, false)
  const events = await run(session)
  assert.equal(provider.requests.length, 0)
  const notice = events.find((e) => e.type === 'notice' && e.code === 'image_rejected')
  assert.ok(notice)
  assert.equal(session.isBusy, false)
  session.dispose()
})

test('MM-08：vision 未知＋图片不支持错误 → 剥离图片重试一次成功，notice image_downgraded', async () => {
  const provider = makeProvider([
    failEvents('This model does not support image input'),
    textEvents('ok')
  ])
  const session = makeSession(provider, undefined)
  const events = await run(session)
  assert.equal(provider.requests.length, 2)
  // 首次请求带图，重试无图
  assert.ok(Array.isArray(userContent(provider.requests[0])))
  assert.equal(typeof userContent(provider.requests[1]), 'string')
  assert.ok(events.find((e) => e.type === 'notice' && e.code === 'image_downgraded'))
  const fin = events.find((e) => e.type === 'turn_finalized')
  assert.equal(fin.outcome, 'completed')
  session.dispose()
})

test('MM-08：降级重试仍失败 → outcome image_error', async () => {
  const provider = makeProvider([
    failEvents('This model does not support image input'),
    failEvents('This model does not support image input')
  ])
  const session = makeSession(provider, undefined)
  const events = await run(session)
  assert.equal(provider.requests.length, 2)
  const fin = events.find((e) => e.type === 'turn_finalized')
  assert.equal(fin.outcome, 'image_error')
  session.dispose()
})

test('MM-08：非图片 bad_request 不触发降级，正常 error', async () => {
  const provider = makeProvider([failEvents('invalid temperature value')])
  const session = makeSession(provider, undefined)
  const events = await run(session)
  assert.equal(provider.requests.length, 1)
  assert.ok(!events.find((e) => e.type === 'notice' && e.code === 'image_downgraded'))
  const fin = events.find((e) => e.type === 'turn_finalized')
  assert.equal(fin.outcome, 'error')
  session.dispose()
})

test('MM-09：请求内图片＞100 → 丢最旧＋可见 notice，请求保留 100 张', async () => {
  const provider = makeProvider([textEvents('ok')])
  const session = makeSession(provider, true)
  const images = Array.from({ length: 105 }, (_, i) => ({ ...IMG, id: i + 1, data: 'a' + i }))
  const events = []
  session.on((e) => events.push(e))
  session.submit('many', { images })
  const started = Date.now()
  while (session.isBusy && Date.now() - started < 5000) await new Promise((r) => setTimeout(r, 5))
  const content = userContent(provider.requests[0])
  const imgParts = content.filter((p) => p.type === 'image_url')
  assert.equal(imgParts.length, 100)
  // 保留最新 100 张（id 6..105），丢弃最旧 5 张
  assert.equal(imgParts[0].image_url.url, 'data:image/png;base64,a5')
  assert.ok(events.find((e) => e.type === 'notice' && /100/.test(e.text)))
  session.dispose()
})

test('PC-05：工具参数非法 JSON → <tool_use_error>InputValidationError 回灌不中断', async () => {
  const provider = makeProvider([
    [
      { type: 'tool_call_delta', index: 0, callId: 'c1', nameDelta: 'Read', argsDelta: '{bad json' },
      { type: 'message_completed', finishReason: 'tool_calls', usage: { inputTokens: 5, outputTokens: 5 } }
    ],
    textEvents('recovered')
  ])
  const tools = [{ name: 'Read', describe: () => 'Read', capability: () => 'read', execute: async () => 'file' }]
  const session = makeSession(provider, true, { tools })
  const results = []
  session.on((e) => { if (e.type === 'tool_result') results.push(e) })
  session.submit('go')
  const started = Date.now()
  while (session.isBusy && Date.now() - started < 5000) await new Promise((r) => setTimeout(r, 5))
  assert.equal(results.length, 1)
  assert.equal(results[0].isError, true)
  assert.match(results[0].content, /^<tool_use_error>InputValidationError:/)
  assert.match(results[0].content, /<\/tool_use_error>/)
  const fin = []
  session.on((e) => { if (e.type === 'turn_finalized') fin.push(e) })
  session.dispose()
})
