// SP007 T6 RED→GREEN：ToolSearch 延迟加载（design §4.2，AC RD-12/13/14）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createToolSearch } from '../../tui/dist/core/tool-search.js'
import { Session } from '../../tui/dist/core/session.js'

function mcpTool(name, summary = '', description = '') {
  return {
    name,
    summary,
    parameters: { type: 'object', properties: { q: { type: 'string', description } } },
    describe: () => name,
    capability: () => 'read',
    execute: async () => name + ' result'
  }
}
function coreTool(name) {
  return { name, describe: () => name, capability: () => 'read', execute: async () => name + ' result' }
}
const SNAPSHOT = { modelId: 'm', model: 'm', baseUrlHost: 'h', capabilities: { tools: true } }
function textEvents(text) {
  return [{ type: 'text_delta', text }, { type: 'message_completed', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 5 } }]
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
// 大描述确保 auto 阈值（10%×1000=100 token）被超过。
const BIG = 'x'.repeat(800)
function enabledSearch(overrides = {}) {
  const tools = overrides.tools ?? [coreTool('Read'), coreTool('Write'), mcpTool('mcp__srv__search_docs', 'search documents', BIG), mcpTool('mcp__srv__list_files', 'list files', BIG)]
  return createToolSearch({ tools, contextWindow: overrides.contextWindow ?? 1000, env: overrides.env ?? {}, mcpPending: overrides.mcpPending })
}

test('off/standard 门控关闭：不注册工具，filter 原样', () => {
  for (const mode of ['off', 'standard']) {
    const ts = enabledSearch({ env: { BUDINGX_TOOL_SEARCH: mode } })
    assert.equal(ts.enabled, false)
    assert.equal(ts.tool, undefined)
    const tools = [coreTool('Read'), mcpTool('mcp__srv__a')]
    assert.deepEqual(ts.filter(tools).map((t) => t.name), ['Read', 'mcp__srv__a'])
    assert.equal(ts.notice(), undefined)
  }
})

test('无延迟池（无 MCP）→ auto 禁用', () => {
  const ts = createToolSearch({ tools: [coreTool('Read'), coreTool('Write')], contextWindow: 1000, env: {} })
  assert.equal(ts.enabled, false)
  assert.equal(ts.tool, undefined)
})

test('auto 阈值：延迟 token 低于 contextWindow×10% 禁用，达到则启用', () => {
  const small = createToolSearch({ tools: [mcpTool('mcp__srv__a', 's')], contextWindow: 100000, env: {} })
  assert.equal(small.enabled, false)
  const big = enabledSearch()
  assert.equal(big.enabled, true)
  assert.ok(big.tool)
  assert.equal(big.tool.name, 'ToolSearch')
  assert.equal(big.tool.concurrencySafe, true)
  assert.equal(big.tool.capability({}), 'read')
})

test('auto:N 自定义阈值', () => {
  const ts = createToolSearch({ tools: [mcpTool('mcp__srv__a', 's')], contextWindow: 1000, env: { BUDINGX_TOOL_SEARCH: 'auto:1' } })
  // 单工具 500 开销 ≥ 1000×1% = 10 → 启用
  assert.equal(ts.enabled, true)
})

test('filter＝非延迟＋ToolSearch＋已发现', () => {
  const ts = enabledSearch()
  const tools = [coreTool('Read'), mcpTool('mcp__srv__search_docs', 'search', BIG), mcpTool('mcp__srv__list_files', 'list', BIG)]
  const before = ts.filter(tools).map((t) => t.name)
  assert.ok(before.includes('Read'))
  assert.ok(before.includes('ToolSearch'))
  assert.ok(!before.includes('mcp__srv__search_docs'))
  ts.state.discovered.add('mcp__srv__search_docs')
  const after = ts.filter(tools).map((t) => t.name)
  assert.ok(after.includes('mcp__srv__search_docs'))
  assert.ok(!after.includes('mcp__srv__list_files'))
})

test('select 直选大小写不敏感，已发现 no-op，含机器标记', async () => {
  const ts = enabledSearch()
  const out = await ts.tool.execute({ query: 'select:MCP__SRV__SEARCH_DOCS' }, {})
  assert.ok(ts.state.discovered.has('mcp__srv__search_docs'))
  assert.match(out, /<discovered-tools>mcp__srv__search_docs<\/discovered-tools>/)
  const again = await ts.tool.execute({ query: 'select:mcp__srv__search_docs' }, {})
  assert.match(again, /mcp__srv__search_docs/)
})

test('裸名精确 fast path', async () => {
  const ts = enabledSearch()
  const out = await ts.tool.execute({ query: 'mcp__srv__list_files' }, {})
  assert.ok(ts.state.discovered.has('mcp__srv__list_files'))
  assert.match(out, /mcp__srv__list_files/)
})

test('mcp__server 前缀匹配多个', async () => {
  const ts = enabledSearch()
  const out = await ts.tool.execute({ query: 'mcp__srv' }, {})
  assert.ok(ts.state.discovered.has('mcp__srv__search_docs'))
  assert.ok(ts.state.discovered.has('mcp__srv__list_files'))
  assert.match(out, /total_deferred_tools: 2/)
})

test('关键词计分：名称精确权重高于描述；max_results 默认 5', async () => {
  const tools = [
    mcpTool('mcp__srv__search_docs', 'find stuff', 'alpha'),
    mcpTool('mcp__srv__other', 'search helper', 'search'),
    coreTool('Read')
  ]
  const ts = createToolSearch({ tools, contextWindow: 100, env: { BUDINGX_TOOL_SEARCH: 'auto:0' } })
  const out = await ts.tool.execute({ query: 'search' }, {})
  const lines = out.split('\n')
  // 名称含 search 的 search_docs 应排在仅描述含 search 的 other 之前
  assert.ok(lines.indexOf('mcp__srv__search_docs') < lines.indexOf('mcp__srv__other'))
  assert.equal(ts.tool.parameters.properties.max_results.default, 5)
})

test('+词必需：不满足必需词的工具被排除', async () => {
  const tools = [mcpTool('mcp__srv__search_docs', 'search docs'), mcpTool('mcp__srv__list_files', 'list files')]
  const ts = createToolSearch({ tools, contextWindow: 100, env: { BUDINGX_TOOL_SEARCH: 'auto:0' } })
  const out = await ts.tool.execute({ query: '+search +docs' }, {})
  assert.match(out, /mcp__srv__search_docs/)
  assert.ok(!out.split('\n').includes('mcp__srv__list_files'))
})

test('无匹配文案与 pending 提示', async () => {
  const ts = enabledSearch({ mcpPending: true })
  const out = await ts.tool.execute({ query: 'zzzznomatch' }, {})
  assert.match(out, /No matching deferred tools found/)
  assert.match(out, /still connecting/)
})

test('notice 公告排序名池，断连移除', () => {
  const tools = [coreTool('Read'), mcpTool('mcp__srv__b'), mcpTool('mcp__srv__a')]
  const ts = createToolSearch({ tools, contextWindow: 100, env: { BUDINGX_TOOL_SEARCH: 'auto:0' } })
  const notice = ts.notice()
  assert.match(notice, /<available-deferred-tools>/)
  assert.ok(notice.indexOf('mcp__srv__a') < notice.indexOf('mcp__srv__b'))
  // 断连：从活表移除 a
  tools.splice(tools.findIndex((t) => t.name === 'mcp__srv__a'), 1)
  const notice2 = ts.notice()
  assert.ok(!notice2.includes('mcp__srv__a'))
  assert.ok(notice2.includes('mcp__srv__b'))
})

test('scanHistory 从 tool_result 标记重建发现集（resume）', () => {
  const ts = enabledSearch()
  const messages = [
    { id: '1', role: 'tool', blocks: [{ type: 'tool_result', callId: 'c', content: 'ok\n<discovered-tools>mcp__srv__search_docs,mcp__srv__list_files</discovered-tools>', isError: false }] }
  ]
  ts.scanHistory(messages)
  assert.ok(ts.state.discovered.has('mcp__srv__search_docs'))
  assert.ok(ts.state.discovered.has('mcp__srv__list_files'))
})

test('isDeferred 判定', () => {
  const ts = enabledSearch()
  assert.equal(ts.isDeferred('mcp__srv__search_docs'), true)
  assert.equal(ts.isDeferred('Read'), false)
  assert.equal(ts.isDeferred('ToolSearch'), false)
})

// ---- 会话集成 ----
test('Session.buildRequest 消费 filter＋notice；未知延迟工具失败引导', async () => {
  const tools = [coreTool('Read'), mcpTool('mcp__srv__search_docs', 'search', BIG)]
  const ts = createToolSearch({ tools, contextWindow: 1000, env: {} })
  tools.push(ts.tool)
  const provider = makeProvider([
    [
      { type: 'tool_call_delta', index: 0, callId: 'c1', nameDelta: 'mcp__srv__search_docs', argsDelta: '{}' },
      { type: 'message_completed', finishReason: 'tool_calls', usage: { inputTokens: 5, outputTokens: 5 } }
    ],
    textEvents('done')
  ])
  const session = new Session({
    provider, tools,
    approval: { request: async () => ({ outcome: 'allow', via: 'user' }) },
    resolveSnapshot: () => SNAPSHOT,
    permissionPolicy: { getMode: () => 'full_access', setMode: () => {}, decide: () => ({ action: 'allow', reason: 'ok' }), remember: () => {}, canRemember: () => true },
    toolSearch: ts,
    queueAutostartMs: 100000
  })
  const results = []
  session.on((e) => { if (e.type === 'tool_result') results.push(e) })
  session.submit('go')
  const started = Date.now()
  while (session.isBusy && Date.now() - started < 5000) await new Promise((r) => setTimeout(r, 10))
  // 首次请求工具表不含未发现的延迟工具，但含 ToolSearch
  const firstTools = provider.requests[0].tools.map((t) => t.name)
  assert.ok(firstTools.includes('ToolSearch'))
  assert.ok(!firstTools.includes('mcp__srv__search_docs'))
  assert.match(provider.requests[0].messages[0].content, /<available-deferred-tools>/)
  // 未知延迟工具 → 错误结果带 select 引导
  assert.equal(results.length, 1)
  assert.equal(results[0].isError, true)
  assert.match(results[0].content, /ToolSearch/)
  assert.match(results[0].content, /select:mcp__srv__search_docs/)
  session.dispose()
})
