// SP005 §8 端到端观测用例：真实 Provider 传输栈 + 真实工具 + 真实追踪器 + 本机接收端。
//
// 用本地 OpenAI 兼容端点（不是真实模型）跑可复现场景，验证：
//   OB-02 根观测唯一、父链正确、session 一致；
//   OB-03 工具观测名来自真实工具表、失败为 ERROR；
//   FR-05 工具空转被熔断（换参数瞎试同一个不存在的文件）。
//
// 为什么不用真实模型：真实模型不可复现且受额度限制；
// 这里连的是真实 HTTP 传输 + 真实解析 + 真实追踪，只把模型换成脚本。

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session } from '../../src/tui/dist/core/session.js'
import { ERROR_CODES } from '../../src/tui/dist/core/constants.js'
import { createOpenAiProvider } from '../../src/tui/dist/provider/openai.js'
import { createWorkspaceTools } from '../../src/tui/dist/workspace/tools.js'
import { createWorkspace } from '../../src/tui/dist/workspace/paths.js'
import { setupTracing } from '../../src/tui/dist/tui/runtime.js'
import { createReceiver } from './local-receiver.mjs'
import { judgeHierarchy, judgeToolNames, judgeLevels } from './sp005-observation.mjs'

const KEYS = { publicKey: 'pk-test-sp005', secretKey: 'sk-test-sp005' }
const AUTH = 'Basic ' + Buffer.from(KEYS.publicKey + ':' + KEYS.secretKey).toString('base64')

/** 脚本化 OpenAI 兼容端点：按场景产出 SSE。 */
function createScriptedProvider(scenario) {
  const requests = []
  let attempt = 0
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    if (!req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end('not found')
      return
    }
    requests.push(JSON.parse(body))
    attempt += 1
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = (payload) => res.write('data: ' + JSON.stringify(payload) + '\n\n')

    const alreadyHasToolResult = JSON.parse(body).messages.some((m) => m.role === 'tool')
    if (scenario === 'tool-success') {
      if (!alreadyHasToolResult) {
        send({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_read_1',
                    type: 'function',
                    function: { name: 'Read', arguments: '{"path":"facts.txt"}' }
                  }
                ]
              }
            }
          ]
        })
        send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
      } else {
        send({ choices: [{ delta: { content: '文件有三行内容。' } }] })
        send({ choices: [{ delta: {}, finish_reason: 'stop' }] })
      }
    } else {
      // 每轮换一个路径去试同一个不存在的文件：错误码相同，签名不同。
      const paths = ['missing.txt', './missing.txt', 'src/missing.txt', 'docs/missing.txt']
      const target = paths[Math.min(attempt - 1, paths.length - 1)]
      if (attempt <= 12) {
        send({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_read_' + attempt,
                    type: 'function',
                    function: { name: 'Read', arguments: JSON.stringify({ path: target }) }
                  }
                ]
              }
            }
          ]
        })
        send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
      } else {
        send({ choices: [{ delta: { content: '放弃。' } }] })
        send({ choices: [{ delta: {}, finish_reason: 'stop' }] })
      }
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
  return { server, requests }
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}

async function runScenario(scenario, providerPort, receiverBaseUrl, workspace) {
  const sessionId = 'sp005-e2e-' + scenario + '-' + Date.now()
  const receipts = []
  const tracing = setupTracing({
    sessionId,
    env: {
      BUDINGX_LANGFUSE_ENABLED: '1',
      BUDINGX_LANGFUSE_CAPTURE_CONTENT: '0',
      LANGFUSE_BASE_URL: receiverBaseUrl,
      LANGFUSE_PUBLIC_KEY: KEYS.publicKey,
      LANGFUSE_SECRET_KEY: KEYS.secretKey
    },
    modelApiKey: 'sk-should-not-leak',
    onReceipt: (receipt) => receipts.push(receipt)
  })
  const provider = createOpenAiProvider({
    baseUrl: 'http://127.0.0.1:' + providerPort + '/v1',
    apiKey: 'test-key'
  })
  const { tools } = createWorkspaceTools(workspace)
  const readTools = tools.filter((tool) => tool.name === 'Read')
  const events = []
  const session = new Session({
    id: sessionId,
    provider,
    approval: { async request() { return { outcome: 'allow', via: 'policy' } } },
    resolveSnapshot: () => ({
      modelId: 'e2e',
      model: 'scripted',
      baseUrlHost: '127.0.0.1',
      capabilities: { tools: true }
    }),
    tools: readTools,
    ...(tracing.tracer ? { tracer: tracing.tracer } : {})
  })
  session.on((event) => events.push(event))
  const finalized = new Promise((resolve) => {
    session.on((event) => { if (event.type === 'turn_finalized') resolve(event) })
  })
  const timer = setTimeout(() => session.interrupt(), 30000)
  session.submit(
    scenario === 'tool-error'
      ? 'Use the Read tool to read missing.txt, then report the result.'
      : 'Use the Read tool to read facts.txt, then report the result.'
  )
  const finalEvent = await finalized
  clearTimeout(timer)
  await tracing.shutdown?.()
  const receipt = receipts.find((r) => r.turnId === finalEvent.turnId) ?? receipts[0]
  return { sessionId, finalEvent, events, receipt, realToolNames: readTools.map((t) => t.name) }
}

async function queryTrace(baseUrl, traceId, deadlineMs = 15000) {
  const deadline = Date.now() + deadlineMs
  const url = new URL('/api/public/v2/observations', baseUrl)
  url.searchParams.set('traceId', traceId)
  url.searchParams.set('fields', 'core,basic,io')
  url.searchParams.set('limit', '100')
  while (Date.now() < deadline) {
    const response = await fetch(url.toString(), {
      headers: { authorization: AUTH },
      signal: AbortSignal.timeout(5000)
    })
    if (response.ok) {
      const body = await response.json()
      const rows = body.data ?? []
      if (rows.some((o) => o.name === 'agent.run')) return rows
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return []
}

let receiver
let receiverBaseUrl
let workspaceRoot
let successServer
let errorServer
let successPort
let errorPort

before(async () => {
  const built = createReceiver({ keys: KEYS })
  receiver = built.server
  const port = await listen(receiver)
  receiverBaseUrl = 'http://127.0.0.1:' + port
  workspaceRoot = mkdtempSync(join(tmpdir(), 'budingx-sp005-observe-'))
  writeFileSync(join(workspaceRoot, 'facts.txt'), 'alpha\nbeta\ngamma\n')
  const success = createScriptedProvider('tool-success')
  successServer = success.server
  successPort = await listen(successServer)
  const failing = createScriptedProvider('tool-error')
  errorServer = failing.server
  errorPort = await listen(errorServer)
})

after(() => {
  receiver?.close()
  successServer?.close()
  errorServer?.close()
})

test('OB-02/OB-03 成功工具调用的观测层级、工具名与级别正确', async () => {
  const workspace = createWorkspace(workspaceRoot)
  const result = await runScenario('tool-success', successPort, receiverBaseUrl, workspace)
  assert.equal(result.finalEvent.outcome, 'completed')
  assert.ok(result.receipt?.traceId, 'a trace receipt must be produced')
  const observations = await queryTrace(receiverBaseUrl, result.receipt.traceId)
  assert.ok(observations.length > 0, 'observations must reach the receiver')
  const hierarchy = judgeHierarchy(observations, result.sessionId)
  assert.equal(hierarchy.ok, true, JSON.stringify(hierarchy))
  const names = judgeToolNames(observations, result.realToolNames)
  assert.equal(names.ok, true, JSON.stringify(names))
  assert.deepEqual(names.observed, ['Read'])
  const levels = judgeLevels(observations, [{ name: 'tool.Read', level: 'DEFAULT' }])
  assert.equal(levels.ok, true, JSON.stringify(levels))
})

test('OB-03 工具失败在观测里是 ERROR 级', async () => {
  const workspace = createWorkspace(workspaceRoot)
  const result = await runScenario('tool-error', errorPort, receiverBaseUrl, workspace)
  const observations = await queryTrace(receiverBaseUrl, result.receipt.traceId)
  const read = observations.filter((o) => o.name === 'tool.Read')
  assert.ok(read.length > 0, 'the failing tool must appear in the trace')
  assert.ok(read.every((o) => o.level === 'ERROR'), 'every failing tool call must be ERROR level')
})

test('FR-05 换参数反复试同一工具会被熔断，不会空转到最大迭代次数', async () => {
  const workspace = createWorkspace(workspaceRoot)
  const result = await runScenario('tool-error', errorPort, receiverBaseUrl, workspace)
  assert.equal(result.finalEvent.outcome, 'error')
  assert.equal(result.finalEvent.error.code, ERROR_CODES.coreToolLoopDetected)
  const toolResults = result.events.filter((e) => e.type === 'tool_result')
  assert.ok(
    toolResults.length <= 8,
    'the breaker must stop the loop early, got ' + toolResults.length + ' tool calls'
  )
});
