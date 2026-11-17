import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { createOpenAiProvider, probe } from '../../tui/dist/provider/openai.js'

async function withServer(t, handler) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  return `http://127.0.0.1:${server.address().port}/v1`
}

async function collect(provider, request) {
  const events = []
  for await (const event of provider.stream(request)) events.push(event)
  return events
}

function sse(...frames) {
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n'
}

test('HTTP 错误分类互不混淆且不泄漏 key 明文', async (t) => {
  const cases = [
    [401, 'auth'],
    [403, 'auth'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [500, 'overloaded'],
    [400, 'bad_request']
  ]
  for (const [status, expected] of cases) {
    const baseUrl = await withServer(t, (_req, res) => {
      res.writeHead(status)
      res.end('secret upstream body test-only-key')
    })
    const provider = createOpenAiProvider({
      baseUrl,
      apiKey: 'test-only-key',
      limits: { maxAttempts: 1 }
    })
    const events = await collect(provider, { model: 'm', messages: [] })
    const failure = events.find((event) => event.type === 'failed')
    assert.ok(failure, `status ${status} must fail`)
    assert.equal(failure.error.class, expected)
    assert.match(failure.error.code, /^BUDINGX_PROVIDER_\d+$/)
    assert.equal(failure.error.message.includes('test-only-key'), false)
    assert.equal(failure.error.message.includes('upstream body'), false)
    assert.equal(failure.error.status, status)
  }
})

test('流截断与非法事件归为 invalid_stream', async (t) => {
  const truncated = await withServer(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
  })
  const provider = createOpenAiProvider({ baseUrl: truncated, limits: { maxAttempts: 1 } })
  const events = await collect(provider, { model: 'm', messages: [] })
  const failure = events.find((event) => event.type === 'failed')
  assert.equal(failure.error.class, 'invalid_stream')

  const malformed = await withServer(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end('data: not-json\n\n')
  })
  const malformedProvider = createOpenAiProvider({ baseUrl: malformed, limits: { maxAttempts: 1 } })
  const malformedEvents = await collect(malformedProvider, { model: 'm', messages: [] })
  const malformedFailure = malformedEvents.find((event) => event.type === 'failed')
  assert.equal(malformedFailure.error.class, 'invalid_stream')
})

test('非 SSE 响应明确失败', async (t) => {
  const baseUrl = await withServer(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{}')
  })
  const provider = createOpenAiProvider({ baseUrl, limits: { maxAttempts: 1 } })
  const events = await collect(provider, { model: 'm', messages: [] })
  const failure = events.find((event) => event.type === 'failed')
  assert.equal(failure.error.class, 'invalid_stream')
})

test('重试尊重 Retry-After 且达上限后明确失败', async (t) => {
  const baseUrl = await withServer(t, (_req, res) => {
    res.writeHead(429, { 'Retry-After': '2' })
    res.end('slow down')
  })
  const delays = []
  const provider = createOpenAiProvider({
    baseUrl,
    apiKey: 'test-only-key',
    limits: { maxAttempts: 3 },
    sleep: async (ms) => {
      delays.push(ms)
    }
  })
  const events = await collect(provider, { model: 'm', messages: [] })
  const retries = events.filter((event) => event.type === 'retry')
  assert.equal(retries.length, 2)
  assert.deepEqual(delays, [2000, 2000])
  assert.equal(retries[0].errorClass, 'rate_limited')
  assert.equal(retries[0].maxAttempts, 3)
  const failure = events.find((event) => event.type === 'failed')
  assert.equal(failure.error.class, 'rate_limited')
  assert.equal(failure.error.retryable, true)
})

test('连续 5xx 走指数退避且模型始终不变（无静默换模型）', async (t) => {
  const bodies = []
  const baseUrl = await withServer(t, async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    bodies.push(JSON.parse(body))
    res.writeHead(503)
    res.end('overloaded')
  })
  const delays = []
  const provider = createOpenAiProvider({
    baseUrl,
    limits: { maxAttempts: 4 },
    sleep: async (ms) => {
      delays.push(ms)
    }
  })
  const events = await collect(provider, { model: 'only-model', messages: [] })
  assert.equal(events.filter((event) => event.type === 'retry').length, 3)
  assert.ok(delays[1] > delays[0], 'delays must grow')
  assert.ok(delays[2] > delays[1], 'delays must keep growing')
  assert.equal(bodies.length, 4)
  for (const body of bodies) assert.equal(body.model, 'only-model')
})

test('中途 abort 归类为 aborted 且不重试', async (t) => {
  const baseUrl = await withServer(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
  })
  const provider = createOpenAiProvider({ baseUrl, limits: { maxAttempts: 3 } })
  const controller = new AbortController()
  const events = []
  for await (const event of provider.stream({
    model: 'm',
    messages: [],
    signal: controller.signal
  })) {
    events.push(event)
    if (event.type === 'text_delta') controller.abort()
  }
  const failure = events.find((event) => event.type === 'failed')
  assert.equal(failure.error.class, 'aborted')
  assert.equal(events.filter((event) => event.type === 'retry').length, 0)
})

test('响应超长与单事件超限触发明确限额错误', async (t) => {
  const long = await withServer(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(sse({ choices: [{ delta: { content: 'x'.repeat(200) } }] }))
  })
  const provider = createOpenAiProvider({
    baseUrl: long,
    limits: { maxAttempts: 1, maxResponseChars: 50 }
  })
  const events = await collect(provider, { model: 'm', messages: [] })
  const failure = events.find((event) => event.type === 'failed')
  assert.equal(failure.error.class, 'context_overflow')
  assert.equal(failure.error.code, 'BUDINGX_PROVIDER_014')

  const huge = await withServer(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end('data: ' + 'x'.repeat(5000) + '\n\n')
  })
  const hugeProvider = createOpenAiProvider({
    baseUrl: huge,
    limits: { maxAttempts: 1, eventBufferBytes: 1024 }
  })
  const hugeEvents = await collect(hugeProvider, { model: 'm', messages: [] })
  const hugeFailure = hugeEvents.find((event) => event.type === 'failed')
  assert.equal(hugeFailure.error.code, 'BUDINGX_PROVIDER_013')
})

test('流式响应产出增量文本与完成事件', async (t) => {
  const baseUrl = await withServer(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(
      sse(
        { choices: [{ delta: { content: '你' } }] },
        { choices: [{ delta: { content: '好' } }] },
        { choices: [{ finish_reason: 'stop' }] }
      )
    )
  })
  const provider = createOpenAiProvider({ baseUrl, limits: { maxAttempts: 1 } })
  const events = await collect(provider, { model: 'm', messages: [] })
  const text = events
    .filter((event) => event.type === 'text_delta')
    .map((event) => event.text)
    .join('')
  assert.equal(text, '你好')
  const completed = events.find((event) => event.type === 'message_completed')
  assert.equal(completed.finishReason, 'stop')
  const types = events.map((event) => event.type)
  assert.ok(types.indexOf('text_delta') < types.indexOf('message_completed'))
})

test('工具调用片段按事件产出并保留缺省 index', async (t) => {
  const baseUrl = await withServer(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_file","arguments":"{}"}}]}}]}\n\n' +
        'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{\\"a\\":1}"}}]}}]}\n\n' +
        'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n' +
        'data: [DONE]\n\n'
    )
  })
  const provider = createOpenAiProvider({ baseUrl, limits: { maxAttempts: 1 } })
  const events = await collect(provider, { model: 'm', messages: [] })
  const fragments = events.filter((event) => event.type === 'tool_call_delta')
  assert.equal(fragments.length, 2)
  assert.equal(fragments[0].index, 0)
  assert.equal(fragments[0].callId, 'c1')
  assert.equal(fragments[0].nameDelta, 'read_file')
  assert.equal(fragments[1].index, undefined)
  assert.equal(fragments[1].argsDelta, '{"a":1}')
  const completed = events.find((event) => event.type === 'message_completed')
  assert.equal(completed.finishReason, 'tool_calls')
})

test('probe 探测可达性并按需检查工具能力', async (t) => {
  let calls = 0
  const baseUrl = await withServer(t, async (req, res) => {
    for await (const chunk of req) {
      /* drain */
    }
    calls++
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
  })
  const plain = await probe({ baseUrl, model: 'm', apiKey: 'k' })
  assert.equal(plain.ok, true)
  assert.equal(calls, 1)

  const withTools = await probe({ baseUrl, model: 'm', apiKey: 'k' }, { tools: true })
  assert.equal(withTools.ok, true)
  assert.equal(withTools.supportsTools, true)
  assert.equal(calls, 3)
})

test('probe 在凭据错误时给出分类且不泄漏 key', async (t) => {
  const baseUrl = await withServer(t, (_req, res) => {
    res.writeHead(401)
    res.end('nope test-only-key')
  })
  const result = await probe({ baseUrl, model: 'm', apiKey: 'test-only-key' })
  assert.equal(result.ok, false)
  assert.equal(result.errorClass, 'auth')
  assert.equal(result.message.includes('test-only-key'), false)
})
