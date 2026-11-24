// SP010 T7：主循环逐路径判据。
// 每一行只触发一个分支，记录触发事件、触发后的主请求增量与唯一回合终态。
// 参考端缺少对应出口的行按 GAP 记录，并附本仓源码依据，不得计作该行为通过。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { Session } from '../dist/core/session.js'
import { createCodingTaskTracker } from '../dist/core/coding.js'
import { scriptedProvider, textEvents, toolCallEvents } from '../../../scripts/eval/lib/scenarios.mjs'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'loop-path-model',
  baseUrlHost: 'loop.invalid',
  capabilities: { tools: true, vision: false }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate, timeoutMs = 10_000, stepMs = 10) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await sleep(stepMs)
  }
  return undefined
}

/** 跑一个或多个回合并收集终态与请求。 */
async function runTurn(options = {}) {
  const provider = options.provider
  const events = []
  const session = new Session({
    provider,
    approval: { request: async () => ({ outcome: 'allow', via: 'user' }) },
    resolveSnapshot: () => SNAPSHOT,
    tools: options.tools ?? [],
    ...(options.codingTask ? { codingTask: options.codingTask } : {}),
    ...(options.budget ? { contextBudget: options.budget } : {})
  })
  session.on((event) => events.push(event))
  const prompts = options.prompts ?? [options.prompt ?? '开始']
  let finalized
  for (const [index, prompt] of prompts.entries()) {
    const before = events.filter((event) => event.type === 'turn_finalized').length
    session.submit(prompt)
    finalized = await waitFor(
      () => {
        const done = events.filter((event) => event.type === 'turn_finalized')
        return done.length > before ? done[done.length - 1] : undefined
      },
      options.timeoutMs ?? 10_000
    )
    assert.ok(finalized, '第 ' + (index + 1) + ' 个回合必须有终态')
  }
  session.dispose()
  return { events, finalized, requests: provider.requests ?? [] }
}

/**
 * 主请求计数：摘要请求（压缩时的浓缩请求）不计入主循环请求数。
 * 摘要请求只有一条 user 消息且以浓缩指令开头，没有系统提示。
 */
function mainRequests(requests) {
  return requests.filter((request) =>
    (request.messages ?? []).some((message) => message.role === 'system')
  )
}

// ── 行 1：无工具正常结束（对照）────────────────────────────────────────

test('T7 行1 无工具正常结束：后续 0 次请求，唯一终态 completed', async () => {
  const provider = scriptedProvider([textEvents('已完成')])
  const { finalized, requests } = await runTurn({ provider })
  assert.equal(requests.length, 1)
  assert.equal(finalized.outcome, 'completed')
})

// ── 行 2：工具回填续跑 ────────────────────────────────────────────────

test('T7 行2 工具回填续跑：后续 1 次请求，同一调用 ID 的结果只出现一次，终态 completed', async () => {
  const provider = scriptedProvider([
    toolCallEvents('call-x', 'Read', JSON.stringify({ file_path: 'a.txt' })),
    textEvents('已完成')
  ])
  const { finalized, requests, events } = await runTurn({ provider })
  assert.equal(requests.length, 2)
  const payload = JSON.stringify(requests[1].messages)
  assert.equal((payload.match(/call-x/g) ?? []).length >= 1, true)
  const results = events.filter((event) => event.type === 'tool_result')
  assert.equal(results.length, 1)
  assert.equal(results[0].callId, 'call-x')
  assert.equal(finalized.outcome, 'completed')
})

// ── 行 3：上下文溢出恢复 ──────────────────────────────────────────────

/**
 * 溢出夹具 provider：按「第几个主请求」决定返回内容，不受摘要请求占用脚本位的影响。
 * overflowAt 列出返回 context_overflow 的主请求序号（从 1 开始）。
 */
function overflowProvider(filler, overflowAt) {
  const requests = []
  let mainCount = 0
  const provider = {
    requests,
    async *stream(request) {
      requests.push(request)
      const isMain = (request.messages ?? []).some((message) => message.role === 'system')
      if (!isMain) {
        // 摘要请求：不计入主请求数。
        yield* textEvents(filler)
        return
      }
      mainCount += 1
      if (overflowAt.includes(mainCount)) {
        yield {
          type: 'failed',
          error: { class: 'context_overflow', code: 'fixture-overflow', message: 'too long', retryable: false }
        }
        return
      }
      yield* textEvents('完成')
    }
  }
  return provider
}

// ── 行 3：上下文溢出恢复 ──────────────────────────────────────────────

test('T7 行3 上下文溢出恢复：压缩后重试 1 次并成功，再溢出则 error 且无第三次主请求', async () => {
  // 历史可压缩：单条消息小于预算上限，多轮合计超过上限。
  const filler = '历史内容'.repeat(150)
  const prompts = ['第一轮', '第二轮', '第三轮', '触发溢出的一轮']

  const provider = overflowProvider(filler, [4])
  const { finalized, requests } = await runTurn({
    provider,
    budget: { maxTokens: 4_000 },
    prompts
  })
  assert.equal(mainRequests(requests).length, 5, '溢出后只允许再试一次')
  assert.equal(finalized.outcome, 'completed')

  const twice = overflowProvider(filler, [4, 5])
  const second = await runTurn({
    provider: twice,
    budget: { maxTokens: 4_000 },
    prompts
  })
  assert.equal(mainRequests(second.requests).length, 5, '再次溢出不得有第三次主请求')
  assert.equal(second.finalized.outcome, 'error')
  assert.equal(second.finalized.error?.class, 'context_overflow')
})

// ── 行 4：输出达限 ────────────────────────────────────────────────────

test('T7 行4 输出达限：后续 0 次请求，终态 length_capped', async () => {
  const provider = scriptedProvider([
    [
      { type: 'text_delta', text: '被截断的输出' },
      { type: 'message_completed', finishReason: 'length', usage: { inputTokens: 10, outputTokens: 10 } }
    ]
  ])
  const { finalized, requests } = await runTurn({ provider })
  assert.equal(requests.length, 1)
  assert.equal(finalized.outcome, 'length_capped')
})

// ── 行 5：缺完成证据续跑（受控状态注入）──────────────────────────────

test('T7 行5 缺完成证据续跑：通知后 1 次主请求带缺证原因，唯一终态 completed', async () => {
  const tracker = createCodingTaskTracker()
  tracker.start('修复失败并让测试通过')
  // 受控注入：在下一次响应结束前补上成功证据（夹具在响应中途注入状态）。
  const provider = scriptedProvider([
    textEvents('我已经完成了'),
    (request, index) => {
      tracker.observeCommand('node --test proof.test.mjs', {
        outcome: 'completed',
        exitCode: 0,
        stdout: 'pass 1/1',
        stderr: ''
      })
      return textEvents('已完成')
    }
  ])
  const { finalized, requests, events } = await runTurn({ provider, codingTask: tracker })
  const notice = events.find((event) => event.type === 'notice' && event.code === 'coding_task')
  assert.ok(notice, '必须先发出缺证通知')
  assert.equal(requests.length, 2, '缺证后只允许 1 次主请求')
  assert.match(JSON.stringify(requests[1].messages), /真实执行证据/)
  assert.equal(finalized.outcome, 'completed')
})

// ── 行 6：缺完成证据续跑（真实命令取证）──────────────────────────────

test('T7 行6 缺完成证据续跑：命令取证后 2 次主请求，第二次携带同一调用 ID 的成功结果', async () => {
  const tracker = createCodingTaskTracker()
  tracker.start('跑测试并修复')
  const provider = scriptedProvider([
    textEvents('我已经完成了'),
    toolCallEvents('call-proof', 'Bash', JSON.stringify({ command: 'node --test proof.test.mjs' })),
    textEvents('测试已通过，完成')
  ])
  const toolResult = {
    name: 'Bash',
    capability: 'execute',
    summary: '运行命令',
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    async execute(input) {
      tracker.observeCommand(String(input.command ?? ''), {
        outcome: 'completed',
        exitCode: 0,
        stdout: 'pass 1/1',
        stderr: ''
      })
      return 'pass 1/1'
    }
  }
  const { finalized, requests, events } = await runTurn({
    provider,
    codingTask: tracker,
    tools: [toolResult]
  })
  const notice = events.find((event) => event.type === 'notice' && event.code === 'coding_task')
  assert.ok(notice, '必须先发出缺证通知')
  assert.equal(requests.length, 3, '缺证后应有 2 次主请求')
  const payload = JSON.stringify(requests[2].messages)
  assert.match(payload, /call-proof/)
  assert.match(payload, /pass 1\/1/)
  assert.equal(finalized.outcome, 'completed')
})

// ── 行 7–9：hook 分支（本仓为旁听语义，记 GAP）───────────────────────

test('T7 行7-9 Stop hook 为旁听语义：没有可继续/可阻止的回合出口，按 GAP 记录', async () => {
  const provider = scriptedProvider([textEvents('已完成')])
  const { finalized, requests, events } = await runTurn({ provider })
  assert.equal(requests.length, 1, 'Stop 旁听不得产生额外主请求')
  assert.equal(finalized.outcome, 'completed')
  assert.equal(
    events.some((event) => event.type === 'turn_finalized' && event.outcome !== 'completed'),
    false,
    '本仓不产生 stop_hook_prevented / hook_stopped 终态'
  )
  // 本仓的 Stop/StopFailure 只旁听回合结局，不改变已交付结果。
  const source = readFileSync(join(import.meta.dirname, '..', '..', 'core', 'session.ts'), 'utf8')
  assert.match(source, /Stop\/StopFailure 只旁听回合结局/)
})
