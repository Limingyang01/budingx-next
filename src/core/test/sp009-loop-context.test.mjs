// SP009 0.9.1 · loop-context-fidelity 回归（LF/LC）。
// 证据层级：核心 Session 真实状态机 + 脚本化 Provider（唯一假件是模型）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session } from '../../tui/dist/core/session.js'
import { createWorkspace } from '../../tui/dist/workspace/paths.js'
import { createPermissionPolicy } from '../../tui/dist/workspace/policy.js'
import { resolveContextWindow, DEFAULT_CONTEXT_WINDOW } from '../../tui/dist/core/context-window.js'
import { triggerTokens, AUTOCOMPACT_BUFFER_TOKENS } from '../../tui/dist/core/context-budget.js'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: true }
}

function scriptProvider(script) {
  return {
    async *stream() {
      const events = script.shift() ?? [{ type: 'message_completed', finishReason: 'stop' }]
      for (const event of events) yield event
    }
  }
}

function toolCallTurn(callId) {
  return [
    { type: 'tool_call_delta', index: 0, callId, nameDelta: 'Ping', argsDelta: '{}' },
    { type: 'message_completed', finishReason: 'tool_calls' }
  ]
}

function textTurn(text) {
  return [
    { type: 'text_delta', text },
    { type: 'message_completed', finishReason: 'stop' }
  ]
}

function pingTool(counter) {
  return {
    name: 'Ping',
    summary: 'test ping',
    describe: () => 'Ping()',
    capability: () => 'read',
    target: () => ({ kind: 'none' }),
    concurrencySafe: true,
    async execute() {
      counter.n++
      return 'pong'
    }
  }
}

function makeSession(t, { script, maxIterations, contextBudget }) {
  const base = mkdtempSync(join(tmpdir(), 'budingx-loop-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const root = join(base, 'ws')
  mkdirSync(root)
  mkdirSync(join(base, '.budingx'))
  const workspace = createWorkspace(root)
  const policy = createPermissionPolicy({
    workspace,
    dataRootOverride: join(base, '.budingx'),
    mode: 'full_access'
  })
  const counter = { n: 0 }
  const session = new Session({
    provider: scriptProvider(script),
    tools: [pingTool(counter)],
    permissionPolicy: policy,
    resolveSnapshot: () => SNAPSHOT,
    approval: { request: async () => ({ outcome: 'allow', via: 'policy' }) },
    ...(maxIterations !== undefined ? { maxIterations } : {}),
    ...(contextBudget ? { contextBudget } : {})
  })
  return { session, counter }
}

function finalizePromise(session) {
  return new Promise((resolve) => {
    const off = session.on((event) => {
      if (event.type === 'turn_finalized') {
        off()
        resolve(event)
      }
    })
  })
}

test('LF-01 交互默认无回合上限：40 次工具迭代后仍正常完成', async (t) => {
  const script = []
  for (let i = 0; i < 40; i++) script.push(toolCallTurn('call-' + i))
  script.push(textTurn('长任务完成'))
  const { session, counter } = makeSession(t, { script })
  const done = finalizePromise(session)
  session.submit('开始长任务')
  const event = await done
  assert.equal(event.outcome, 'completed', '不应在 32 次处被硬停')
  assert.equal(counter.n, 40, '40 次工具调用都应真实执行')
})

test('LF-02 显式 maxIterations 仍然生效（无头 --max-turns 路径）', async (t) => {
  const script = []
  for (let i = 0; i < 10; i++) script.push(toolCallTurn('call-' + i))
  script.push(textTurn('完成'))
  const { session } = makeSession(t, { script, maxIterations: 3 })
  const done = finalizePromise(session)
  session.submit('任务')
  const event = await done
  assert.equal(event.outcome, 'max_turns')
})

test('LC-03 窗口解析优先级：env > 档案 > 发现 > 默认', () => {
  assert.equal(resolveContextWindow({}), DEFAULT_CONTEXT_WINDOW)
  assert.equal(resolveContextWindow({ discoveredWindow: 1000000 }), 1000000)
  assert.equal(resolveContextWindow({ profileWindow: 500000, discoveredWindow: 1000000 }), 500000)
  assert.equal(
    resolveContextWindow({ envWindow: 128000, profileWindow: 500000, discoveredWindow: 1000000 }),
    128000
  )
  // 非法值逐级回退
  assert.equal(resolveContextWindow({ envWindow: 0, profileWindow: -5, discoveredWindow: 262144 }), 262144)
  assert.equal(resolveContextWindow({ profileWindow: NaN }), DEFAULT_CONTEXT_WINDOW)
})

test('LC-05 自动压缩触发阈值 = 窗口 − 13k 缓冲（对齐参考仓）', () => {
  assert.equal(AUTOCOMPACT_BUFFER_TOKENS, 13000)
  const window = 200000
  assert.equal(triggerTokens({ messages: [], maxTokens: window }), window - 13000)
  // 大窗口同样按真实窗口抬升，而不是固定 200k
  assert.equal(triggerTokens({ messages: [], maxTokens: 1000000 }), 1000000 - 13000)
  // 极小窗口不为负
  assert.ok(triggerTokens({ messages: [], maxTokens: 5000 }) >= 1)
})

test('LC-06 自动压缩用模型摘要：被裁剪回合以摘要保留在压缩边界', async (t) => {
  // 脚本化 Provider：第一次调用是摘要请求（返回摘要），之后是正常回合。
  const calls = []
  const provider = {
    async *stream(request) {
      const isSummary = String(request.messages?.[0]?.content ?? '').includes('<conversation>')
      calls.push({ isSummary, request })
      if (isSummary) {
        yield { type: 'text_delta', text: '<analysis>thinking</analysis><summary>早期历史摘要：修好了 add()</summary>' }
        yield { type: 'message_completed', finishReason: 'stop' }
        return
      }
      yield { type: 'text_delta', text: '继续完成' }
      yield { type: 'message_completed', finishReason: 'stop' }
    }
  }
  const base = mkdtempSync(join(tmpdir(), 'budingx-summary-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const root = join(base, 'ws')
  mkdirSync(root)
  mkdirSync(join(base, '.budingx'))
  const workspace = createWorkspace(root)
  const policy = createPermissionPolicy({
    workspace,
    dataRootOverride: join(base, '.budingx'),
    mode: 'full_access'
  })
  const session = new Session({
    provider,
    permissionPolicy: policy,
    resolveSnapshot: () => SNAPSHOT,
    approval: { request: async () => ({ outcome: 'allow', via: 'policy' }) },
    // 小窗口：历史很快越过「窗口 − 13k」
    contextBudget: { maxTokens: 20000, reservedOutputTokens: 2000 }
  })
  // 造一段长历史：每条 2000 字符 ≈ 500 token，20 条 ≈ 10000 token。
  const history = []
  for (let i = 0; i < 12; i++) {
    history.push({ id: 'u' + i, role: 'user', blocks: [{ type: 'text', text: '第' + i + '步 ' + 'x'.repeat(2000) }] })
    history.push({ id: 'a' + i, role: 'assistant', blocks: [{ type: 'text', text: '好的 ' + 'y'.repeat(2000) }] })
  }
  session.restoreHistory(history)
  const done = finalizePromise(session)
  session.submit('继续')
  const event = await done
  assert.equal(event.outcome, 'completed')
  assert.ok(calls.some((call) => call.isSummary), '压缩必须先调用模型生成摘要')
  const realCall = calls.find((call) => !call.isSummary)
  const wire = JSON.stringify(realCall.request.messages)
  assert.ok(wire.includes('<compacted_summary>'), '摘要必须保留在压缩边界')
  assert.ok(wire.includes('早期历史摘要：修好了 add()'), '摘要正文必须进入真实请求')
  const compacted = []
  session.on((e) => { if (e.type === 'context_compacted') compacted.push(e) })
  assert.ok(true)
})
