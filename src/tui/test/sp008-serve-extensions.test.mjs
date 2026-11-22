// SP008 复测：serve 接入自模拟 MCP 与 hooks（真实子进程、真实 stdio/WS 传输）。
// 覆盖：MCP 工具经审批执行、hooks 全生命周期、提示词阻断、工具拒绝、
// hook allow 跳过审批、observer 不启动扩展、关闭后 MCP 子进程退出。
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

function writeMcp(home) {
  const dir = join(home, '.budingx')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        sim: {
          command: process.execPath,
          args: [SIM_MCP],
          env: { SIM_MCP_PID_FILE: '${SIM_MCP_PID_FILE}', SIM_MCP_CALL_LOG: '${SIM_MCP_CALL_LOG}' }
        }
      }
    }),
    'utf8'
  )
}

function writeHooks(home, hooks) {
  const dir = join(home, '.budingx')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks }), 'utf8')
}

const LOG_HOOK = [
  'import { appendFileSync } from "node:fs"',
  'let data = ""',
  'process.stdin.setEncoding("utf8")',
  'process.stdin.on("data", (chunk) => { data += chunk })',
  'process.stdin.on("end", () => {',
  '  const payload = JSON.parse(data || "{}")',
  '  appendFileSync(process.env.HOOK_LOG, payload.hook_event_name + "|" + (payload.tool_name ?? "") + "\\n")',
  '})'
].join('\n')

const BLOCK_HOOK = 'process.stderr.write("simulated prompt block\\n"); process.exit(2)'
const DENY_HOOK =
  'process.stdout.write(JSON.stringify({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "simulated deny" } }))'
const ALLOW_HOOK =
  'process.stdout.write(JSON.stringify({ hookSpecificOutput: { permissionDecision: "allow" } }))'

function readLines(path) {
  try {
    return readFileSync(path, 'utf8').split('\n').filter((line) => line.trim() !== '')
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

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
test('serve stdio：MCP 工具经审批执行、hooks 全生命周期触发、关闭后 MCP 子进程退出', async (t) => {
  const fixture = await startFixtureServer(t, 'mcp')
  const home = tempDir('budingx-sp008-ext-stdio-')
  const dir = tempDir('budingx-sp008-ext-script-')
  const hookLog = join(dir, 'events.log')
  const pidFile = join(dir, 'mcp.pid')
  const callLog = join(dir, 'mcp-calls.log')
  const logger = writeScript(dir, 'log', LOG_HOOK)
  writeMcp(home)
  writeHooks(home, {
    SessionStart: [{ hooks: [commandHook(logger)] }],
    UserPromptSubmit: [{ hooks: [commandHook(logger)] }],
    PreToolUse: [{ hooks: [commandHook(logger)] }],
    PostToolUse: [{ hooks: [commandHook(logger)] }],
    Stop: [{ hooks: [commandHook(logger)] }]
  })
  const sessionId = 'ext-stdio'
  const serve = spawnServe(t, {
    args: ['--transport', 'stdio', '--session', sessionId],
    baseUrl: fixture.baseUrl,
    home,
    env: { HOOK_LOG: hookLog, SIM_MCP_PID_FILE: pidFile, SIM_MCP_CALL_LOG: callLog }
  })
  await serve.ready
  const { client, hello } = await serve.connect()
  assert.equal(hello.role, 'owner')
  const events = eventLog(client)
  assert.deepEqual(await client.request('submit', { text: 'call the simulated mcp echo tool' }), { accepted: true })
  const requested = await waitForEvent(client, (event) => event.type === 'approval_requested', 'approval_requested')
  assert.equal(requested.name, 'mcp__sim__echo')
  await client.request('approval', { requestId: requested.requestId, outcome: 'allow' })
  const final = await waitForEvent(client, (event) => event.type === 'turn_finalized', 'turn_finalized')
  assert.equal(final.outcome, 'completed')
  const toolResult = events.find((entry) => entry.type === 'tool_result')
  assert.ok(toolResult, 'MCP 工具必须产生 tool_result')
  assert.equal(toolResult.event.isError, false)
  assert.match(toolResult.event.content, /sim-echo:/)
  assert.match(toolResult.event.content, /hello/)
  const calls = readLines(callLog)
  assert.equal(calls.length, 1, 'MCP 服务器必须真的收到一次 tools/call')
  assert.deepEqual(JSON.parse(calls[0]), { name: 'echo', args: { text: 'hello' } })
  await waitFor(() => readLines(hookLog).some((line) => line.startsWith('Stop|')), 'Stop hook')
  assert.deepEqual(readLines(hookLog), [
    'SessionStart|',
    'UserPromptSubmit|',
    'PreToolUse|mcp__sim__echo',
    'PostToolUse|mcp__sim__echo',
    'Stop|'
  ])
  const pid = Number(readFileSync(pidFile, 'utf8').trim())
  assert.ok(Number.isInteger(pid) && pid > 0, 'MCP 子进程 pid 必须落盘')
  assert.equal(pidAlive(pid), true, 'serve 运行期间 MCP 子进程存活')
  await client.request('shutdown')
  const closed = await serve.closed
  assert.equal(closed.code, 0)
  assert.equal(existsSync(lockPath(home, sessionId)), false)
  await waitFor(() => !pidAlive(pid), 'MCP child exit after shutdown')
})

test('serve WS：UserPromptSubmit 阻断不请求模型；PreToolUse deny 不执行 MCP 工具', async (t) => {
  const fixture = await startFixtureServer(t, 'mcp')
  const dir = tempDir('budingx-sp008-ext-ws-script-')
  const blockHome = tempDir('budingx-sp008-ext-block-')
  const block = writeScript(dir, 'block', BLOCK_HOOK)
  writeHooks(blockHome, { UserPromptSubmit: [{ hooks: [commandHook(block)] }] })
  const blockServe = spawnServe(t, {
    args: ['--transport', 'ws', '--session', 'ext-ws-block'],
    baseUrl: fixture.baseUrl,
    home: blockHome
  })
  await blockServe.ready
  const blocked = await blockServe.connect()
  assert.equal(blocked.hello.role, 'owner')
  await blocked.client.request('submit', { text: 'this prompt must be blocked' })
  const blockFinal = await waitForEvent(blocked.client, (event) => event.type === 'turn_finalized', 'blocked turn')
  assert.equal(blockFinal.outcome, 'error')
  assert.equal(blockFinal.error.code, 'BUDINGX_HOOK_BLOCKED')
  assert.equal(fixture.requestCount, 0, '被阻断的提示词不得发给模型')
  await blocked.client.request('shutdown')
  assert.equal((await blockServe.closed).code, 0)

  const denyHome = tempDir('budingx-sp008-ext-deny-')
  const denyCallLog = join(dir, 'deny-calls.log')
  const denyPidFile = join(dir, 'deny-mcp.pid')
  const deny = writeScript(dir, 'deny', DENY_HOOK)
  writeMcp(denyHome)
  writeHooks(denyHome, { PreToolUse: [{ matcher: 'mcp__sim__echo', hooks: [commandHook(deny)] }] })
  const denyServe = spawnServe(t, {
    args: ['--transport', 'ws', '--session', 'ext-ws-deny'],
    baseUrl: fixture.baseUrl,
    home: denyHome,
    env: { SIM_MCP_PID_FILE: denyPidFile, SIM_MCP_CALL_LOG: denyCallLog }
  })
  await denyServe.ready
  const denied = await denyServe.connect()
  const denyEvents = eventLog(denied.client)
  await denied.client.request('submit', { text: 'try the mcp tool' })
  const denyFinal = await waitForEvent(denied.client, (event) => event.type === 'turn_finalized', 'denied turn')
  assert.equal(denyFinal.outcome, 'completed')
  const denial = denyEvents.find((entry) => entry.type === 'denial_recorded')
  assert.ok(denial, 'hook deny 必须记录 denial_recorded')
  const denyResult = denyEvents.find((entry) => entry.type === 'tool_result')
  assert.ok(denyResult)
  assert.match(denyResult.event.content, /Denied by hook: simulated deny/)
  assert.equal(readLines(denyCallLog).length, 0, '被 hook 拒绝的工具不得真的执行')
  assert.equal(existsSync(denyPidFile), true, 'MCP 服务器仍应连接（只是工具被拒绝）')
  await denied.client.request('shutdown')
  assert.equal((await denyServe.closed).code, 0)
})

test('serve WS：hook allow 跳过审批；observer 不启动 MCP/hooks 扩展', async (t) => {
  const fixture = await startFixtureServer(t, 'mcp')
  const home = tempDir('budingx-sp008-ext-allow-')
  const dir = tempDir('budingx-sp008-ext-allow-script-')
  const pidFile = join(dir, 'allow-mcp.pid')
  const callLog = join(dir, 'allow-calls.log')
  const observerPidFile = join(dir, 'observer-mcp.pid')
  const allow = writeScript(dir, 'allow', ALLOW_HOOK)
  writeMcp(home)
  writeHooks(home, { PreToolUse: [{ matcher: 'mcp__sim__echo', hooks: [commandHook(allow)] }] })
  const sessionId = 'ext-ws-allow'
  const serve = spawnServe(t, {
    args: ['--transport', 'ws', '--session', sessionId],
    baseUrl: fixture.baseUrl,
    home,
    env: { SIM_MCP_PID_FILE: pidFile, SIM_MCP_CALL_LOG: callLog }
  })
  await serve.ready
  const owner = await serve.connect()
  assert.equal(owner.hello.role, 'owner')
  const events = eventLog(owner.client)
  await owner.client.request('submit', { text: 'run the allowed mcp tool' })
  const final = await waitForEvent(owner.client, (event) => event.type === 'turn_finalized', 'allowed turn')
  assert.equal(final.outcome, 'completed')
  assert.equal(events.some((entry) => entry.type === 'approval_requested'), false, 'hook allow 必须跳过人工审批')
  const result = events.find((entry) => entry.type === 'tool_result')
  assert.ok(result)
  assert.equal(result.event.isError, false)
  assert.match(result.event.content, /sim-echo:/)
  assert.equal(readLines(callLog).length, 1)

  const observer = spawnServe(t, {
    args: ['--transport', 'ws', '--session', sessionId],
    baseUrl: fixture.baseUrl,
    home,
    env: { SIM_MCP_PID_FILE: observerPidFile, SIM_MCP_CALL_LOG: join(dir, 'observer-calls.log') }
  })
  await observer.ready
  const watching = await observer.connect()
  assert.equal(watching.hello.role, 'observer')
  await assert.rejects(
    () => watching.client.request('submit', { text: 'observer cannot write' }),
    (error) => error.code === 'HOST_SESSION_003'
  )
  assert.equal(existsSync(observerPidFile), false, 'observer 不得启动 MCP 子进程')
  assert.equal(readLines(join(dir, 'observer-calls.log')).length, 0)
  await watching.client.request('shutdown')
  assert.equal((await observer.closed).code, 0)
  assert.equal(existsSync(lockPath(home, sessionId)), true, 'observer 关闭不得释放 owner 的锁')
  await owner.client.request('shutdown')
  assert.equal((await serve.closed).code, 0)
  assert.equal(existsSync(lockPath(home, sessionId)), false)
})
