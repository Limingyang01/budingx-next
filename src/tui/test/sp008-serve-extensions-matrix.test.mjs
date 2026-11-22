// SP008 复测（第二组）：serve 宿主扩展的完整 MCP / hooks 端到端矩阵。
//
// 与 sp008-serve-extensions.test.mjs 分工：本文件补齐第一组未覆盖的面——
//   hooks 八事件全覆盖（Notification / PostToolUseFailure / StopFailure）、
//   hook updatedInput 改写入参、additionalContext 注入模型上下文、
//   hook ask 强制人工审批、MCP 多服务器并存、MCP 工具失败（isError）、
//   MCP 服务器调用后崩溃、MCP 连接失败只告警不阻断宿主启动。
//
// 全部使用真实子进程：serve 为真实进程，MCP 为自模拟 stdio 服务器，
// hooks 为真实 Node 子进程脚本。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFixtureServer, spawnServe } from './helpers/host-process.mjs'

const SIM_MCP = fileURLToPath(new URL('./helpers/sim-mcp-server.mjs', import.meta.url))

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix))
}

function commandHook(scriptPath) {
  return { type: 'command', command: '"' + process.execPath + '" "' + scriptPath + '"' }
}

function writeScript(dir, name, body) {
  const path = join(dir, name + '.mjs')
  writeFileSync(path, body, 'utf8')
  return path
}

/**
 * 写 mcp.json。servers 为 { [name]: { tools, env } }；
 * env 只允许 ${ENV} 引用（与 SM-09 一致），明文会被 MCP 配置层丢弃。
 */
function writeMcpServers(home, servers) {
  const dir = join(home, '.budingx')
  mkdirSync(dir, { recursive: true })
  const mcpServers = {}
  for (const [name, spec] of Object.entries(servers)) {
    mcpServers[name] = {
      command: process.execPath,
      args: [SIM_MCP],
      env: {
        SIM_MCP_NAME: '${SIM_MCP_NAME_' + name.toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '}',
        ...(spec.env ?? {})
      },
      ...(spec.disabled ? { enabled: false } : {})
    }
  }
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ mcpServers }), 'utf8')
}

function writeHooks(home, hooks) {
  const dir = join(home, '.budingx')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks }), 'utf8')
}

/** 记录事件名与工具名；工具名缺失时用 '-'。 */
const LOG_HOOK = [
  'import { appendFileSync } from "node:fs"',
  'import { EOL } from "node:os"',
  'let data = ""',
  'process.stdin.setEncoding("utf8")',
  'process.stdin.on("data", (chunk) => { data += chunk })',
  'process.stdin.on("end", () => {',
  '  const payload = JSON.parse(data || "{}")',
  '  const name = payload.tool_name ?? "-"',
  '  appendFileSync(process.env.HOOK_LOG, payload.hook_event_name + "|" + name + EOL)',
  '})'
].join('\n')

/** 记录工具入参，用于断言 updatedInput 真的改写了调用参数。 */
const LOG_INPUT_HOOK = [
  'import { appendFileSync } from "node:fs"',
  'import { EOL } from "node:os"',
  'let data = ""',
  'process.stdin.setEncoding("utf8")',
  'process.stdin.on("data", (chunk) => { data += chunk })',
  'process.stdin.on("end", () => {',
  '  const payload = JSON.parse(data || "{}")',
  '  appendFileSync(process.env.HOOK_LOG, JSON.stringify(payload.tool_input ?? {}) + EOL)',
  '})'
].join('\n')

const UPDATED_INPUT_HOOK =
  'process.stdout.write(JSON.stringify({ hookSpecificOutput: { updatedInput: { text: "rewritten-by-hook" } } }))'

const CONTEXT_HOOK =
  'process.stdout.write(JSON.stringify({ hookSpecificOutput: { additionalContext: "CTX-SIM-42" } }))'

const ASK_HOOK =
  'process.stdout.write(JSON.stringify({ hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "simulated ask" } }))'

function readLines(path) {
  try {
    return readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '')
  } catch {
    return []
  }
}

async function waitFor(predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) return
    if (Date.now() > deadline) throw new Error('timed out waiting for ' + label)
    await new Promise((resolveWait) => setTimeout(resolveWait, 30))
  }
}

function waitForEvent(client, predicate, label, timeoutMs = 25_000) {
  return new Promise((resolveEvent, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error('timed out waiting for ' + label))
    }, timeoutMs)
    const off = client.onEvent((event) => {
      if (!predicate(event)) return
      clearTimeout(timer)
      off()
      resolveEvent(event)
    })
  })
}

function eventLog(client) {
  const events = []
  client.onEvent((event, seq) => events.push({ type: event.type, seq, event }))
  return events
}

function lockPath(home, sessionId) {
  return join(home, '.budingx', 'sessions', sessionId, 'writer.lock')
}

test('serve WS：hooks 八事件全覆盖（Notification / PostToolUseFailure / StopFailure）', async (t) => {
  const fixture = await startFixtureServer(t, 'mcp')
  const home = tempDir('budingx-sp008-hook8-')
  const dir = tempDir('budingx-sp008-hook8-script-')
  const hookLog = join(dir, 'events.log')
  const logger = writeScript(dir, 'log', LOG_HOOK)
  writeMcpServers(home, { sim: { env: { SIM_MCP_PID_FILE: '${SIM_MCP_PID_FILE}' } } })
  writeHooks(home, {
    SessionStart: [{ hooks: [commandHook(logger)] }],
    UserPromptSubmit: [{ hooks: [commandHook(logger)] }],
    PreToolUse: [{ hooks: [commandHook(logger)] }],
    PostToolUse: [{ hooks: [commandHook(logger)] }],
    PostToolUseFailure: [{ hooks: [commandHook(logger)] }],
    Stop: [{ hooks: [commandHook(logger)] }],
    StopFailure: [{ hooks: [commandHook(logger)] }],
    Notification: [{ hooks: [commandHook(logger)] }]
  })
  const serve = spawnServe(t, {
    args: ['--transport', 'ws', '--session', 'hook8'],
    baseUrl: fixture.baseUrl,
    home,
    env: { HOOK_LOG: hookLog, SIM_MCP_PID_FILE: join(dir, 'mcp.pid') }
  })
  await serve.ready
  const { client } = await serve.connect()
  await client.request('submit', { text: 'run the mcp tool once' })
  const requested = await waitForEvent(client, (event) => event.type === 'approval_requested', 'approval_requested')
  try {
    const ar = await client.request('approval', { requestId: requested.requestId, outcome: 'allow' })
    } catch (error) {
    }
  await waitForEvent(client, (event) => event.type === 'turn_finalized', 'turn_finalized')
  // Notification / PostToolUse / Stop 都是 fire-and-forget 的旁路 hook：
  // turn_finalized 之后仍可能才落盘，必须等日志而不是等事件。
  await waitFor(
    () => {
      const seen = readLines(hookLog)
      return seen.some((line) => line.startsWith('Notification|')) &&
        seen.some((line) => line.startsWith('PostToolUse|')) &&
        seen.some((line) => line.startsWith('Stop|'))
    },
    'Notification / PostToolUse / Stop hooks'
  )
  const lines = readLines(hookLog)
  for (const expected of [
    'SessionStart|-',
    'UserPromptSubmit|-',
    'PreToolUse|mcp__sim__echo',
    'PostToolUse|mcp__sim__echo',
    'Notification|-',
    'Stop|-'
  ]) {
    assert.ok(lines.includes(expected), '必须触发 hook 事件 ' + expected + '，实际：' + JSON.stringify(lines))
  }
  assert.equal(lines.some((line) => line.startsWith('StopFailure|')), false, '成功回合不应触发 StopFailure')
  await client.request('shutdown')
  assert.equal((await serve.closed).code, 0)
})

test('serve WS：PreToolUse updatedInput 改写 MCP 工具入参', async (t) => {
  const fixture = await startFixtureServer(t, 'mcp')
  const home = tempDir('budingx-sp008-updated-')
  const dir = tempDir('budingx-sp008-updated-script-')
  const inputLog = join(dir, 'inputs.log')
  const callLog = join(dir, 'calls.log')
  const logger = writeScript(dir, 'input', LOG_INPUT_HOOK)
  const rewriter = writeScript(dir, 'rewrite', UPDATED_INPUT_HOOK)
  writeMcpServers(home, { sim: { env: { SIM_MCP_CALL_LOG: '${SIM_MCP_CALL_LOG}' } } })
  writeHooks(home, {
    PreToolUse: [
      { matcher: 'mcp__sim__echo', hooks: [commandHook(logger), commandHook(rewriter)] }
    ]
  })
  const serve = spawnServe(t, {
    args: ['--transport', 'ws', '--session', 'updated-input'],
    baseUrl: fixture.baseUrl,
    home,
    env: { HOOK_LOG: inputLog, SIM_MCP_CALL_LOG: callLog }
  })
  await serve.ready
  const { client } = await serve.connect()
  await client.request('submit', { text: 'call the mcp tool' })
  const requested = await waitForEvent(client, (event) => event.type === 'approval_requested', 'approval_requested')
  await client.request('approval', { requestId: requested.requestId, outcome: 'allow' })
  await waitForEvent(client, (event) => event.type === 'turn_finalized', 'turn_finalized')
  const calls = readLines(callLog)
  assert.equal(calls.length, 1, 'MCP 服务器必须收到一次调用')
  assert.deepEqual(JSON.parse(calls[0]).args, { text: 'rewritten-by-hook' }, 'hook 必须改写工具入参')
  await client.request('shutdown')
  assert.equal((await serve.closed).code, 0)
})

test('serve WS：hook additionalContext 注入模型请求上下文', async (t) => {
  const fixture = await startFixtureServer(t, 'text')
  const home = tempDir('budingx-sp008-ctx-')
  const dir = tempDir('budingx-sp008-ctx-script-')
  const contextHook = writeScript(dir, 'context', CONTEXT_HOOK)
  writeHooks(home, { UserPromptSubmit: [{ hooks: [commandHook(contextHook)] }] })
  const serve = spawnServe(t, {
    args: ['--transport', 'ws', '--session', 'hook-context'],
    baseUrl: fixture.baseUrl,
    home
  })
  await serve.ready
  const { client } = await serve.connect()
  await client.request('submit', { text: 'hello there' })
  await waitForEvent(client, (event) => event.type === 'turn_finalized', 'turn_finalized')
  assert.ok(fixture.requestCount >= 1, '必须请求模型')
  const systemText = fixture.requests
    .flatMap((body) => body.messages ?? [])
    .filter((message) => message.role === 'system')
    .map((message) => String(message.content ?? ''))
    .join('\n')
  assert.match(systemText, /CTX-SIM-42/, 'hook 附加上下文必须进入模型请求')
  await client.request('shutdown')
  assert.equal((await serve.closed).code, 0)
})

test('serve WS：hook ask 强制回到人工审批（不静默放行）', async (t) => {
  const fixture = await startFixtureServer(t, 'mcp')
  const home = tempDir('budingx-sp008-ask-')
  const dir = tempDir('budingx-sp008-ask-script-')
  const ask = writeScript(dir, 'ask', ASK_HOOK)
  writeMcpServers(home, { sim: { env: { SIM_MCP_CALL_LOG: '${SIM_MCP_CALL_LOG}' } } })
  writeHooks(home, { PreToolUse: [{ matcher: 'mcp__sim__echo', hooks: [commandHook(ask)] }] })
  const serve = spawnServe(t, {
    args: ['--transport', 'ws', '--session', 'hook-ask'],
    baseUrl: fixture.baseUrl,
    home,
    env: { SIM_MCP_CALL_LOG: join(dir, 'calls.log') }
  })
  await serve.ready
  const { client } = await serve.connect()
  const events = eventLog(client)
  await client.request('submit', { text: 'call the mcp tool' })
  const requested = await waitForEvent(client, (event) => event.type === 'approval_requested', 'approval_requested')
  assert.equal(requested.name, 'mcp__sim__echo')
  await client.request('approval', { requestId: requested.requestId, outcome: 'allow' })
  await waitForEvent(client, (event) => event.type === 'turn_finalized', 'turn_finalized')
  assert.ok(events.some((entry) => entry.type === 'approval_requested'), 'hook ask 必须仍然走人工审批')
  assert.equal(readLines(join(dir, 'calls.log')).length, 1)
  await client.request('shutdown')
  assert.equal((await serve.closed).code, 0)
})

test('serve WS：多个 MCP 服务器并存，工具名按服务器隔离', async (t) => {
  const fixture = await startFixtureServer(t, 'mcp', {
    toolCall: { id: 'call-multi', name: 'mcp__beta__echo', args: { text: 'multi' } }
  })
  const home = tempDir('budingx-sp008-multi-')
  const dir = tempDir('budingx-sp008-multi-script-')
  const alphaCalls = join(dir, 'alpha-calls.log')
  const betaCalls = join(dir, 'beta-calls.log')
  writeMcpServers(home, {
    alpha: { env: { SIM_MCP_CALL_LOG: '${SIM_MCP_ALPHA_CALL_LOG}' } },
    beta: { env: { SIM_MCP_CALL_LOG: '${SIM_MCP_BETA_CALL_LOG}' } }
  })
  const serve = spawnServe(t, {
    args: ['--transport', 'ws', '--session', 'mcp-multi'],
    baseUrl: fixture.baseUrl,
    home,
    env: { SIM_MCP_ALPHA_CALL_LOG: alphaCalls, SIM_MCP_BETA_CALL_LOG: betaCalls }
  })
  await serve.ready
  const { client } = await serve.connect()
  await client.request('submit', { text: 'call beta tool' })
  const requested = await waitForEvent(client, (event) => event.type === 'approval_requested', 'approval_requested')
  assert.equal(requested.name, 'mcp__beta__echo')
  await client.request('approval', { requestId: requested.requestId, outcome: 'allow' })
  await waitForEvent(client, (event) => event.type === 'turn_finalized', 'turn_finalized')
  assert.equal(readLines(betaCalls).length, 1, 'beta 服务器必须收到调用')
  assert.equal(readLines(alphaCalls).length, 0, 'alpha 服务器不得收到调用')
  await client.request('shutdown')
  assert.equal((await serve.closed).code, 0)
})

test('serve WS：MCP 工具失败返回 isError 工具结果，不崩宿主', async (t) => {
  const fixture = await startFixtureServer(t, 'mcp')
  const home = tempDir('budingx-sp008-mcpfail-')
  const dir = tempDir('budingx-sp008-mcpfail-script-')
  const callLog = join(dir, 'calls.log')
  writeMcpServers(home, { sim: { env: { SIM_MCP_CALL_LOG: '${SIM_MCP_CALL_LOG}' } } })
  const serve = spawnServe(t, {
    args: ['--transport', 'ws', '--session', 'mcp-fail'],
    baseUrl: fixture.baseUrl,
    home,
    env: {
      SIM_MCP_CALL_LOG: callLog,
      SIM_MCP_FAIL_TOOL: 'echo',
      SIM_MCP_FAIL_MODE: 'error'
    }
  })
  await serve.ready
  const { client } = await serve.connect()
  const events = eventLog(client)
  await client.request('submit', { text: 'call the failing tool' })
  const requested = await waitForEvent(client, (event) => event.type === 'approval_requested', 'approval_requested')
  await client.request('approval', { requestId: requested.requestId, outcome: 'allow' })
  const final = await waitForEvent(client, (event) => event.type === 'turn_finalized', 'turn_finalized')
  const result = events.find((entry) => entry.type === 'tool_result')
  assert.ok(result, '工具失败也必须产生 tool_result')
  assert.equal(result.event.isError, true, 'MCP isError 结果必须标记为工具失败')
  assert.equal(readLines(callLog).length, 1)
  // 宿主不能因工具失败而崩溃：连接仍可用。
  const pong = await client.request('ping')
  assert.deepEqual(pong, { pong: true })
  await client.request('shutdown')
  assert.equal((await serve.closed).code, 0)
  assert.equal(existsSync(lockPath(home, 'mcp-fail')), false)
})

test('serve WS：MCP 服务器崩溃后宿主保持可用并可关闭', async (t) => {
  const fixture = await startFixtureServer(t, 'mcp')
  const home = tempDir('budingx-sp008-mcpcrash-')
  const dir = tempDir('budingx-sp008-mcpcrash-script-')
  writeMcpServers(home, { sim: { env: { SIM_MCP_CALL_LOG: '${SIM_MCP_CALL_LOG}' } } })
  const serve = spawnServe(t, {
    args: ['--transport', 'ws', '--session', 'mcp-crash'],
    baseUrl: fixture.baseUrl,
    home,
    env: {
      SIM_MCP_CALL_LOG: join(dir, 'calls.log'),
      SIM_MCP_FAIL_TOOL: 'echo',
      SIM_MCP_FAIL_MODE: 'crash'
    }
  })
  await serve.ready
  const { client } = await serve.connect()
  await client.request('submit', { text: 'call the crashing tool' })
  const requested = await waitForEvent(client, (event) => event.type === 'approval_requested', 'approval_requested')
  await client.request('approval', { requestId: requested.requestId, outcome: 'allow' })
  await waitForEvent(client, (event) => event.type === 'turn_finalized', 'turn_finalized')
  const pong = await client.request('ping')
  assert.deepEqual(pong, { pong: true }, 'MCP 子进程崩溃不得让宿主不可用')
  await client.request('shutdown')
  assert.equal((await serve.closed).code, 0)
  assert.equal(existsSync(lockPath(home, 'mcp-crash')), false)
})

test('serve WS：MCP 连接失败只告警，宿主照常启动并可对话', async (t) => {
  const fixture = await startFixtureServer(t, 'text')
  const home = tempDir('budingx-sp008-mcpwarn-')
  const dir = join(home, '.budingx')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        broken: {
          command: process.execPath,
          args: [join(dir, 'not-a-server.mjs')]
        }
      }
    }),
    'utf8'
  )
  const serve = spawnServe(t, {
    args: ['--transport', 'ws', '--session', 'mcp-warn'],
    baseUrl: fixture.baseUrl,
    home
  })
  await serve.ready
  assert.match(serve.stderr, /Warning: MCP broken/, '连接失败必须写 stderr 告警：' + serve.stderr)
  const { client } = await serve.connect()
  assert.equal(client !== undefined, true)
  await client.request('submit', { text: 'hello' })
  const final = await waitForEvent(client, (event) => event.type === 'turn_finalized', 'turn_finalized')
  assert.equal(final.outcome, 'completed')
  await client.request('shutdown')
  assert.equal((await serve.closed).code, 0)
})
