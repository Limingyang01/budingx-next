// SP006 §9 hooks：配置、处理器语义与 Session 接线（HK-01 … HK-08）。
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Session } from '../dist/core/session.js'
import { createHookRunner, loadHooksConfig, startHooks } from '../dist/tui/hooks/index.js'
import { agentFixture, SNAPSHOT } from './helpers/agent-fixture.mjs'

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix))
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

const ECHO_STDIN = [
  'let data = ""',
  'process.stdin.setEncoding("utf8")',
  'process.stdin.on("data", (chunk) => { data += chunk })',
  'process.stdin.on("end", () => {',
  '  process.stdout.write(JSON.stringify({ hookSpecificOutput: { additionalContext: "CTX-42" } }))',
  '})'
].join('\n')

const LOG_EVENT = [
  'import { appendFileSync } from "node:fs"',
  'let data = ""',
  'process.stdin.setEncoding("utf8")',
  'process.stdin.on("data", (chunk) => { data += chunk })',
  'process.stdin.on("end", () => {',
  '  const payload = JSON.parse(data || "{}")',
  '  appendFileSync(process.env.HOOK_LOG, payload.hook_event_name + "\\n")',
  '  process.stdout.write("")',
  '})'
].join('\n')

function toolTurn(name, args) {
  return [
    {
      type: 'tool_call_delta',
      index: 0,
      callId: 'call_probe',
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

async function runSessionTurn(t, {
  hooks,
  script,
  mode = 'workspace_edit',
  requiresApproval = false,
  approvalOutcome = 'allow'
}) {
  const f = agentFixture({ mode })
  const received = []
  const events = []
  const approvals = []
  const { provider, calls } = scriptProvider(script ?? [toolTurn('probe', { message: 'hi' })])
  const session = new Session({
    provider,
    approval: {
      async request(request) {
        approvals.push(request)
        return { outcome: approvalOutcome, via: 'policy' }
      }
    },
    resolveSnapshot: () => SNAPSHOT,
    tools: [probeTool(received, requiresApproval)],
    permissionPolicy: f.policy,
    ...(hooks ? { hooks } : {}),
    onEvent: (event) => events.push(event)
  })
  t.after(() => session.dispose())
  session.submit('go')
  const deadline = Date.now() + 8000
  while (session.isBusy && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(session.isBusy, false, '回合应当结束')
  return { received, events, approvals, calls, session }
}

function commandRunner(home, hooks, options = {}) {
  if (hooks && Object.keys(hooks).length > 0) writeHooks(home, hooks)
  const loaded = loadHooksConfig(home)
  assert.equal(loaded.corrupt, undefined)
  const runner = createHookRunner(loaded.config, { homeDir: home, ...options })
  return runner
}

test('HK-01/HK-02/HK-07 配置加载：八类事件、command/prompt、显式禁用', async () => {
  const home = tempDir('budingx-hooks-cfg-')
  const dir = tempDir('budingx-hooks-script-')
  const script = writeScript(dir, 'echo', ECHO_STDIN)
  writeHooks(home, {
    SessionStart: [{ hooks: [commandHook(script)] }],
    UserPromptSubmit: [{ hooks: [{ type: 'prompt', prompt: 'PROMPT-CONTEXT' }] }],
    PreToolUse: [{ matcher: 'probe', hooks: [commandHook(script)] }],
    PostToolUse: false,
    Stop: [{ hooks: [] }]
  })
  const runner = commandRunner(home, {})
  assert.equal(runner.has('SessionStart'), true)
  assert.equal(runner.has('PostToolUse'), false, 'false 表示显式禁用')
  assert.equal(runner.has('Stop'), false, '空处理器列表视为未配置')
  assert.equal(runner.has('Notification'), false)

  const promptResult = await runner.run('UserPromptSubmit', { prompt: 'hi' })
  assert.deepEqual(promptResult.additionalContext, ['PROMPT-CONTEXT'])

  const commandResult = await runner.run('SessionStart', { source: 'startup' })
  assert.deepEqual(commandResult.additionalContext, ['CTX-42'])
  assert.equal(runner.executions().filter((entry) => entry.handler === 'command').length, 1)
  assert.equal(runner.executions().filter((entry) => entry.handler === 'prompt').length, 1)

  const unmatched = await runner.run('PreToolUse', { tool_name: 'other', tool_input: {} })
  assert.equal(unmatched.additionalContext, undefined, 'matcher 不匹配时不执行')
})

test('HK-03 continue/block/suppressOutput/systemMessage 语义', async () => {
  const home = tempDir('budingx-hooks-sem-')
  const dir = tempDir('budingx-hooks-sem-script-')
  const block = writeScript(dir, 'block', 'process.stdout.write(JSON.stringify({ continue: false, stopReason: "别继续" }))')
  const suppress = writeScript(dir, 'suppress', 'process.stdout.write(JSON.stringify({ suppressOutput: true, systemMessage: "SYS" }))')
  const allow = writeScript(dir, 'allow', 'process.stdout.write(JSON.stringify({ systemMessage: "SYS-OK" }))')
  const runner = commandRunner(home, {
    SessionStart: [{ hooks: [commandHook(allow)] }],
    UserPromptSubmit: [{ hooks: [commandHook(block)] }],
    Notification: [{ hooks: [commandHook(suppress)] }]
  })
  const blocked = await runner.run('UserPromptSubmit', { prompt: 'x' })
  assert.equal(blocked.blocked, true)
  assert.equal(blocked.reason, '别继续')

  const suppressed = await runner.run('Notification', { message: 'm' })
  assert.equal(suppressed.suppressOutput, true)
  assert.equal(suppressed.systemMessages, undefined, 'suppressOutput 时不回显系统消息')

  const allowed = await runner.run('SessionStart', {})
  assert.equal(allowed.blocked, false)
  assert.deepEqual(allowed.systemMessages, ['SYS-OK'])
})

test('HK-05/HK-06 退出码 2 阻断、非零与超时降级、崩溃不抛出', async () => {
  const home = tempDir('budingx-hooks-fail-')
  const dir = tempDir('budingx-hooks-fail-script-')
  const exit2 = writeScript(dir, 'exit2', 'process.stderr.write("STDERR-REASON"); process.exit(2)')
  const exit3 = writeScript(dir, 'exit3', 'process.exit(3)')
  const slow = writeScript(dir, 'slow', 'setTimeout(() => process.stdout.write("late"), 5000)')
  const runner = commandRunner(home, {
    PreToolUse: [{ hooks: [commandHook(exit2)] }],
    PostToolUse: [{ hooks: [commandHook(exit3)] }],
    Stop: [{ hooks: [{ type: 'command', command: '"' + process.execPath + '" "' + slow + '"', timeout: 0.2 }] }]
  })
  const blocked = await runner.run('PreToolUse', { tool_name: 'probe', tool_input: {} })
  assert.equal(blocked.blocked, true)
  assert.equal(blocked.reason, 'STDERR-REASON')

  const failed = await runner.run('PostToolUse', { tool_name: 'probe' })
  assert.equal(failed.blocked, false)
  assert.match(failed.warnings[0], /退出码 3/)

  const timedOut = await runner.run('Stop', {})
  assert.equal(timedOut.blocked, false)
  assert.match(timedOut.warnings[0], /超时/)
})

test('HK-08 损坏配置隔离并备份', async () => {
  const home = tempDir('budingx-hooks-corrupt-')
  const path = join(home, '.budingx', 'hooks.json')
  mkdirSync(join(home, '.budingx'), { recursive: true })
  writeFileSync(path, '{ not json', 'utf8')
  const loaded = loadHooksConfig(home)
  assert.equal(loaded.corrupt, true)
  assert.equal(loaded.config.SessionStart, undefined)
  assert.match(loaded.warnings[0], /不是有效 JSON/)
  assert.match(loaded.warnings[0], /备份/)
  assert.equal(readFileSync(loaded.backupPath, 'utf8'), '{ not json')

  const disabled = loadHooksConfig(home)
  assert.equal(disabled.corrupt, true, '原文件仍是坏的，下一次加载继续明确告警')
})

test('HK-02/HK-06 SessionStart、UserPromptSubmit 与 Stop 在真实回合中触发', async (t) => {
  const home = tempDir('budingx-hooks-life-')
  const dir = tempDir('budingx-hooks-life-script-')
  const log = join(dir, 'events.log')
  const script = writeScript(dir, 'log', LOG_EVENT)
  writeHooks(home, {
    SessionStart: [{ hooks: [commandHook(script)] }],
    UserPromptSubmit: [{ hooks: [commandHook(script)] }],
    PreToolUse: [{ hooks: [commandHook(script)] }],
    PostToolUse: [{ hooks: [commandHook(script)] }],
    Stop: [{ hooks: [commandHook(script)] }]
  })
  const loaded = loadHooksConfig(home)
  const runner = createHookRunner(loaded.config, { homeDir: home, env: { HOOK_LOG: log } })
  const { received, events } = await runSessionTurn(t, { hooks: runner })
  assert.equal(received.length, 1)
  // Stop 是旁路执行，等它落盘。
  const deadline = Date.now() + 5000
  let lines = []
  while (Date.now() < deadline) {
    try {
      lines = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
    } catch {
      lines = []
    }
    if (lines.includes('Stop')) break
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  assert.deepEqual(lines, ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'])
  assert.equal(events.filter((event) => event.type === 'turn_finalized')[0].outcome, 'completed')
})

test('HK-03/HK-04 UserPromptSubmit 阻断后不请求模型；PreToolUse deny 记录拒绝', async (t) => {
  const home = tempDir('budingx-hooks-deny-')
  const dir = tempDir('budingx-hooks-deny-script-')
  const block = writeScript(dir, 'block', 'process.stderr.write("NOPE"); process.exit(2)')
  writeHooks(home, { UserPromptSubmit: [{ hooks: [commandHook(block)] }] })
  const loaded = loadHooksConfig(home)
  const runner = createHookRunner(loaded.config, { homeDir: home })
  const { events, calls } = await runSessionTurn(t, { hooks: runner })
  assert.equal(calls.length, 0, '被阻断的提示词不得发给模型')
  const final = events.find((event) => event.type === 'turn_finalized')
  assert.equal(final.outcome, 'error')
  assert.equal(final.error.code, 'BUDINGX_HOOK_BLOCKED')

  const denyHome = tempDir('budingx-hooks-deny2-')
  const denyScript = writeScript(
    dir,
    'deny',
    'process.stdout.write(JSON.stringify({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "no probe" } }))'
  )
  writeHooks(denyHome, { PreToolUse: [{ matcher: 'probe', hooks: [commandHook(denyScript)] }] })
  const denyRunner = createHookRunner(loadHooksConfig(denyHome).config, { homeDir: denyHome })
  const denied = await runSessionTurn(t, { hooks: denyRunner })
  assert.equal(denied.received.length, 0)
  assert.equal(denied.events.filter((event) => event.type === 'denial_recorded').length, 1)
  const result = denied.events.find((event) => event.type === 'tool_result')
  assert.match(result.content, /Denied by hook: no probe/)
})

test('HK-04 allow 跳过审批、ask 转人工、updatedInput 覆盖入参', async (t) => {
  const dir = tempDir('budingx-hooks-allow-script-')
  const allowHome = tempDir('budingx-hooks-allow-')
  const allowScript = writeScript(
    dir,
    'allow',
    'process.stdout.write(JSON.stringify({ hookSpecificOutput: { permissionDecision: "allow" } }))'
  )
  writeHooks(allowHome, { PreToolUse: [{ matcher: 'probe', hooks: [commandHook(allowScript)] }] })
  const allowed = await runSessionTurn(t, {
    hooks: createHookRunner(loadHooksConfig(allowHome).config, { homeDir: allowHome }),
    requiresApproval: true
  })
  assert.equal(allowed.received.length, 1)
  assert.equal(allowed.approvals.length, 0, 'hook allow 应跳过审批')

  const askHome = tempDir('budingx-hooks-ask-')
  const askScript = writeScript(
    dir,
    'ask',
    'process.stdout.write(JSON.stringify({ hookSpecificOutput: { permissionDecision: "ask" } }))'
  )
  writeHooks(askHome, { PreToolUse: [{ matcher: 'probe', hooks: [commandHook(askScript)] }] })
  const asked = await runSessionTurn(t, {
    hooks: createHookRunner(loadHooksConfig(askHome).config, { homeDir: askHome }),
    approvalOutcome: 'deny'
  })
  assert.equal(asked.approvals.length, 1, 'hook ask 应转人工审批')

  const updateHome = tempDir('budingx-hooks-update-')
  const updateScript = writeScript(
    dir,
    'update',
    'process.stdout.write(JSON.stringify({ hookSpecificOutput: { updatedInput: { message: "patched" } } }))'
  )
  writeHooks(updateHome, { PreToolUse: [{ matcher: 'probe', hooks: [commandHook(updateScript)] }] })
  const updated = await runSessionTurn(t, {
    hooks: createHookRunner(loadHooksConfig(updateHome).config, { homeDir: updateHome })
  })
  assert.equal(updated.received.length, 1)
  assert.equal(updated.received[0].message, 'patched')

  const patchHome = tempDir('budingx-hooks-ctx-')
  const ctxScript = writeScript(dir, 'ctx', ECHO_STDIN)
  writeHooks(patchHome, { UserPromptSubmit: [{ hooks: [commandHook(ctxScript)] }] })
  const contextual = await runSessionTurn(t, {
    hooks: createHookRunner(loadHooksConfig(patchHome).config, { homeDir: patchHome }),
    script: [FINAL]
  })
  assert.match(contextual.calls[0].messages[0].content, /CTX-42/)
})

test('startHooks 汇总配置告警且 runner 可用', async () => {
  const home = tempDir('budingx-hooks-start-')
  writeHooks(home, { Stop: [{ hooks: [{ type: 'http', url: 'http://example.test' }] }] })
  const started = startHooks({ homeDir: home })
  assert.equal(started.loaded.warnings.length, 1)
  assert.match(started.loaded.warnings[0], /不支持的 hook 处理器类型/)
  assert.equal(started.runner.has('Stop'), false)
})
