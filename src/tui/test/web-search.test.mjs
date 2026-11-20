import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ConfigStore } from '../dist/storage/config-store.js'
import { createWebSearchTool } from '../dist/provider/web-search.js'
import { createProfile } from '../dist/storage/profiles.js'
import { createAgentRuntime } from '../dist/tui/runtime.js'

test('WebSearch uses Bing without a key and Tavily with one, preserving the result protocol', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'budingx-web-search-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const modelRequests = []
  const approvals = []
  const searchRequests = []
  const bingRequests = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).startsWith('https://www.bing.com/search?')) {
      bingRequests.push({ url: new URL(url), ...init })
      return new Response(null, {
        status: 302,
        headers: { location: 'https://cn.bing.com/search?redirected=1' }
      })
    }
    if (String(url).startsWith('https://cn.bing.com/search?')) {
      bingRequests.push({ url: new URL(url), ...init })
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0"><channel>
          <item><title>Release &amp; changes</title>
            <link>https://docs.example.test/release?a=1&amp;b=2</link>
            <description><![CDATA[<b>Version</b> 2]]></description>
          </item>
          <item><title>Outside scope</title><link>https://badexample.test/release</link></item>
          <item><title>Malformed</title><link>javascript:alert(1)</link></item>
        </channel></rss>`, { headers: { 'content-type': 'application/rss+xml' } })
    }
    if (url !== 'https://api.tavily.com/search') return fetchHttp(url, init)
    searchRequests.push({ ...init, body: JSON.parse(init.body) })
    return Response.json({
      results: [
        { title: 'Release notes', url: 'https://docs.example.test/release', content: 'Version 2' },
        { title: 'Outside scope', url: 'https://badexample.test/release', content: 'Ignore this' },
        { title: 'Malformed', url: 'javascript:alert(1)' }
      ]
    })
  })
  const server = createServer(async (req, res) => {
    const parts = []
    for await (const chunk of req) parts.push(chunk)
    const body = JSON.parse(Buffer.concat(parts).toString())
    modelRequests.push(body)
    const shouldSearch = body.tools?.some((item) => item.function.name === 'WebSearch') &&
      !body.messages.some((item) => item.role === 'tool')
    const choice = shouldSearch
      ? {
          delta: {
            tool_calls: [{
              index: 0, id: 'call-search', type: 'function',
              function: { name: 'WebSearch', arguments: JSON.stringify({
                query: 'release notes', allowed_domains: ['example.test']
              }) }
            }]
          },
          finish_reason: 'tool_calls'
        }
      : { delta: { content: 'Done' }, finish_reason: 'stop' }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end('data: ' + JSON.stringify({ choices: [choice] }) + '\n\ndata: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1')
  t.after(() => { server.closeAllConnections(); server.close() })
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  const profile = createProfile({ label: 'fixture', baseUrl, model: 'fixture', tools: true })
  const configStore = new ConfigStore(join(dir, 'config.json'))
  configStore.save({ version: 1, models: [profile] })
  for (const key of ['', 'search-fixture-key']) {
    const previousKey = process.env.BUDINGX_TAVILY_API_KEY
    try {
      process.env.BUDINGX_TAVILY_API_KEY = key
      const runtime = createAgentRuntime({
        cwd: dir, home: dir, configStore,
        getConfig: () => ({ profileId: profile.id, baseUrl, model: 'fixture', apiKey: '', timeoutMs: 3000, source: 'file' }),
        approval: { request: async (request) => {
          approvals.push(request)
          return { outcome: 'allow', via: 'user' }
        } }
      })
      t.after(() => runtime.session.dispose())
      const done = new Promise((resolve) => {
        const off = runtime.session.on((event) => {
          if (event.type === 'turn_finalized') { off(); resolve(event.outcome) }
        })
      })
      runtime.session.submit('Find release notes')
      assert.equal(await done, 'completed')
    } finally {
      if (previousKey === undefined) delete process.env.BUDINGX_TAVILY_API_KEY
      else process.env.BUDINGX_TAVILY_API_KEY = previousKey
    }
  }
  assert.ok(modelRequests[0].tools.some((item) => item.function.name === 'WebSearch'))
  assert.ok(modelRequests[2].tools.some((item) => item.function.name === 'WebSearch'))
  assert.deepEqual(bingRequests.map(({ url }) => url.host), ['www.bing.com', 'cn.bing.com'])
  for (const request of bingRequests) {
    assert.equal(request.url.searchParams.get('format'), 'rss')
    assert.equal(request.url.searchParams.get('q'), 'release notes site:example.test')
    assert.equal(new Headers(request.headers).get('authorization'), null)
  }
  const bingResult = modelRequests[1].messages.find((item) => item.role === 'tool')
  assert.equal(bingResult.tool_call_id, 'call-search')
  assert.deepEqual(JSON.parse(bingResult.content), {
    sources: [{ title: 'Release & changes', url: 'https://docs.example.test/release?a=1&b=2', snippet: 'Version 2' }]
  })
  assert.equal(searchRequests.length, 1)
  assert.equal(searchRequests[0].headers.Authorization, 'Bearer search-fixture-key')
  assert.equal(searchRequests[0].redirect, 'error')
  assert.equal(searchRequests[0].body.query, 'release notes')
  assert.deepEqual(searchRequests[0].body.include_domains, ['example.test'])
  assert.equal(approvals.length, 2)
  assert.match(approvals[0].summary, /Bing/)
  assert.match(approvals[1].summary, /Tavily/)
  assert.equal(approvals[1].callId, 'call-search')
  assert.deepEqual(approvals[1].preview, ['release notes'])
  const result = modelRequests[3].messages.find((item) => item.role === 'tool')
  assert.equal(result.tool_call_id, 'call-search')
  assert.match(result.content, /https:\/\/docs\.example\.test\/release/)
  assert.doesNotMatch(result.content, /badexample|javascript|search-fixture-key/)
})

test('WebSearch validates domains before approval and requires authorization before network I/O', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network call')
  })
  const tool = createWebSearchTool('fixture')
  assert.throws(() => tool.prepareApproval({
    query: 'release notes', allowed_domains: ['example.test'], blocked_domains: ['example.org']
  }), /either allowed_domains or blocked_domains/)
  assert.throws(() => tool.prepareApproval({
    query: 'release notes', allowed_domains: ['https://example.test/foo']
  }), /host names/)
  await assert.rejects(tool.execute({ query: 'release notes' }, { signal: new AbortController().signal }),
    /requires approval/)
  await assert.rejects(tool.execute({ query: 'release notes' }, { signal: AbortSignal.abort(), approved: true }),
    { name: 'AbortError' })
  assert.equal(fetch.mock.callCount(), 0)
})

test('WebSearch reports Bing HTTP failures and rejects a non-RSS response', async (t) => {
  const tool = createWebSearchTool()
  const input = { query: 'release notes' }
  const context = { signal: new AbortController().signal, approved: true }
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('blocked', { status: 403 }))
  await assert.rejects(tool.execute(input, context), /Bing search failed \(HTTP 403\)/)
  fetch.mock.mockImplementation(async () => new Response('<html>Verify your browser</html>'))
  await assert.rejects(tool.execute(input, context), /Bing returned an invalid RSS/)
  fetch.mock.mockImplementation(async () => new Response(null, {
    status: 302, headers: { location: 'https://example.org/redirected' }
  }))
  await assert.rejects(tool.execute(input, context), /Bing search returned an unexpected redirect/)
  assert.equal(fetch.mock.callCount(), 3)
})

const fetchHttp = globalThis.fetch
