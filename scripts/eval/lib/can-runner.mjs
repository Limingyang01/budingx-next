// SP010 T2：取消恢复（CAN）整题执行器。
// 走真实产品路径：真实 runtime、真实会话存储、真实恢复入口 runtime.sessions.resume，
// 模型调用经本机 SSE fixture 或真实 Provider；评分只用可观察事实。
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigStore } from '../../../src/tui/dist/storage/config-store.js'
import { createAgentRuntime } from '../../../src/tui/dist/tui/runtime.js'
import { copyTree, exists, repoRoot, removeTree } from './util.mjs'
import { scoreCanTask, summarizeCanEvidence } from './can-score.mjs'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await sleep(10)
  }
  return undefined
}

/**
 * 本机 SSE fixture：按请求顺序返回预设响应。
 * handler 返回字符串表示直接写回；返回 undefined 表示保持连接不响应（用于制造可取消的中途回合）。
 */
export async function startFixtureProvider(handlers) {
  const requests = []
  let index = 0
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    let body
    try {
      body = JSON.parse(Buffer.concat(chunks).toString())
    } catch {
      body = undefined
    }
    requests.push(body)
    const handler = handlers[Math.min(index, handlers.length - 1)]
    index += 1
    const payload = typeof handler === 'function' ? await handler(body) : handler
    if (payload === undefined) {
      // 保持连接打开：这一回合不会自行结束，等待取消。
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(payload)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    baseUrl: 'http://127.0.0.1:' + port + '/v1',
    requests,
    async close() {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}

/** 构造一段工具调用 SSE。 */
export function toolCallSse(callId, name, args) {
  return (
    'data: ' +
    JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: callId, function: { name, arguments: JSON.stringify(args) } }
            ]
          }
        }
      ]
    }) +
    '\n\n' +
    'data: ' +
    JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) +
    '\n\n' +
    'data: [DONE]\n\n'
  )
}

/** 构造一段纯文本 SSE。 */
export function textSse(text) {
  return (
    'data: ' +
    JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }) +
    '\n\n' +
    'data: [DONE]\n\n'
  )
}

/**
 * 执行一个 CAN 题次：取消 → 恢复 → 续跑，按整题给出一次结论。
 *
 * options.fixture：可选的 SSE fixture（脚本化模型）；不传时使用 options.config 的真实 Provider。
 * options.sideEffectTool：目标副作用所用的工具名，默认 Write。
 * options.skipResume：负例，跳过恢复入口直接续聊。
 * options.resumeOverride：负例，用给定回执替换真实恢复入口的回执。
 */
export async function runCanTask(task, options = {}) {
  const root = options.root ?? repoRoot()
  const budget = { maxRequests: 8, timeoutMs: 60_000, ...(options.budget ?? {}) }
  const workspaceDir = mkdtempSync(join(tmpdir(), 'budingx-can-'))
  const home = mkdtempSync(join(tmpdir(), 'budingx-can-home-'))
  const fixtureDir = join(root, 'scripts', 'eval', 'fixtures', task.fixture ?? task.id)
  if (exists(fixtureDir)) copyTree(fixtureDir, workspaceDir)
  const marker = options.marker ?? 'CP-CAN-MARKER-' + Math.random().toString(16).slice(2, 8)
  const sideEffectTool = options.sideEffectTool ?? 'Write'
  const sideEffectPath = options.sideEffectPath ?? 'side-effect.txt'
  const events = []
  let runtime
  let fixture
  const missingEvidence = []
  let firstTurn
  let secondTurn
  let resumeReceipt
  let expectedMessageId
  let budgetExceeded
  let resumeSkipped = false

  const onEvent = (event) => {
    events.push(event)
    if (event.type === 'turn_finalized') {
      if (!firstTurn) firstTurn = { id: event.turnId ?? event.id, outcome: event.outcome }
      else if (!secondTurn) secondTurn = { id: event.turnId ?? event.id, outcome: event.outcome }
    }
  }

  try {
    const configStore = new ConfigStore(join(home, 'config.json'))
    if (!options.config) {
      fixture = await startFixtureProvider(options.handlers ?? [])
    }
    const config = options.config ?? {
      baseUrl: fixture.baseUrl,
      model: options.model ?? 'can-fixture',
      apiKey: '',
      timeoutMs: options.providerTimeoutMs ?? 2_000,
      source: 'env'
    }
    runtime = createAgentRuntime({
      cwd: workspaceDir,
      home,
      sessionId: options.sessionId ?? 'cp-can-session',
      persistence: true,
      mode: 'workspace_edit',
      configStore,
      getConfig: () => config,
      approval: { request: async () => ({ outcome: 'allow', via: 'user' }) }
    })
    runtime.session.on(onEvent)

    // 第一回合：模型执行一次目标副作用，然后等待取消。
    runtime.session.submit(options.firstInstruction ?? '请创建文件 ' + sideEffectPath + ' 并写入一次。' + marker)
    const sideEffectSeen = await waitFor(
      () => events.some((event) => event.type === 'tool_call_completed' && event.name === sideEffectTool),
      budget.timeoutMs
    )
    if (!sideEffectSeen) missingEvidence.push('未观察到目标副作用')

    // 取消前登记首回合的一条已持久化消息（消息 ID + 本题次独有的内容标记）。
    const history = runtime.session.history ?? []
    const firstMessage = history.find((message) => {
      const blocks = Array.isArray(message.blocks) ? message.blocks : []
      return blocks.some((block) => typeof block.text === 'string' && block.text.includes(marker))
    })
    if (!firstMessage) missingEvidence.push('首回合消息未持久化')
    else expectedMessageId = firstMessage.id

    runtime.session.interrupt('user')
    const cancelled = await waitFor(() => firstTurn, Math.min(budget.timeoutMs, 15_000))
    if (!cancelled) missingEvidence.push('未取得取消回合的终态')

    // 产品恢复入口：必须取得成功回执且历史里能匹配首回合消息。
    if (options.skipResume) {
      // 负例：跳过恢复入口直接在原会话续聊，不得算作通过。
      resumeSkipped = true
    } else if (options.resumeOverride) {
      resumeReceipt = options.resumeOverride
    } else if (!runtime.sessions?.resume) {
      missingEvidence.push('运行时未暴露恢复入口')
    } else {
      resumeReceipt = runtime.sessions.resume(runtime.session.id)
      if (!resumeReceipt) missingEvidence.push('恢复入口未返回回执')
    }

    // 第二回合：继续完成剩余任务。
    runtime.session.submit(options.secondInstruction ?? '继续完成剩余任务。' + marker)
    const completed = await waitFor(() => secondTurn, budget.timeoutMs)
    if (!completed) missingEvidence.push('恢复回合未取得终态')

    const sideEffectCount = events.filter(
      (event) => event.type === 'tool_call_completed' && event.name === sideEffectTool
    ).length
    const assertionsPassed = secondTurn?.outcome === 'completed' && sideEffectCount === 1

    const evidence = {
      firstTurn,
      secondTurn,
      sideEffectCount,
      resumeReceipt,
      expectedSessionId: runtime.session.id,
      expectedMessageId,
      expectedMarker: marker,
      assertionsPassed,
      budgetExceeded,
      resumeSkipped,
      missingEvidence
    }
    const scored = scoreCanTask(evidence)
    return {
      id: task.id,
      version: task.version,
      group: task.group,
      category: task.category,
      blind: task.blind === true,
      status: scored.status === 'passed' ? 'passed' : scored.status === 'unverified' ? 'unverified' : 'failed',
      outcome: secondTurn?.outcome ?? firstTurn?.outcome ?? 'unknown',
      requestCount: fixture?.requests?.length ?? 0,
      durationMs: undefined,
      failureClass: scored.failureClass,
      can: { ...summarizeCanEvidence(evidence), reasons: scored.reasons }
    }
  } finally {
    try {
      runtime?.session.dispose()
    } catch {
      // 释放失败不影响判定。
    }
    await fixture?.close()
    removeTree(workspaceDir)
    removeTree(home)
  }
}
