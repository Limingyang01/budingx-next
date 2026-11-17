import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { SseParser } from '../../tui/dist/provider/sse.js'
import { streamChat } from './fixtures/legacy-chat.mjs'

const frames = (parser, chunk) => parser.push(chunk).map((frame) => frame.data)

test('SSE 分帧容忍任意 TCP 分片、CRLF、多行 data、注释行与 [DONE]', () => {
  const parser = new SseParser()
  const raw =
    ': keepalive\r\n' +
    'data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\n' +
    'data: {"choices":[{"delta":{"content":"world"}}]}\r\n\r\n' +
    'data: {"choices":[{"delta":{"content":"!"}}]}\r\n\r\n' +
    'data: [DONE]\r\n\r\n'
  const bytes = Buffer.from(raw)
  const decoder = new TextDecoder()
  const collected = []
  for (const byte of bytes) {
    const text = decoder.decode(Buffer.from([byte]), { stream: true })
    for (const data of frames(parser, text)) collected.push(data)
  }
  assert.equal(collected.length, 4)
  assert.equal(JSON.parse(collected[0]).choices[0].delta.content, '你好')
  assert.equal(collected[3], '[DONE]')
})

test('SSE 多行 data 与注释行只保留 data 载荷', () => {
  const parser = new SseParser()
  const data = frames(parser, ': comment\ndata: line one\ndata: line two\n\n')
  assert.equal(data.length, 1)
  assert.equal(data[0], 'line one\nline two')
})

test('SSE 残留帧在流结束时被冲刷', () => {
  const parser = new SseParser()
  assert.equal(parser.push('data: tail').length, 0)
  const flushed = parser.end()
  assert.equal(flushed.length, 1)
  assert.equal(flushed[0].data, 'tail')
})

test('SSE 单事件超过限额时抛出明确的限额错误', () => {
  const parser = new SseParser(16)
  assert.throws(() => parser.push('x'.repeat(64)), /size limit|limit/i)
})

test('基线回归：新分帧器与 0.1.1 预览实现产出的文本等价', async (t) => {
  const payload =
    ': keepalive\r\n' +
    'data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\n' +
    'data: {"choices":[{"delta":{"content":"世界"}}]}\r\n\r\n' +
    'data: [DONE]\r\n\r\n'
  const server = createServer(async (req, res) => {
    for await (const chunk of req) {
      /* drain request body */
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const bytes = Buffer.from(payload)
    for (const byte of bytes) res.write(Buffer.from([byte]))
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })

  let legacy = ''
  const stream = streamChat(
    {
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      model: 'fixture',
      apiKey: 'test-only-key',
      timeoutMs: 2000
    },
    [{ role: 'user', content: 'hi' }]
  )
  for await (const chunk of stream) legacy += chunk

  const parser = new SseParser()
  let fresh = ''
  for (const frame of parser.push(payload)) {
    if (frame.data.trim() === '[DONE]') continue
    const parsed = JSON.parse(frame.data)
    const content = parsed.choices?.[0]?.delta?.content
    if (typeof content === 'string') fresh += content
  }
  assert.equal(legacy, '你好世界')
  assert.equal(fresh, legacy)
})
