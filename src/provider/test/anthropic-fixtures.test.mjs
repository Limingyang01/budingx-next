// SP007 T2 PC-04：Anthropic 协议 fixture——错误分类/重试/取消/截断/多工具/错误参数。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAnthropicProvider } from '../../tui/dist/provider/anthropic.js'
import { sseResponse, fakeFetch, collect, startFrame, textBlock, toolBlock, deltaFrame, stopFrame } from './anthropic-helpers.mjs'

const BASE = 'https://api.anthropic.example'
const okStream = () => sseResponse([startFrame(), ...textBlock(0, 'ok'), deltaFrame('end_turn', 2), stopFrame])

test('HTTP 错误分类：401/403 auth、404 not_found、429 rate_limited、529 overloaded、400 bad_request；不泄漏 key', async () => {
  for (const [status, expected] of [[401, 'auth'], [403, 'auth'], [404, 'not_found'], [429, 'rate_limited'], [529, 'overloaded'], [400, 'bad_request']]) {
    const fetchImpl = fakeFetch(() => new Response('upstream secret body sk-ant-test', { status }))
    const provider = createAnthropicProvider({ baseUrl: BASE, apiKey: 'sk-ant-test', fetchImpl, limits: { maxAttempts: 1 } })
    const events = await collect(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    const failure = events.find((e) => e.type === 'failed')
    assert.ok(failure, String(status))
    assert.equal(failure.error.class, expected, String(status))
    assert.equal(failure.error.status, status)
    assert.equal(failure.error.message.includes('sk-ant-test'), false)
    assert.equal(failure.error.message.includes('upstream secret'), false)
  }
})

test('400 prompt is too long→context_overflow（不静默截断历史）', async () => {
  const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long: 250000 tokens > 200000 maximum' } }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
  const provider = createAnthropicProvider({ baseUrl: BASE, fetchImpl, limits: { maxAttempts: 1 } })
  const events = await collect(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(events.find((e) => e.type === 'failed').error.class, 'context_overflow')
})

test('401 静态 key 不重试（maxAttempts 3 仅一次请求）', async () => {
  const fetchImpl = fakeFetch(() => new Response('no', { status: 401 }))
  const provider = createAnthropicProvider({ baseUrl: BASE, apiKey: 'k', fetchImpl, limits: { maxAttempts: 3 }, sleep: async () => {} })
  const events = await collect(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(fetchImpl.calls.length, 1)
  assert.equal(events.filter((e) => e.type === 'retry').length, 0)
  assert.equal(events.find((e) => e.type === 'failed').error.class, 'auth')
})

test('429 重试尊重 Retry-After，达上限明确失败不无界重试', async () => {
  const fetchImpl = fakeFetch(() => new Response('slow', { status: 429, headers: { 'Retry-After': '2' } }))
  const delays = []
  const provider = createAnthropicProvider({ baseUrl: BASE, fetchImpl, limits: { maxAttempts: 3 }, sleep: async (ms) => { delays.push(ms) } })
  const events = await collect(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(fetchImpl.calls.length, 3)
  assert.deepEqual(delays, [2000, 2000])
  const retries = events.filter((e) => e.type === 'retry')
  assert.equal(retries.length, 2)
  assert.equal(retries[0].errorClass, 'rate_limited')
  assert.equal(events.find((e) => e.type === 'failed').error.class, 'rate_limited')
})

test('529 后恢复：重试成功产出完整流', async () => {
  const fetchImpl = fakeFetch((url, init, n) => n === 1 ? new Response('overloaded', { status: 529 }) : okStream())
  const provider = createAnthropicProvider({ baseUrl: BASE, fetchImpl, limits: { maxAttempts: 3 }, sleep: async () => {} })
  const events = await collect(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(events.filter((e) => e.type === 'retry').length, 1)
  assert.ok(events.find((e) => e.type === 'message_completed'))
})

test('网络失败→network；连接阶段取消→aborted', async () => {
  const provider = createAnthropicProvider({
    baseUrl: BASE,
    fetchImpl: async () => { throw new TypeError('fetch failed') },
    limits: { maxAttempts: 1 }
  })
  const events = await collect(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(events.find((e) => e.type === 'failed').error.class, 'network')

  const controller = new AbortController()
  controller.abort()
  const p2 = createAnthropicProvider({ baseUrl: BASE, fetchImpl: async () => { throw new DOMException('aborted', 'AbortError') }, limits: { maxAttempts: 1 } })
  const e2 = await collect(p2, { model: 'm', messages: [{ role: 'user', content: 'hi' }], signal: controller.signal })
  assert.equal(e2.find((e) => e.type === 'failed').error.class, 'aborted')
})

test('流中途取消→aborted 且不继续发请求', async () => {
  const controller = new AbortController()
  const frames = [startFrame(), ...textBlock(0, 'partial')]
  const full = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
  const fetchImpl = async () => {
    const bytes = new TextEncoder().encode(full)
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(bytes)
        // 不 close：流挂起，等待取消
      }
    })
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
  const provider = createAnthropicProvider({ baseUrl: BASE, fetchImpl, limits: { maxAttempts: 3, idleStreamTimeoutMs: 5000 } })
  const events = []
  const iter = provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }], signal: controller.signal })
  for await (const event of iter) {
    events.push(event)
    if (event.type === 'text_delta') controller.abort()
  }
  assert.equal(events.find((e) => e.type === 'failed')?.error.class, 'aborted')
})

test('流截断（无 message_stop/stop_reason）→invalid_stream；非法帧→invalid_stream', async () => {
  const truncated = fakeFetch(() => sseResponse([startFrame(), ...textBlock(0, 'partial')]))
  const p1 = createAnthropicProvider({ baseUrl: BASE, fetchImpl: truncated, limits: { maxAttempts: 1 } })
  const e1 = await collect(p1, { model: 'm', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(e1.find((e) => e.type === 'failed').error.class, 'invalid_stream')

  const malformed = fakeFetch(() => new Response('data: not-json\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
  const p2 = createAnthropicProvider({ baseUrl: BASE, fetchImpl: malformed, limits: { maxAttempts: 1 } })
  const e2 = await collect(p2, { model: 'm', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(e2.find((e) => e.type === 'failed').error.class, 'invalid_stream')
})

test('error 帧→failed 按 error.type 分类', async () => {
  const fetchImpl = fakeFetch(() => sseResponse([startFrame(), { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]))
  const provider = createAnthropicProvider({ baseUrl: BASE, fetchImpl, limits: { maxAttempts: 1 } })
  const events = await collect(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] })
  const failure = events.find((e) => e.type === 'failed')
  assert.equal(failure.error.class, 'overloaded')
})

test('多工具调用与错误参数碎片原样透传（Core 组装回灌自纠）', async () => {
  const frames = [
    startFrame(),
    ...toolBlock(0, 'toolu_1', 'Read', ['{"path":"a.txt"}']),
    ...toolBlock(1, 'toolu_2', 'Grep', ['{bad json']),
    deltaFrame('tool_use', 30),
    stopFrame
  ]
  const provider = createAnthropicProvider({ baseUrl: BASE, fetchImpl: fakeFetch(() => sseResponse(frames)) })
  const events = await collect(provider, { model: 'm', messages: [{ role: 'user', content: 'go' }] })
  const deltas = events.filter((e) => e.type === 'tool_call_delta')
  const ids = deltas.filter((d) => d.callId).map((d) => d.callId)
  assert.deepEqual(ids, ['toolu_1', 'toolu_2'])
  const args2 = deltas.filter((d) => d.index === 1 && d.argsDelta).map((d) => d.argsDelta).join('')
  assert.equal(args2, '{bad json')
  assert.equal(events.find((e) => e.type === 'message_completed').finishReason, 'tool_calls')
})

test('非 SSE 响应明确失败；响应超长上限→context_overflow', async () => {
  const p1 = createAnthropicProvider({ baseUrl: BASE, fetchImpl: fakeFetch(() => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })), limits: { maxAttempts: 1 } })
  const e1 = await collect(p1, { model: 'm', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(e1.find((e) => e.type === 'failed').error.class, 'invalid_stream')

  const big = 'x'.repeat(200)
  const p2 = createAnthropicProvider({ baseUrl: BASE, fetchImpl: fakeFetch(() => sseResponse([startFrame(), ...textBlock(0, big), deltaFrame('end_turn', 2), stopFrame])), limits: { maxAttempts: 1, maxResponseChars: 100 } })
  const e2 = await collect(p2, { model: 'm', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(e2.find((e) => e.type === 'failed').error.class, 'context_overflow')
})
