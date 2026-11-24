// SP007 §4.6 失败边界与宿主契约（FB-01 … FB-05）。
// 全部用例离线且确定性：网络走 stub fetch，hooks 走本地子进程脚本，
// MCP 走本地假服务器，headless 走本地 SSE fixture + 真实 CLI 子进程。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Session } from '../dist/core/session.js'
import { createToolSearch } from '../dist/core/tool-search.js'
import { createWebFetchTool } from '../dist/provider/web-fetch.js'
import { createWebSearchTool } from '../dist/provider/web-search.js'
import { PermissionsStore } from '../dist/storage/permissions.js'
import { formatHeadlessEvent } from '../dist/tui/headless.js'
import { createHookRunner, loadHooksConfig } from '../dist/tui/hooks/index.js'
import { McpClient, toAgentTools } from '../dist/tui/mcp/index.js'
import { createPermissionPolicy } from '../dist/workspace/policy.js'
import { agentFixture, SNAPSHOT } from './helpers/agent-fixture.mjs'

const cli = fileURLToPath(new URL('../dist/tui/cli.js', import.meta.url))
const headlessDist = fileURLToPath(new URL('../dist/tui/headless.js', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const fakeMcpServer = fileURLToPath(new URL('./helpers/fake-mcp-server.mjs', import.meta.url))
const isolatedHome = mkdtempSync(join(tmpdir(), 'budingx-fb04-home-'))

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix))
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate() && Date.now() < deadline) await delay(20)
  return predicate()
}

function writeScript(dir, name, body) {
  const path = join(dir, name + '.mjs')
  writeFileSync(path, body, 'utf8')
  return path
}

function commandHook(scriptPath, timeout) {
  return {
    type: 'command',
    command: '"' + process.execPath + '" "' + scriptPath + '"',
    ...(timeout === undefined ? {} : { timeout })
  }
}

function writeHooks(home, hooks) {
  const dir = join(home, '.budingx')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'hooks.json')
  writeFileSync(path, JSON.stringify({ hooks }), 'utf8')
  return path
}

function commandRunner(home, hooks, options = {}) {
  if (hooks && Object.keys(hooks).length > 0) writeHooks(home, hooks)
  const loaded = loadHooksConfig(home)
  assert.equal(loaded.corrupt, undefined)
  return createHookRunner(loaded.config, { homeDir: home, ...options })
}

function toolTurn(name, args) {
  return [
    {
      type: 'tool_call_delta',
      index: 0,
      callId: 'call_' + Math.random().toString(36).slice(2, 8),
      nameDelta: name,
      argsDelta: JSON.stringify(args)
    },
    { type: 'message_completed', finishReason: 'tool_calls' }
  ]
}

const FINAL = [
  { type: 'text_delta', text: 'done' },
  { type: 'message_completed', finishReason: 'stop' }
]

function scriptProvider(script) {
  const calls = []
  return {
    calls,
    provider: {
      async *stream(request) {
        calls.push(request)
        const events = script.shift() ?? FINAL
        for (const event of events) yield event
      }
    }
  }
}

function probeTool(received, requiresApproval = false) {
  return {
    name: 'probe',
    summary: 'probe tool',
    description: 'records its input',
    parameters: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message']
    },
    describe: (input) => 'probe ' + String(input.message),
    capability: () => 'write',
    requiresApproval: () => requiresApproval,
    target: () => ({ kind: 'none' }),
    async execute(input) {
      received.push(input)
      return 'probe-ok'
    }
  }
}

/** 跑一个真实回合，收集事件；回合未在期限内结束即视为死锁。 */
async function runTurn(t, options = {}) {
  const fixture = options.fixture ?? agentFixture({ mode: options.mode ?? 'workspace_edit' })
  const events = []
  const approvals = []
  const received = options.received ?? []
  const { provider, calls } = scriptProvider(
    options.script ?? [toolTurn('probe', { message: 'hi' }), FINAL]
  )
  const session = new Session({
    provider,
    approval: {
      async request(request) {
        approvals.push(request)
        return { outcome: options.approvalOutcome ?? 'allow', via: 'policy' }
      }
    },
    resolveSnapshot: () => SNAPSHOT,
    tools: options.tools ?? [probeTool(received)],
    permissionPolicy: options.policy ?? fixture.policy,
    ...(options.hooks ? { hooks: options.hooks } : {}),
    onEvent: (event) => events.push(event)
  })
  t.after(() => session.dispose())
  session.submit('go')
  const deadline = Date.now() + (options.timeoutMs ?? 8000)
  while (session.isBusy && Date.now() < deadline) await delay(20)
  assert.equal(session.isBusy, false, '回合必须在期限内结束（不得死锁）')
  return { fixture, events, approvals, calls, received, session }
}

function finalized(events) {
  const event = events.find((entry) => entry.type === 'turn_finalized')
  assert.ok(event, '缺少 turn_finalized 事件')
  return event
}

function toolResults(events) {
  return events.filter((event) => event.type === 'tool_result')
}

/** 权限快照：档位、规则、判结果与持久化文件内容。 */
function permissionSnapshot(policy, store) {
  return {
    mode: policy.getMode(),
    rules: policy.listRules(),
    decisions: [
      { tool: 'WebSearch', capability: 'network' },
      { tool: 'WebFetch', capability: 'network' },
      { tool: 'Read', capability: 'read', path: 'notes.md' },
      { tool: 'Write', capability: 'write', path: 'docs/guide.md' },
      { tool: 'Read', capability: 'read', path: 'secrets/token.txt' },
      { tool: 'Bash', capability: 'execute' }
    ].map((request) => ({ request, verdict: policy.decide(request) })),
    file: readFileSync(store.path, 'utf8')
  }
}

const MUTE_MCP_SERVER = [
  'process.stdin.resume()',
  'setInterval(() => {}, 1000)'
].join('\n')

const BIG_MCP_SERVER = [
  'const BIG = "y".repeat(40000)',
  'const tools = [{ name: "big", description: "large payload", inputSchema: { type: "object", properties: {} } }]',
  'function write(payload) { process.stdout.write(JSON.stringify(payload) + "\\n") }',
  'function handle(message) {',
  '  const method = message.method',
  '  if (method === "initialize") {',
  '    write({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "big-mcp", version: "1.0.0" } } })',
  '    return',
  '  }',
  '  if (method === "notifications/initialized") return',
  '  if (method === "tools/list") { write({ jsonrpc: "2.0", id: message.id, result: { tools } }); return }',
  '  if (method === "tools/call") { write({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: BIG }] } }); return }',
  '}',
  'let buffer = ""',
  'process.stdin.setEncoding("utf8")',
  'process.stdin.on("data", (chunk) => {',
  '  buffer += chunk',
  '  for (;;) {',
  '    const index = buffer.indexOf("\\n")',
  '    if (index === -1) break',
  '    const line = buffer.slice(0, index).trim()',
  '    buffer = buffer.slice(index + 1)',
  '    if (!line) continue',
  '    try { handle(JSON.parse(line)) } catch { /* 忽略坏行 */ }',
  '  }',
  '})',
  'process.stdin.on("end", () => process.exit(0))'
].join('\n')

function runCli(args = [], input = '', env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: isolatedHome,
      env: {
        ...process.env,
        BUDINGX_API_KEY: 'fixture-key',
        BUDINGX_MODEL: 'fixture',
        BUDINGX_BASE_URL: '',
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        ...env
      },
      windowsHide: true
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (data) => { out += data })
    child.stderr.on('data', (data) => { err += data })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out, err }))
    child.stdin.end(input)
  })
}

async function fixtureServer(t, reply = 'hello') {
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(
      'data: {"choices":[{"delta":{"content":"' + reply + '"}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n'
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  return { baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1' }
}

// ---------------------------------------------------------------------------
// FB-01：WebSearch / WebFetch 失败返回错误结果，权限档位与规则不得变化。
// ---------------------------------------------------------------------------

test('FB-01 WebSearch/WebFetch 失败：错误结果 + 权限档位与持久化规则不变', async (t) => {
  const rules = [
    { id: 'allow-docs', action: 'allow', tool: 'Write', path: 'docs/**', note: '文档目录免确认' },
    { id: 'deny-secrets', action: 'deny', tool: 'Read', path: 'secrets/**', note: '机密目录禁止读取' }
  ]
  const fixture = agentFixture({ mode: 'workspace_edit' })
  const policy = createPermissionPolicy({
    workspace: fixture.workspace,
    mode: 'workspace_edit',
    rules,
    dataRootOverride: join(fixture.base, 'data')
  })
  const store = new PermissionsStore(join(fixture.base, 'permissions.json'))
  store.save({ schemaVersion: 1, rules })
  const before = permissionSnapshot(policy, store)

  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => new Response('upstream is down', { status: 503 })

  const { events } = await runTurn(t, {
    fixture,
    policy,
    tools: [createWebSearchTool(), createWebFetchTool()],
    script: [
      toolTurn('WebSearch', { query: 'sp007 failure boundary' }),
      toolTurn('WebFetch', { url: 'https://example.test/page' }),
      FINAL
    ]
  })

  const results = toolResults(events)
  assert.equal(results.length, 2, '两个出网工具都应产生结果')
  assert.equal(results[0].isError, true, 'WebSearch 失败必须是错误结果')
  assert.match(results[0].content, /Bing search failed \(HTTP 503\)/)
  assert.match(results[0].content, /BUDINGX_CORE_002/)
  assert.equal(results[1].isError, true, 'WebFetch 失败必须是错误结果')
  assert.match(results[1].content, /BUDINGX_WEB_HTTP_ERROR/)
  assert.match(results[1].content, /HTTP 503/)
  assert.equal(finalized(events).outcome, 'completed', '出网失败不得中断回合')

  const after = permissionSnapshot(policy, store)
  assert.equal(after.mode, before.mode, '失败不得改变权限档位')
  assert.equal(after.mode, 'workspace_edit', '失败不得升级或降级权限档位')
  assert.deepEqual(after.rules, before.rules, '失败不得增删规则')
  assert.deepEqual(after.decisions, before.decisions, '失败前后判结果必须一致')
  assert.equal(after.file, before.file, '失败不得改写持久化的权限规则文件')
})

// ---------------------------------------------------------------------------
// FB-02：hooks 超时 / 非零退出 / 递归都不得拖垮主循环。
// ---------------------------------------------------------------------------

test('FB-02 hooks 超时：按失败跳过且主循环不死锁', async (t) => {
  const home = tempDir('budingx-fb02-timeout-home-')
  const dir = tempDir('budingx-fb02-timeout-script-')
  const script = writeScript(dir, 'hang', 'setTimeout(() => process.exit(0), 600)')
  const runner = commandRunner(home, {
    UserPromptSubmit: [{ hooks: [commandHook(script, 0.2)] }]
  })

  const result = await runner.run('UserPromptSubmit', { prompt: 'hi' })
  assert.equal(result.blocked, false, '超时的 hook 不得阻断回合')
  assert.ok(result.warnings.length > 0, '超时必须给出可诊断的告警')
  assert.match(result.warnings[0], /超时/)
  const execution = runner.executions().at(-1)
  assert.equal(execution.event, 'UserPromptSubmit')
  assert.equal(execution.exitCode, null, '被 kill 的 hook 没有退出码')

  const turn = await runTurn(t, { hooks: runner })
  assert.equal(finalized(turn.events).outcome, 'completed', 'hook 超时不得让主循环崩溃')
  const warning = turn.events.find(
    (event) => event.type === 'notice' && event.code === 'hook_warning'
  )
  assert.ok(warning, 'hook 超时必须产生 hook_warning 通知')
  assert.match(warning.text, /超时/)
})

test('FB-02 hooks 非零退出：按失败跳过、可诊断，且不改变工具结局', async (t) => {
  const home = tempDir('budingx-fb02-exit-home-')
  const dir = tempDir('budingx-fb02-exit-script-')
  const script = writeScript(dir, 'fail', 'process.stderr.write("HOOK-FAIL"); process.exit(3)')
  const runner = commandRunner(home, {
    PreToolUse: [{ matcher: 'probe', hooks: [commandHook(script)] }]
  })

  const result = await runner.run('PreToolUse', { tool_name: 'probe', tool_input: {} })
  assert.equal(result.blocked, false, '非零退出码不等于阻断')
  assert.match(result.warnings[0], /退出码 3/)
  const execution = runner.executions().at(-1)
  assert.equal(execution.exitCode, 3, '退出码必须可诊断')
  assert.equal(execution.blocked, undefined, '退出码 3 不是阻断退出码')

  const received = []
  const turn = await runTurn(t, { hooks: runner, tools: [probeTool(received)] })
  assert.equal(received.length, 1, '非零退出不得阻断工具执行')
  assert.equal(finalized(turn.events).outcome, 'completed')
  const warning = turn.events.find(
    (event) => event.type === 'notice' && event.code === 'hook_warning'
  )
  assert.ok(warning, 'hook 非零退出必须产生 hook_warning 通知')
  assert.match(warning.text, /退出码 3/)
})

test('FB-02 hooks 递归：hook 触发 hook 时调用次数有界', async (t) => {
  const home = tempDir('budingx-fb02-recursion-home-')
  const dir = tempDir('budingx-fb02-recursion-script-')
  const script = writeScript(dir, 'ok', 'process.stdout.write("")')
  const runner = commandRunner(home, {
    SessionStart: [{ hooks: [commandHook(script)] }],
    PreToolUse: [{ matcher: 'probe', hooks: [commandHook(script)] }]
  })
  // SessionStart 处理过程中再触发一次 PreToolUse：hook 触发 hook。
  const nested = {
    async run(event, input) {
      if (event === 'SessionStart') {
        await runner.run('PreToolUse', { tool_name: 'probe', tool_input: {} })
      }
      return runner.run(event, input)
    }
  }

  const received = []
  const turn = await runTurn(t, { hooks: nested, tools: [probeTool(received)] })
  assert.equal(finalized(turn.events).outcome, 'completed', '递归 hook 不得让主循环崩溃')
  const executions = runner.executions()
  assert.equal(
    executions.filter((entry) => entry.event === 'SessionStart').length,
    1,
    'SessionStart 每个 session 只执行一次'
  )
  assert.equal(
    executions.filter((entry) => entry.event === 'PreToolUse').length,
    2,
    'hook 触发 hook 的次数必须有界（嵌套 1 次 + 回合内 1 次）'
  )
  assert.equal(received.length, 1, '递归 hook 不得重复触发工具执行')
})

test('FB-02 hooks 无界自调用：被收敛为 hook_warning，主循环存活', async (t) => {
  let calls = 0
  const recursive = {
    run(event, input) {
      calls += 1
      return recursive.run(event, input)
    }
  }

  const turn = await runTurn(t, { hooks: recursive })
  assert.ok(calls > 1, '必须确实发生递归调用')
  assert.ok(calls < 100000, '递归调用必须有界，不得无限递归')
  const warning = turn.events.find(
    (event) => event.type === 'notice' && event.code === 'hook_warning'
  )
  assert.ok(warning, '递归 hook 必须被收敛为 hook_warning')
  assert.match(warning.text, /hook 执行失败/)
  assert.equal(finalized(turn.events).outcome, 'completed', '主循环不得崩溃')
})

// ---------------------------------------------------------------------------
// FB-03：MCP 断线 / 超时 / 取消 / 输出上限，以及断连后的延迟工具公告移除。
// ---------------------------------------------------------------------------

test('FB-03 MCP 断线：listTools / callTool 抛出可诊断错误', async (t) => {
  const client = await McpClient.connect(
    { name: 'demo', command: process.execPath, args: [fakeMcpServer] },
    { connectTimeoutMs: 8000, callTimeoutMs: 3000 }
  )
  t.after(() => client.close())
  const descriptors = await client.listTools()
  assert.ok(descriptors.some((tool) => tool.name === 'echo'))

  await assert.rejects(
    () => client.callTool('crash', {}),
    (error) => error.code === 'BUDINGX_MCP_SERVER_EXITED'
  )
  assert.equal(await waitFor(() => client.isClosed), true, '服务器退出后客户端必须标记已关闭')

  await assert.rejects(
    () => client.listTools(),
    (error) => error.code === 'BUDINGX_MCP_SERVER_EXITED'
  )
  await assert.rejects(
    () => client.callTool('echo', {}),
    (error) => error.code === 'BUDINGX_MCP_SERVER_EXITED'
  )
})

test('FB-03 MCP 超时：连接超时与调用超时都可诊断', async (t) => {
  const dir = tempDir('budingx-fb03-mute-')
  const mute = writeScript(dir, 'mute-mcp', MUTE_MCP_SERVER)
  await assert.rejects(
    () => McpClient.connect(
      { name: 'mute', command: process.execPath, args: [mute] },
      { connectTimeoutMs: 400 }
    ),
    (error) => error.code === 'BUDINGX_MCP_TIMEOUT'
  )

  const client = await McpClient.connect(
    { name: 'demo', command: process.execPath, args: [fakeMcpServer] },
    { connectTimeoutMs: 8000, callTimeoutMs: 300 }
  )
  t.after(() => client.close())
  await assert.rejects(
    () => client.callTool('slow', {}),
    (error) => error.code === 'BUDINGX_MCP_TIMEOUT' && /超时/.test(error.message)
  )
})

test('FB-03 MCP 取消：关闭客户端后挂起调用与后续调用都报可诊断错误', async (t) => {
  const client = await McpClient.connect(
    { name: 'demo', command: process.execPath, args: [fakeMcpServer] },
    { connectTimeoutMs: 8000, callTimeoutMs: 8000 }
  )
  const pending = client.callTool('slow', {}).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error })
  )
  await delay(100)
  await client.close()
  const outcome = await pending
  assert.equal(outcome.ok, false, '挂起的调用必须因取消而失败')
  assert.equal(outcome.error.code, 'BUDINGX_MCP_SERVER_EXITED')
  assert.equal(client.isClosed, true)
  await assert.rejects(
    () => client.callTool('echo', {}),
    (error) => error.code === 'BUDINGX_MCP_SERVER_EXITED'
  )
})

test('FB-03 MCP 输出上限：超限输出被截断并带显式标记', async (t) => {
  const dir = tempDir('budingx-fb03-big-')
  const big = writeScript(dir, 'big-mcp', BIG_MCP_SERVER)
  const client = await McpClient.connect(
    { name: 'big', command: process.execPath, args: [big] },
    { connectTimeoutMs: 8000, callTimeoutMs: 8000 }
  )
  t.after(() => client.close())
  const tools = toAgentTools(client)
  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, 'mcp__big__big')

  const turn = await runTurn(t, {
    tools,
    mode: 'full_access',
    script: [toolTurn('mcp__big__big', {}), FINAL]
  })
  const results = toolResults(turn.events)
  assert.equal(results.length, 1)
  assert.equal(results[0].isError, false, 'MCP 调用成功，截断内容仍可用')
  assert.match(results[0].content, /\[truncated\]/, '截断必须带显式标记')
  assert.doesNotMatch(results[0].content, /BUDINGX_CORE_003/)
  assert.ok(
    results[0].content.length <= 32768,
    '截断后的内容连同标记不得超过上限：' + results[0].content.length
  )
})

test('FB-03 断连后延迟工具公告可移除', async (t) => {
  const client = await McpClient.connect(
    { name: 'demo', command: process.execPath, args: [fakeMcpServer] },
    { connectTimeoutMs: 8000, callTimeoutMs: 3000 }
  )
  t.after(() => client.close())
  const live = toAgentTools(client)
  assert.ok(live.length > 0)
  const search = createToolSearch({
    tools: live,
    contextWindow: 100,
    env: { BUDINGX_TOOL_SEARCH: 'auto:0' }
  })
  const before = search.notice()
  assert.ok(before.includes('mcp__demo__echo'), '延迟工具公告必须列出 MCP 工具')

  // 服务器崩溃：宿主把断连服务器的工具从活表里摘掉。
  await client.callTool('crash', {}).catch(() => {})
  assert.equal(await waitFor(() => client.isClosed), true)
  const index = live.findIndex((tool) => tool.name === 'mcp__demo__echo')
  assert.ok(index >= 0)
  live.splice(index, 1)

  const after = search.notice()
  assert.ok(!after.includes('mcp__demo__echo'), '断连工具必须从延迟工具公告中移除')
  assert.ok(after.includes('mcp__demo__fail'), '未断连的工具必须仍在公告中')
})

// ---------------------------------------------------------------------------
// FB-04：headless stream-json 的既有形状 / 终态 / 退出码不变，
//         新的 agent_* 事件不得出现在 headless 输出中。
// ---------------------------------------------------------------------------

test('FB-04 headless stream-json：事件形状、终态与退出码不变', async (t) => {
  const fixture = await fixtureServer(t)
  const result = await runCli(['--prompt', 'hi', '--output-format', 'stream-json'], '', {
    BUDINGX_BASE_URL: fixture.baseUrl
  })
  assert.equal(result.code, 0, result.err)
  const events = result.out.trim().split('\n').map((line) => JSON.parse(line))
  const allowed = new Set(['system', 'user', 'assistant', 'tool_call', 'tool_result', 'result'])
  for (const event of events) {
    assert.ok(allowed.has(event.type), 'headless 出现未知事件类型：' + event.type)
  }
  const init = events[0]
  assert.equal(init.type, 'system')
  assert.equal(init.subtype, 'init')
  assert.equal(typeof init.session_id, 'string')
  assert.equal(init.model, 'fixture')
  assert.ok(Array.isArray(init.tools) && init.tools.length > 0)
  const user = events.find((event) => event.type === 'user')
  assert.equal(user.message.content, 'hi')
  const assistant = events.filter((event) => event.type === 'assistant')
  assert.equal(
    assistant.filter((event) => event.delta).map((event) => event.message.content).join(''),
    'hello'
  )
  assert.equal(assistant.at(-1).delta, false)
  const results = events.filter((event) => event.type === 'result')
  assert.equal(results.length, 1, '终态 result 只能出现一次')
  const last = results[0]
  assert.equal(last.subtype, 'success')
  assert.equal(last.is_error, false)
  assert.equal(last.num_turns, 1)
  assert.equal(last.stop_reason, 'completed')
  assert.equal(typeof last.session_id, 'string')
  assert.equal(last.total_cost_usd, 0)
  assert.ok(Array.isArray(last.permission_denials))
  assert.equal(events.at(-1).type, 'result', 'result 必须是最后一个事件')
})

test('FB-04 headless 失败回合：退出码 1 与终态 subtype 不变', async (t) => {
  const failing = createServer((req, res) => {
    req.resume()
    // 401 属于不可重试的鉴权失败：让 CLI 立即失败，避免退避重试拉长用例时长。
    res.writeHead(401)
    res.end('boom')
  })
  failing.listen(0, '127.0.0.1')
  await once(failing, 'listening')
  t.after(() => { failing.closeAllConnections(); failing.close() })

  const result = await runCli(['--prompt', 'hi', '--output-format', 'stream-json'], '', {
    BUDINGX_BASE_URL: 'http://127.0.0.1:' + failing.address().port + '/v1'
  })
  assert.equal(result.code, 1, '失败回合必须以退出码 1 结束')
  const events = result.out.trim().split('\n').map((line) => JSON.parse(line))
  const last = events.at(-1)
  assert.equal(last.type, 'result')
  assert.equal(last.subtype, 'error_during_execution')
  assert.equal(last.is_error, true)
  assert.ok(Array.isArray(last.errors) && last.errors.length >= 1)
})

test('FB-04 headless：不得输出 agent_* 事件，notice 沿用既有映射纪律', async (t) => {
  const fixture = await fixtureServer(t)
  const result = await runCli(['--prompt', 'hi', '--output-format', 'stream-json'], '', {
    BUDINGX_BASE_URL: fixture.baseUrl
  })
  assert.equal(result.code, 0, result.err)
  const events = result.out.trim().split('\n').map((line) => JSON.parse(line))
  for (const code of ['agent_started', 'agent_progress', 'agent_finished']) {
    assert.equal(result.out.includes(code), false, 'headless 不得输出 ' + code)
  }
  assert.equal(
    events.some((event) => event.type === 'notice'),
    false,
    'notice 不属于 headless 协议（沿用既有映射纪律）'
  )
  const source = readFileSync(headlessDist, 'utf8')
  for (const code of ['agent_started', 'agent_progress', 'agent_finished']) {
    assert.equal(source.includes(code), false, 'headless 产物不得引入 agent_* 事件：' + code)
  }
  assert.ok(source.includes('file_context'), '既有 file_context → stderr 映射必须保留')
})

test('FB-04 headless 输出格式纪律不变：text 只出增量，json 只出终态', () => {
  assert.equal(
    formatHeadlessEvent(
      { type: 'assistant', message: { role: 'assistant', content: 'hi' }, delta: true },
      'text'
    ),
    'hi'
  )
  assert.equal(
    formatHeadlessEvent(
      { type: 'assistant', message: { role: 'assistant', content: 'hi' }, delta: false },
      'text'
    ),
    undefined
  )
  const json = formatHeadlessEvent(
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 1,
      duration_api_ms: 0,
      num_turns: 1,
      stop_reason: 'completed',
      session_id: 's1',
      total_cost_usd: 0,
      usage: null,
      permission_denials: []
    },
    'json'
  )
  const parsed = JSON.parse(json)
  assert.equal(parsed.type, undefined, 'json 格式不得带 type 包装')
  assert.equal(parsed.subtype, 'success')
  assert.equal(parsed.num_turns, 1)
})

// ---------------------------------------------------------------------------
// FB-05：依赖纪律 —— SP007 不得引入新的运行时依赖。
// ---------------------------------------------------------------------------

test('FB-05 依赖纪律：SP007 未新增运行时依赖', () => {
  const tui = JSON.parse(readFileSync(join(repoRoot, 'src/tui/package.json'), 'utf8'))
  assert.deepEqual(
    Object.keys(tui.dependencies).sort(),
    ['ink', 'lowlight', 'marked', 'react', 'string-width'],
    '产品运行时依赖集合不得变化'
  )
  assert.equal(tui.dependencies.yaml, undefined, 'yaml 只能留在根 devDependencies')
  const root = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  assert.equal(root.dependencies, undefined, '根包不得有运行时依赖')
  assert.equal(root.devDependencies.yaml, '2.8.3', 'yaml 仅作为根 devDependency')
})
