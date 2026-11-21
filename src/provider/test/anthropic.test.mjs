// SP007 T2：Anthropic Messages 直连适配器——请求形状与流式映射（PC-01）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAnthropicProvider, probeAnthropic, discoverModelsAnthropic } from '../../tui/dist/provider/anthropic.js'
import { sseResponse, fakeFetch, collect, startFrame, textBlock, toolBlock, deltaFrame, stopFrame } from './anthropic-helpers.mjs'

const BASE = 'https://api.anthropic.example'

test('请求形状：system 顶层、x-api-key、anthropic-version、max_tokens 缺省 8192、tools input_schema', async () => {
  const fetchImpl = fakeFetch(() => sseResponse([startFrame(), ...textBlock(0, 'ok'), deltaFrame('end_turn', 3), stopFrame]))
  const provider = createAnthropicProvider({ baseUrl: BASE, apiKey: 'sk-ant-test', fetchImpl })
  await collect(provider, {
    model: 'claude-x',
    messages: [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hi' }
    ],
    tools: [{ name: 'Read', description: 'read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }]
  })
  assert.equal(fetchImpl.calls.length, 1)
  const call = fetchImpl.calls[0]
  assert.equal(call.url, BASE + '/v1/messages')
  assert.equal(call.init.headers['x-api-key'], 'sk-ant-test')
  assert.equal(call.init.headers['anthropic-version'], '2023-06-01')
  assert.equal(call.body.system, 'you are helpful')
  assert.equal(call.body.max_tokens, 8192)
  assert.equal(call.body.stream, true)
  assert.deepEqual(call.body.messages, [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])
  assert.deepEqual(call.body.tools, [{ name: 'Read', description: 'read a file', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }])
  assert.deepEqual(call.body.tool_choice, { type: 'auto' })
})

test('maxTokens 显式值透传；无 tools 不发 tool_choice', async () => {
  const fetchImpl = fakeFetch(() => sseResponse([startFrame(), ...textBlock(0, 'ok'), deltaFrame('end_turn', 3), stopFrame]))
  const provider = createAnthropicProvider({ baseUrl: BASE, fetchImpl })
  await collect(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens: 1024 })
  assert.equal(fetchImpl.calls[0].body.max_tokens, 1024)
  assert.equal(fetchImpl.calls[0].body.tools, undefined)
  assert.equal(fetchImpl.calls[0].body.tool_choice, undefined)
})

test('多模态 parts→image source blocks；assistant tool_calls→tool_use；role:tool→user tool_result', async () => {
  const fetchImpl = fakeFetch(() => sseResponse([startFrame(), ...textBlock(0, 'ok'), deltaFrame('end_turn', 3), stopFrame]))
  const provider = createAnthropicProvider({ baseUrl: BASE, fetchImpl })
  await collect(provider, {
    model: 'm',
    messages: [
      { role: 'user', content: [
        { type: 'text', text: '看图' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }
      ] },
      { role: 'assistant', content: 'calling', tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'Read', arguments: '{"path":"a.txt"}' } }
      ] },
      { role: 'tool', tool_call_id: 'call_1', content: 'file body' }
    ]
  })
  const msgs = fetchImpl.calls[0].body.messages
  assert.deepEqual(msgs[0], { role: 'user', content: [
    { type: 'text', text: '看图' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }
  ] })
  assert.deepEqual(msgs[1], { role: 'assistant', content: [
    { type: 'text', text: 'calling' },
    { type: 'tool_use', id: 'call_1', name: 'Read', input: { path: 'a.txt' } }
  ] })
  assert.deepEqual(msgs[2], { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'call_1', content: 'file body', is_error: false }
  ] })
})

test('流式映射：text/thinking/工具碎片/finish 与 usage 分帧合并', async () => {
  const frames = [
    startFrame(40),
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
    { type: 'content_block_stop', index: 0 },
    ...textBlock(1, 'Hello'),
    ...toolBlock(2, 'toolu_9', 'Read', ['{"path":', '"a.txt"}']),
    deltaFrame('tool_use', 77),
    stopFrame
  ]
  const provider = createAnthropicProvider({ baseUrl: BASE, fetchImpl: fakeFetch(() => sseResponse(frames)) })
  const events = await collect(provider, { model: 'm', messages: [{ role: 'user', content: 'go' }] })
  const thinking = events.filter((e) => e.type === 'thinking_delta').map((e) => e.text).join('')
  assert.equal(thinking, 'hmm')
  const text = events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('')
  assert.equal(text, 'Hello')
  const toolDeltas = events.filter((e) => e.type === 'tool_call_delta')
  assert.deepEqual(toolDeltas[0], { type: 'tool_call_delta', index: 2, callId: 'toolu_9', nameDelta: 'Read' })
  assert.equal(toolDeltas.filter((d) => d.argsDelta).map((d) => d.argsDelta).join(''), '{"path":"a.txt"}')
  const completed = events.filter((e) => e.type === 'message_completed')
  assert.equal(completed.length, 1)
  assert.equal(completed[0].finishReason, 'tool_calls')
  assert.deepEqual(completed[0].usage, { inputTokens: 40, outputTokens: 77 })
  // message_completed 必须是最后一个事件（扣帧纪律）
  assert.equal(events[events.length - 1].type, 'message_completed')
})

test('stop_reason 映射：end_turn/max_tokens/refusal/暂停序列', async () => {
  for (const [reason, expected] of [['end_turn', 'stop'], ['max_tokens', 'length'], ['refusal', 'content_filter'], ['pause_turn', 'unknown']]) {
    const provider = createAnthropicProvider({
      baseUrl: BASE,
      fetchImpl: fakeFetch(() => sseResponse([startFrame(), ...textBlock(0, 'x'), deltaFrame(reason, 2), stopFrame]))
    })
    const events = await collect(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    const completed = events.find((e) => e.type === 'message_completed')
    assert.equal(completed.finishReason, expected, reason)
  }
})

test('TCP 任意分片不丢帧（SseParser 复用）', async () => {
  const frames = [startFrame(), ...textBlock(0, '分片测试'), deltaFrame('end_turn', 5), stopFrame]
  const full = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
  const fetchImpl = async () => {
    const encoder = new TextEncoder()
    const bytes = encoder.encode(full)
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
        controller.close()
      }
    })
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
  const provider = createAnthropicProvider({ baseUrl: BASE, fetchImpl })
  const events = await collect(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(events.filter((e) => e.type === 'text_delta').map((e) => e.text).join(''), '分片测试')
  assert.equal(events.find((e) => e.type === 'message_completed').usage.outputTokens, 5)
})

test('reasoningEffort→thinking budget；400 提及 thinking 去参重试一次', async () => {
  const fetchImpl = fakeFetch((url, init, n) => {
    if (n === 1) return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'thinking is not supported for this model' } }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    return sseResponse([startFrame(), ...textBlock(0, 'ok'), deltaFrame('end_turn', 2), stopFrame])
  })
  const provider = createAnthropicProvider({ baseUrl: BASE, fetchImpl })
  const events = await collect(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }], reasoningEffort: 'high' })
  assert.equal(fetchImpl.calls.length, 2)
  assert.deepEqual(fetchImpl.calls[0].body.thinking, { type: 'enabled', budget_tokens: 16384 })
  assert.equal(fetchImpl.calls[1].body.thinking, undefined)
  assert.ok(events.find((e) => e.type === 'message_completed'))
  for (const [effort, budget] of [['low', 1024], ['medium', 4096]]) {
    const f2 = fakeFetch(() => sseResponse([startFrame(), ...textBlock(0, 'ok'), deltaFrame('end_turn', 2), stopFrame]))
    const p2 = createAnthropicProvider({ baseUrl: BASE, fetchImpl: f2 })
    await collect(p2, { model: 'm', messages: [{ role: 'user', content: 'hi' }], reasoningEffort: effort })
    assert.deepEqual(f2.calls[0].body.thinking, { type: 'enabled', budget_tokens: budget })
  }
})

test('probeAnthropic：max_tokens 1 ping；discoverModelsAnthropic：GET /v1/models x-api-key', async () => {
  const fetchImpl = fakeFetch((url, init) => {
    if (String(url).endsWith('/v1/models')) {
      assert.equal(init.headers['x-api-key'], 'k')
      return new Response(JSON.stringify({ data: [{ id: 'claude-a' }, { id: 'claude-b' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const body = JSON.parse(init.body)
    assert.equal(body.max_tokens, 1)
    assert.equal(body.stream, false)
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'pong' }], stop_reason: 'end_turn' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  const result = await probeAnthropic({ baseUrl: BASE, model: 'claude-x', apiKey: 'k' }, { fetchImpl })
  assert.equal(result.ok, true)
  const models = await discoverModelsAnthropic(BASE, 'k', { fetchImpl })
  assert.deepEqual(models, ['claude-a', 'claude-b'])
})
