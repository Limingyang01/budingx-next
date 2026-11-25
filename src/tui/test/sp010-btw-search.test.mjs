import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Session } from '../dist/core/session.js'
import { createWebSearchTool } from '../dist/provider/web-search.js'
import { createWebFetchTool } from '../dist/provider/web-fetch.js'
import { createOpenAiProvider } from '../dist/provider/openai.js'
import { TracingRuntime } from '../dist/observability/runtime.js'

const question = '请查询现在的微博热搜'
const query = '微博热搜榜 实时'
const sources = [{ title: '样例热搜榜', url: 'https://example.test/hot', content: '样例话题一' }]

function fixture(t, { mode = 'full_access', verdict, searchResults = sources, toolName = 'WebSearch', parallelSearch = false } = {}) {
  const requests = []
  const searchRequests = []
  const forbidden = { name: 'Write', describe: () => '', execute: async () => assert.fail('side questions cannot write') }
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'https://api.tavily.com/search')
    searchRequests.push(JSON.parse(init.body))
    return Response.json({ results: searchResults })
  })
  const session = new Session({
    tools: [createWebSearchTool('fixture-key'), forbidden],
    provider: { async *stream(request) {
      requests.push(structuredClone({ ...request, signal: undefined }))
      if (requests.length === 1) {
        yield { type: 'tool_call_delta', index: 0, callId: 'side-search', nameDelta: toolName, argsDelta: '{"query":' }
        yield { type: 'tool_call_delta', index: 0, argsDelta: JSON.stringify(query) + '}' }
        if (parallelSearch) {
          yield { type: 'tool_call_delta', index: 1, callId: 'side-search-extra', nameDelta: 'WebSearch', argsDelta: '{"query":"other language"}' }
        }
        yield { type: 'message_completed', finishReason: 'tool_calls' }
        return
      }
      yield { type: 'text_delta', text: '样例话题一 · https://example.test/hot' }
      yield { type: 'message_completed', finishReason: 'stop' }
    } },
    resolveSnapshot: () => ({
      modelId: 'fixture', model: 'fixture', baseUrlHost: 'fixture.invalid', capabilities: { tools: true }
    }),
    permissionPolicy: {
      decide(request) {
        assert.deepEqual(request, { tool: 'WebSearch', capability: 'network' })
        return { action: verdict ?? (mode === 'full_access' ? 'allow' : 'ask'), reason: 'fixture policy' }
      },
      getMode: () => mode, setMode() {}, remember() {}
    },
    approval: { request: async () => assert.fail('Side search uses its own approval surface') }
  })
  t.after(() => session.dispose())
  return { session, requests, searchRequests }
}

test('/btw offers only WebSearch, fetches sources and returns an isolated answer', async (t) => {
  const { session, requests, searchRequests } = fixture(t)
  const events = []
  session.on((event) => events.push(event))
  const result = await session.submitSideQuestion(question)
  assert.equal(result.ok, true, result.error)
  assert.match(result.text, /样例话题一.*https:\/\/example.test\/hot/)
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[0].tools.map((tool) => tool.name), ['WebSearch'])
  assert.equal(requests[1].tools, undefined)
  assert.deepEqual(requests[1].messages.at(-2).tool_calls.map((call) => call.id), ['side-search'])
  assert.equal(requests[1].messages.at(-1).tool_call_id, 'side-search')
  assert.match(requests[1].messages.at(-1).content, /样例话题一/)
  assert.deepEqual(searchRequests.map((request) => request.query), [query])
  assert.deepEqual(session.history, [])
  assert.deepEqual(events, [])
})

test('/btw asks before egress in workspace mode and stops if denied or cancelled', async (t) => {
  for (const cancelled of [false, true]) {
    const { session, requests, searchRequests } = fixture(t, { mode: 'workspace_edit' })
    const controller = new AbortController()
    let asked = 0
    const result = await session.submitSideQuestion(question, controller.signal, async (preview) => {
      asked++
      assert.deepEqual(preview, [query])
      if (cancelled) controller.abort()
      return cancelled
    })
    assert.equal(asked, 1)
    assert.equal(result.ok, false)
    assert.equal(searchRequests.length, 0)
    assert.equal(requests.length, 1)
    assert.deepEqual(session.history, [])
  }
})

test('/btw does not summarize an empty search or execute a different model-selected tool', async (t) => {
  for (const toolName of ['WebSearch', 'Write']) {
    const { session, requests, searchRequests } = fixture(t, { searchResults: [], toolName })
    const result = await session.submitSideQuestion(question)
    assert.equal(result.ok, false)
    assert.equal(result.text, undefined)
    assert.equal(requests.length, 1)
    assert.equal(searchRequests.length, toolName === 'WebSearch' ? 1 : 0)
  }
})

test('/btw honors a deny rule before requesting approval or sending the query', async (t) => {
  const { session, requests, searchRequests } = fixture(t, { verdict: 'deny' })
  const result = await session.submitSideQuestion(question, undefined, async () => assert.fail('denial is final'))
  assert.equal(result.ok, false)
  assert.match(result.error, /权限规则拒绝/)
  assert.equal(requests.length, 1)
  assert.equal(searchRequests.length, 0)
})

test('/btw accepts parallel same-tool requests while executing one approved search', async (t) => {
  const { session, requests, searchRequests } = fixture(t, { mode: 'workspace_edit', parallelSearch: true })
  const approvals = []
  const result = await session.submitSideQuestion(question, undefined, async (preview) => {
    approvals.push(preview)
    return true
  })
  assert.equal(result.ok, true, result.error)
  assert.deepEqual(approvals, [[query]])
  assert.deepEqual(searchRequests.map((request) => request.query), [query])
  assert.equal(requests.length, 2)
  const [assistant, first, skipped] = requests[1].messages.slice(-3)
  assert.deepEqual(assistant.tool_calls.map((call) => call.id), ['side-search', 'side-search-extra'])
  assert.equal(first.tool_call_id, 'side-search')
  assert.match(first.content, /样例话题一/)
  assert.equal(skipped.tool_call_id, 'side-search-extra')
  assert.match(skipped.content, /未执行/)
  assert.deepEqual(session.history, [])
})

test('/btw can read one separately approved public source before giving supported entries', async (t) => {
  const url = 'https://example.test/snapshot'
  const requests = []
  const approvals = []
  const network = []
  t.mock.method(globalThis, 'fetch', async (address) => {
    network.push(String(address))
    if (String(address) === 'https://api.tavily.com/search') {
      return Response.json({ results: [{ title: '公开快照入口', url, content: '页面内有条目和时间' }] })
    }
    assert.equal(String(address), url)
    return new Response('<main><p>榜单更新时间 09:05</p><ol><li>榜单样例甲</li><li>榜单样例乙</li></ol></main>', {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })
  })
  const session = new Session({
    tools: [createWebSearchTool('fixture-key')],
    sideQuestionFetch: createWebFetchTool(),
    provider: { async *stream(request) {
      requests.push(structuredClone({ ...request, signal: undefined }))
      if (requests.length < 3) {
        const first = requests.length === 1
        yield {
          type: 'tool_call_delta', index: 0,
          callId: first ? 'live-search' : 'live-read',
          nameDelta: first ? 'WebSearch' : 'WebFetch',
          argsDelta: JSON.stringify(first ? { query } : { url })
        }
        yield { type: 'message_completed', finishReason: 'tool_calls' }
      } else {
        assert.match(request.messages.at(-1).content, /榜单样例甲/)
        yield { type: 'text_delta', text: '榜单样例甲、榜单样例乙（09:05） · ' + url }
        yield { type: 'message_completed', finishReason: 'stop' }
      }
    } },
    resolveSnapshot: () => ({ modelId: 'fixture', model: 'fixture', baseUrlHost: 'fixture.invalid', capabilities: { tools: true } }),
    permissionPolicy: {
      decide: () => ({ action: 'ask', reason: 'approve each network action' }),
      getMode: () => 'workspace_edit', setMode() {}, remember() {}
    },
    approval: { request: async () => assert.fail('main approval surface is isolated') }
  })
  t.after(() => session.dispose())
  const result = await session.submitSideQuestion(question, undefined, async (preview, name) => {
    approvals.push({ name, preview })
    return true
  })
  assert.equal(result.ok, true, result.error)
  assert.match(result.text, /榜单样例甲.*榜单样例乙.*https:/)
  assert.deepEqual(approvals, [{ name: 'WebSearch', preview: [query] }, { name: 'WebFetch', preview: [url] }])
  assert.deepEqual(network, ['https://api.tavily.com/search', url])
  assert.deepEqual(requests.map((request) => request.tools?.map(({ name }) => name)), [['WebSearch', 'WebFetch'], ['WebFetch'], undefined])
  assert.equal(requests[1].messages.at(-1).tool_call_id, 'live-search')
  assert.equal(requests[2].messages.at(-1).tool_call_id, 'live-read')
  assert.deepEqual(session.history, [])
})

test('MiniMax content-policy rejection reports the specific terminal error', async () => {
  let attempts = 0
  const provider = createOpenAiProvider({
    baseUrl: 'https://api.minimax.cn/v1',
    apiKey: 'fixture-secret',
    fetchImpl: async () => {
      attempts++
      return Response.json({
        error: { type: 'unprocessable_entity_error', message: 'input new_sensitive (1026)', http_code: '422' },
        request_id: 'fixture-secret'
      }, { status: 422 })
    }
  })
  const events = []
  for await (const event of provider.stream({
    model: 'MiniMax-M3.1-Flash',
    messages: [{ role: 'user', content: 'test fixture' }]
  })) events.push(event)
  assert.equal(attempts, 1)
  assert.equal(events[0].type, 'failed')
  assert.equal(events[0].error.class, 'bad_request')
  assert.equal(events[0].error.retryable, false)
  assert.match(events[0].error.message, /content policy.*1026/)
  assert.doesNotMatch(JSON.stringify(events), /fixture-secret/)
})

test('/btw exports its own complete trace alongside an overlapping main turn', async (t) => {
  const batches = []
  const receipts = []
  const protectedText = 'fixture-sensitive-token'
  const tracer = new TracingRuntime({
    config: { enabled: true, captureContent: true, knownSecrets: [protectedText] },
    sessionId: 'btw-case',
    report: (receipt) => receipts.push(receipt),
    fetch: async (_url, request) => {
      batches.push(JSON.parse(request.body).resourceSpans[0].scopeSpans[0].spans)
      return Response.json({})
    }
  })
  const main = tracer.begin('agent.run', { 'turn.id': 'main' })
  const page = 'https://example.test/snapshot'
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url) === 'https://api.tavily.com/search') return Response.json({ results: [{ title: '榜单', url: page }] })
    assert.equal(String(url), page)
    return new Response('热搜样例甲 ' + protectedText, { headers: { 'content-type': 'text/plain' } })
  })
  let count = 0
  const session = new Session({
    id: 'btw-case', tracer, tools: [createWebSearchTool('fixture-key')], sideQuestionFetch: createWebFetchTool(),
    provider: { async *stream() {
      if (++count === 1) {
        yield { type: 'thinking_delta', text: 'TRACE_INTERNAL_REASONING' }
        yield { type: 'tool_call_delta', index: 0, callId: 'search-1', nameDelta: 'WebSearch', argsDelta: JSON.stringify({ query }) }
        yield { type: 'tool_call_delta', index: 1, callId: 'fetch-1', nameDelta: 'WebFetch', argsDelta: JSON.stringify({ url: page }) }
        yield { type: 'message_completed', finishReason: 'tool_calls', usage: { inputTokens: 15, outputTokens: 8 } }
      } else {
        yield { type: 'failed', error: { status: 422, class: 'bad_request', code: 'BUDINGX_PROVIDER_011',
          message: 'Provider rejected the input under its content policy (MiniMax 1026)', retryable: false } }
      }
    }, preserveToolReasoning: () => true },
    resolveSnapshot: () => ({
      modelId: 'fixture', model: 'fixture', baseUrlHost: 'fixture.invalid', capabilities: { tools: true }
    }),
    permissionPolicy: { decide: () => ({ action: 'allow', reason: 'fixture' }), getMode: () => 'full_access', setMode() {}, remember() {} },
    approval: { request: async () => assert.fail('unexpected main approval') }
  })
  t.after(() => session.dispose())
  assert.equal((await session.submitSideQuestion(question)).ok, false)
  const mainModel = tracer.begin('model.request', { 'turn.id': 'main' }, main)
  tracer.end(mainModel, 'success')
  tracer.end(main, 'success')
  await tracer.shutdown()
  assert.equal(batches.length, 2)
  assert.equal(receipts.length, 2)
  const side = batches.find((spans) => spans.some((span) => span.name === 'tool.WebFetch'))
  const root = side.find((span) => !span.parentSpanId)
  assert.ok(side.every((span) => span.traceId === root.traceId && (span === root || span.parentSpanId === root.spanId)))
  const attr = (span, name) => span.attributes.find((field) => field.key === name)?.value.stringValue
  assert.equal(attr(root, 'langfuse.trace.name'), 'agent.side_question')
  assert.equal(attr(root, 'langfuse.observation.level'), 'ERROR')
  assert.equal(side.filter((span) => span.name === 'model.request').length, 2)
  assert.equal(attr(side.find((span) => span.name === 'tool.WebSearch'), 'langfuse.observation.metadata.outcome'), 'success')
  assert.equal(attr(side.find((span) => span.name === 'tool.WebFetch'), 'langfuse.observation.metadata.outcome'), 'success')
  const failed = side.find((span) => span.name === 'model.request' && attr(span, 'langfuse.observation.level') === 'ERROR')
  assert.match(attr(failed, 'langfuse.observation.input'), /热搜样例甲 \[redacted\]/)
  assert.match(attr(failed, 'langfuse.observation.output'), /422.*MiniMax 1026|MiniMax 1026.*422/)
  assert.doesNotMatch(JSON.stringify(batches), /TRACE_INTERNAL_REASONING|fixture-sensitive-token/)
  const mainBatch = batches.find((spans) => spans[0].traceId !== root.traceId)
  assert.equal(mainBatch.length, 2)
  assert.equal(mainBatch[1].parentSpanId, mainBatch[0].spanId)
  assert.deepEqual(session.history, [])
})
