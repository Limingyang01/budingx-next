// SP004 agent-observability §4.8：无界面三场景验收。
// 走生产 Agent 路径（Core Session + 真实 Provider + 工作区只读工具 + 真实追踪器），
// 依次跑「成功 / 工具失败 / 模型失败」，并从 Langfuse v2 Observations API 回查。
//
// 判定逻辑导出为纯函数，供替身测试（verify-agent.test.mjs）覆盖 OB-25…OB-27。
// 只有本地预期、平台索引、层级、会话一致性均满足，且正文符合配置，才退出 0。
// 「有 trace」不单独作为通过依据。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { Session } from '../../src/tui/dist/core/session.js'
import { createOpenAiProvider } from '../../src/tui/dist/provider/openai.js'
import { createWorkspaceTools } from '../../src/tui/dist/workspace/tools.js'
import { createWorkspace } from '../../src/tui/dist/workspace/paths.js'
import { setupTracing } from '../../src/tui/dist/tui/runtime.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RUNTIME_DIR = path.join(ROOT, '.runtime', 'langfuse')
const WORKSPACE_DIR = path.join(RUNTIME_DIR, 'agent-workspace')
const REPORT_PATH = path.join(RUNTIME_DIR, 'verification.json')
const QUERY_DEADLINE_MS = 60000
const SYNTHETIC_SECRET = 'sk-lf-verify-synthetic-secret-000'

/** 场景定义。 */
export const SCENARIOS = ['success', 'tool-error', 'model-error']

/**
 * 判定层级与会话一致性（OB-27）。
 * @param observations v2 API 返回的观测数组
 * @param expectedSessionId 运行时提供的本地预期会话 ID
 */
export function judgeStructure(scenario, observations, expectedSessionId) {
  const roots = observations.filter((o) => o.name === 'agent.run')
  if (roots.length !== 1) return { hierarchyOk: false, sessionConsistent: false }
  const root = roots[0]
  if (root.parentObservationId) return { hierarchyOk: false, sessionConsistent: false }
  const children = observations.filter((o) => o.name !== 'agent.run')
  const hierarchyOk = children.every((o) => o.parentObservationId === root.id)
  const sessionConsistent = observations.every((o) => o.sessionId === expectedSessionId)
  if (!hierarchyOk || !sessionConsistent) return { hierarchyOk, sessionConsistent }

  const models = children.filter((o) => o.name === 'model.request')
  const tools = children.filter((o) => o.name.startsWith('tool.'))
  let scenarioOk = false
  if (scenario === 'success') {
    scenarioOk =
      models.some((o) => o.level !== 'ERROR') &&
      tools.some((o) => o.name === 'tool.Read' && o.level !== 'ERROR')
  } else if (scenario === 'tool-error') {
    scenarioOk = tools.some((o) => o.name === 'tool.Read' && o.level === 'ERROR')
  } else if (scenario === 'model-error') {
    scenarioOk =
      root.level === 'ERROR' &&
      models.some((o) => o.level === 'ERROR') &&
      tools.length === 0
  }
  return { hierarchyOk: hierarchyOk && scenarioOk, sessionConsistent }
}

/** 解析观测 I/O（v2 返回原始字符串）。 */
function parseIo(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/**
 * 判定正文（OB-25）。正文关闭时返回 null；开启时校验根 input/output 结构与脱敏。
 */
export function judgeContent(scenario, observations, captureContent) {
  if (!captureContent) return null
  const root = observations.find((o) => o.name === 'agent.run')
  if (!root) return false
  const input = parseIo(root.input)
  const output = parseIo(root.output)
  if (!Array.isArray(input) || !input.every((m) => m && m.role === 'user')) return false
  if (!Array.isArray(output)) return false
  if (scenario === 'model-error') {
    // 模型未产生助手消息时，合法 output 为空数组。
    if (output.length !== 0) return false
  } else if (!output.every((m) => m && m.role === 'assistant')) {
    return false
  }
  const wire = JSON.stringify(observations)
  if (wire.includes(SYNTHETIC_SECRET)) return false
  return true
}

/** 正文关闭时，断言本 trace 所有观测均无正文。 */
export function noContentAnywhere(observations) {
  return observations.every(
    (o) => o.input === null || o.input === undefined || o.input === ''
  ) && observations.every(
    (o) => o.output === null || o.output === undefined || o.output === ''
  )
}

/**
 * 汇总退出码（OB-26）。全部场景四项必通过判定满足，且正文符合配置，才为 0。
 */
export function aggregateExitCode(results, captureContent) {
  for (const r of results) {
    if (!r.localExpectationMet || !r.platformIndexed || !r.hierarchyOk || !r.sessionConsistent) {
      return 1
    }
    if (captureContent) {
      if (r.contentVerified !== true) return 1
    } else if (!r.noContent) {
      return 1
    }
  }
  return 0
}

/** 构造 Basic 认证头。 */
function authHeader(publicKey, secretKey) {
  return 'Basic ' + Buffer.from(`${publicKey}:${secretKey}`).toString('base64')
}

/**
 * 按 trace ID 轮询 v2 Observations API，处理分页，直到场景节点齐全或截止。
 */
export async function queryObservations(fetchImpl, baseUrl, auth, traceId, scenario, deadlineMs = QUERY_DEADLINE_MS) {
  const deadline = Date.now() + deadlineMs
  const url = new URL('/api/public/v2/observations', baseUrl)
  url.searchParams.set('traceId', traceId)
  url.searchParams.set('fields', 'core,basic,io')
  url.searchParams.set('limit', '100')
  while (Date.now() < deadline) {
    const collected = []
    let page = 1
    let totalPages = 1
    try {
      do {
        url.searchParams.set('page', String(page))
        const response = await fetchImpl(url.toString(), {
          headers: { authorization: auth },
          signal: AbortSignal.timeout(10000)
        })
        if (!response.ok) break
        const body = await response.json()
        collected.push(...(body.data ?? []))
        totalPages = body.meta?.totalPages ?? 1
        page++
      } while (page <= totalPages)
    } catch {
      // 查询失败保留事实，继续轮询直到截止。
    }
    const { hierarchyOk } = judgeStructure(scenario, collected, collected[0]?.sessionId ?? '')
    if (collected.length > 0 && hierarchyOk) return collected
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  return []
}

/** 校验 Langfuse 项目鉴权。失败则在发起任何模型调用前退出。 */
async function checkProjectAuth(fetchImpl, baseUrl, auth) {
  const response = await fetchImpl(new URL('/api/public/projects', baseUrl).toString(), {
    headers: { authorization: auth },
    signal: AbortSignal.timeout(10000)
  })
  return response.ok
}

/** 准备只读 fixture 工作区。 */
function prepareWorkspace() {
  mkdirSync(WORKSPACE_DIR, { recursive: true })
  writeFileSync(path.join(WORKSPACE_DIR, 'note.txt'), 'Local Langfuse verification succeeded.\n')
  return createWorkspace(WORKSPACE_DIR)
}

/** 运行单个场景，返回本地结果与回执。 */
async function runScenario(scenario, modelConfig, langfuseEnv, workspace) {
  const sessionId = `verify-${scenario}-${Date.now()}`
  const receipts = []
  const tracing = setupTracing({
    sessionId,
    env: langfuseEnv,
    modelApiKey: modelConfig.apiKey,
    onReceipt: (receipt) => receipts.push(receipt)
  })
  const baseUrl = scenario === 'model-error' ? 'http://127.0.0.1:1/v1' : modelConfig.baseUrl
  const provider = createOpenAiProvider({ baseUrl, apiKey: modelConfig.apiKey })
  const { tools } = createWorkspaceTools(workspace)
  const readTools = tools.filter((tool) => tool.name === 'Read')
  const events = []
  const session = new Session({
    id: sessionId,
    provider,
    approval: { async request() { return { outcome: 'allow', via: 'policy' } } },
    resolveSnapshot: () => ({
      modelId: 'verify',
      model: modelConfig.model,
      baseUrlHost: new URL(baseUrl).host,
      capabilities: { tools: true }
    }),
    tools: readTools,
    ...(tracing.tracer ? { tracer: tracing.tracer } : {})
  })
  session.on((event) => events.push(event))
  const prompt = scenario === 'tool-error'
    ? 'Use the Read tool to read missing-for-verification.txt, then report the result.'
    : 'Use the Read tool to read note.txt, then briefly report its content.'
  const finalized = new Promise((resolve) => {
    session.on((event) => { if (event.type === 'turn_finalized') resolve(event) })
  })
  const timer = setTimeout(() => session.interrupt(), 90000)
  session.submit(prompt)
  const finalEvent = await finalized
  clearTimeout(timer)
  await tracing.shutdown?.()

  const toolResults = events.filter((e) => e.type === 'tool_result')
  const errors = events.filter((e) => e.type === 'turn_finalized' && e.outcome === 'error')
  let localExpectationMet = false
  if (scenario === 'model-error') {
    localExpectationMet = finalEvent.outcome === 'error' && toolResults.length === 0
  } else if (scenario === 'tool-error') {
    localExpectationMet = toolResults.some((t) => t.isError) && finalEvent.outcome !== 'error'
  } else {
    localExpectationMet = toolResults.some((t) => !t.isError) && finalEvent.outcome === 'completed'
  }
  const receipt = receipts.find((r) => r.turnId === finalEvent.turnId) ?? receipts[0]
  return {
    scenario,
    sessionId,
    traceId: receipt?.traceId ?? null,
    localExpectationMet,
    outcome: finalEvent.outcome
  }
}

/** 主流程。 */
async function main() {
  const agentEnvPath = path.join(RUNTIME_DIR, 'agent.env')
  if (!existsSync(agentEnvPath)) {
    console.error('Missing .runtime/langfuse/agent.env; run scripts/langfuse/init-local.mjs first.')
    process.exitCode = 1
    return
  }
  const agentValues = parseEnv(readFileSync(agentEnvPath, 'utf8'))
  const langfuseEnv = {
    BUDINGX_LANGFUSE_ENABLED: '1',
    BUDINGX_LANGFUSE_CAPTURE_CONTENT: agentValues.BUDINGX_LANGFUSE_CAPTURE_CONTENT ?? '0',
    LANGFUSE_BASE_URL: agentValues.LANGFUSE_BASE_URL,
    LANGFUSE_PUBLIC_KEY: agentValues.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: agentValues.LANGFUSE_SECRET_KEY
  }
  const captureContent = langfuseEnv.BUDINGX_LANGFUSE_CAPTURE_CONTENT === '1'
  const baseUrl = langfuseEnv.LANGFUSE_BASE_URL
  const auth = authHeader(langfuseEnv.LANGFUSE_PUBLIC_KEY, langfuseEnv.LANGFUSE_SECRET_KEY)

  // 前置 1：平台鉴权。失败则在发起任何模型调用前退出。
  let authOk = false
  try {
    authOk = await checkProjectAuth(fetch, baseUrl, auth)
  } catch {
    authOk = false
  }
  if (!authOk) {
    console.error('Langfuse project authentication failed; no model calls made.')
    process.exitCode = 1
    return
  }

  // 前置 2：模型凭据。
  const modelConfig = {
    apiKey: process.env.BUDINGX_SMOKE_MODEL_KEY,
    baseUrl: process.env.BUDINGX_SMOKE_MODEL_BASE_URL,
    model: process.env.BUDINGX_SMOKE_MODEL
  }
  if (!modelConfig.apiKey || !modelConfig.baseUrl || !modelConfig.model) {
    console.error('Provide BUDINGX_SMOKE_MODEL_KEY / BUDINGX_SMOKE_MODEL_BASE_URL / BUDINGX_SMOKE_MODEL.')
    process.exitCode = 1
    return
  }

  const workspace = prepareWorkspace()
  const results = []
  for (const scenario of SCENARIOS) {
    const local = await runScenario(scenario, modelConfig, langfuseEnv, workspace)
    let observations = []
    let platformIndexed = false
    if (local.traceId) {
      observations = await queryObservations(fetch, baseUrl, auth, local.traceId, scenario)
      platformIndexed = observations.length > 0
    }
    const { hierarchyOk, sessionConsistent } = judgeStructure(scenario, observations, local.sessionId)
    const contentVerified = judgeContent(scenario, observations, captureContent)
    const noContent = noContentAnywhere(observations)
    results.push({
      ...local,
      platformIndexed,
      hierarchyOk,
      sessionConsistent,
      contentVerified,
      noContent
    })
  }
  mkdirSync(RUNTIME_DIR, { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify({ captureContent, results }, null, 2) + '\n')
  const exitCode = aggregateExitCode(results, captureContent)
  console.log(`Verification report: ${REPORT_PATH}`)
  for (const r of results) {
    console.log(
      `${r.scenario}: local=${r.localExpectationMet} indexed=${r.platformIndexed} ` +
      `hierarchy=${r.hierarchyOk} session=${r.sessionConsistent} content=${r.contentVerified} trace=${r.traceId}`
    )
  }
  process.exitCode = exitCode
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
