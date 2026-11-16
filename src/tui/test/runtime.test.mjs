import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { normalizeBaseUrl, loadConfig } from '../dist/config.js'
import { streamChat } from '../dist/provider.js'

async function server(t, handler) {
  const srv = createServer(handler)
  srv.listen(0, '127.0.0.1')
  await once(srv, 'listening')
  t.after(() => {
    srv.closeAllConnections()
    srv.close()
  })
  return {
    baseUrl: `http://127.0.0.1:${srv.address().port}/v1`,
    model: 'test-model',
    apiKey: 'test-only-key',
    timeoutMs: 1000
  }
}
const collect = async (stream) => {
  let text = ''
  for await (const chunk of stream) text += chunk
  return text
}

test('configuration normalizes endpoints and rejects credential leaks / insecure remote URLs', () => {
  assert.equal(
    normalizeBaseUrl('https://example.test/v1/'),
    'https://example.test/v1'
  )
  assert.equal(
    normalizeBaseUrl('http://localhost:1234/v1'),
    'http://localhost:1234/v1'
  )
  for (const url of [
    'http://example.test/v1',
    'https://user:secret@example.test/v1',
    'https://example.test/v1?key=secret',
    'file:///x'
  ]) {
    assert.throws(() => normalizeBaseUrl(url))
  }
})
test('configuration uses only explicit product env and validates flags', () => {
  const config = loadConfig(
    ['--model', 'my-model', '--base-url', 'https://example.test/v1'],
    { BUDINGX_API_KEY: 'test-only-key', OPENAI_API_KEY: 'not-read' }
  )
  assert.equal(config.model, 'my-model')
  assert.equal(config.apiKey, 'test-only-key')
  assert.equal(loadConfig([], { OPENAI_API_KEY: 'not-read' }).apiKey, '')
  assert.throws(() => loadConfig(['--unknown'], {}), /Unknown/)
  assert.throws(() => loadConfig(['--model'], {}), /value/)
  assert.throws(() => loadConfig(['--timeout', 'NaN'], {}), /timeout/i)
})
test('real HTTP fixture receives model/history/auth, fragmented UTF-8 SSE is reconstructed', async (t) => {
  const config = await server(t, async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions')
    assert.equal(req.headers.authorization, 'Bearer test-only-key')
    let body = ''
    for await (const chunk of req) body += chunk
    const data = JSON.parse(body)
    assert.equal(data.model, 'test-model')
    assert.equal(data.stream, true)
    assert.deepEqual(data.messages, [{ role: 'user', content: 'hello' }])
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const bytes = Buffer.from(
      ': keepalive\r\ndata: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: [DONE]\r\n\r\n'
    )
    for (const byte of bytes) res.write(Buffer.from([byte]))
    res.end()
  })
  assert.equal(
    await collect(streamChat(config, [{ role: 'user', content: 'hello' }])),
    '你好'
  )
})
test('HTTP errors do not leak upstream bodies or credentials', async (t) => {
  const config = await server(t, (_req, res) => {
    res.writeHead(401)
    res.end('secret upstream body test-only-key')
  })
  await assert.rejects(
    collect(streamChat(config, [])),
    (error) =>
      error.message.includes('401') &&
      !error.message.includes('test-only-key') &&
      !error.message.includes('upstream body')
  )
})
test('truncated SSE is a failure rather than a completed response', async (t) => {
  const config = await server(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
  })
  await assert.rejects(collect(streamChat(config, [])), /incomplete|truncated/i)
})
test('malformed stream and tool-only response fail explicitly', async (t) => {
  const config = await server(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end('data: invalid\n\n')
  })
  await assert.rejects(collect(streamChat(config, [])), /invalid|malformed/i)
})
test('an explicit tool request is not executed or reported as successful chat', async (t) => {
  const config = await server(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(
      'data: {"choices":[{"delta":{"tool_calls":[{}]}}]}\n\ndata: [DONE]\n\n'
    )
  })
  await assert.rejects(collect(streamChat(config, [])), /tool/i)
})
test('a hung request times out and caller cancellation aborts the real request', async (t) => {
  const config = await server(t, (_req, _res) => {})
  await assert.rejects(
    collect(streamChat({ ...config, timeoutMs: 40 }, [])),
    /timeout|abort/i
  )
  const controller = new AbortController()
  const result = collect(streamChat(config, [], controller.signal))
  controller.abort()
  await assert.rejects(result, /abort/i)
})
