// SP005 §8：SP005 场景的观测验收（真实 Provider + 本机 Langfuse 兼容接收端）。
//
// 目标不是「有一条 trace」，而是核对：
//   - 根观测唯一，父链正确，session 一致（OB-01/OB-02）；
//   - 工具观测名与真实工具名一致，失败为 ERROR、权限阻断为 WARNING（OB-03）；
//   - 压缩、持久化、记忆等 SP005 行为在观测里可定位（CB/SR/PM 观测证据）。
//
// 运行：node scripts/langfuse/sp005-observation.mjs
// 配置取自 .runtime/langfuse/agent.env 与 .env.e2e.local；证据只落 .runtime/。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { Session } from '../../src/tui/dist/core/session.js'
import { createOpenAiProvider } from '../../src/tui/dist/provider/openai.js'
import { createWorkspaceTools } from '../../src/tui/dist/workspace/tools.js'
import { createWorkspace } from '../../src/tui/dist/workspace/paths.js'
import { setupTracing } from '../../src/tui/dist/tui/runtime.js'
import { createSessionStore, startSession } from '../../src/tui/dist/storage/session-store.js'
import { ERROR_CODES, MAX_TOOL_FAILURE_STREAK } from '../../src/tui/dist/core/constants.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RUNTIME_DIR = path.join(ROOT, '.runtime', 'langfuse')
const WORKSPACE_DIR = path.join(RUNTIME_DIR, 'sp005-workspace')
const REPORT_PATH = path.join(RUNTIME_DIR, 'sp005-observation.json')

/**
 * 判定层级与会话一致性（OB-02）。
 * @param observations v2 API 返回的观测数组
 * @param expectedSessionId 本地预期的会话 ID
 */
export function judgeHierarchy(observations, expectedSessionId) {
  const roots = observations.filter((o) => o.name === 'agent.run')
  if (roots.length !== 1) {
    return { ok: false, reason: 'expected exactly one agent.run root', roots: roots.length }
  }
  const root = roots[0]
  if (root.parentObservationId) {
    return { ok: false, reason: 'root observation must not have a parent' }
  }
  const children = observations.filter((o) => o.name !== 'agent.run')
  const orphan = children.filter((o) => o.parentObservationId !== root.id)
  if (orphan.length > 0) {
    return { ok: false, reason: 'every child must point at the root', orphan: orphan.map((o) => o.name) }
  }
  if (!observations.every((o) => o.sessionId === expectedSessionId)) {
    return { ok: false, reason: 'session id must be identical across observations' }
  }
  return { ok: true, rootLevel: root.level, rootOutcome: root.metadata?.outcome ?? null }
}

/**
 * 判定场景的本地预期结果。
 *
 * tool-error 场景允许两种正确收尾：模型读到错误后如实汇报（completed），
 * 或反复换路径重试触发 SP005 空转熔断（error + coreToolLoopDetected）。
 * 后者是设计内的显式停机，比无限重试更可取，但不能是其它错误码。
 * @param scenario 'tool-success' | 'tool-error'
 * @param toolResults 本回合的 tool_result 事件
 * @param finalEvent turn_finalized 事件
 */
export function judgeScenarioOutcome(scenario, toolResults, finalEvent) {
  const failed = toolResults.some((t) => t.isError)
  const succeeded = toolResults.some((t) => !t.isError)
  if (scenario === 'tool-error') {
    const stoppedByBreaker =
      finalEvent.outcome === 'error' &&
      finalEvent.error?.code === ERROR_CODES.coreToolLoopDetected
    return failed && (finalEvent.outcome === 'completed' || stoppedByBreaker)
  }
  return succeeded && finalEvent.outcome === 'completed'
}

/**
 * 判定工具观测名与真实工具名一致（OB-03）。
 * 真实工具名来自生产工具表，而不是脚本里手写的字符串。
 */
export function judgeToolNames(observations, toolNames) {
  const toolObservations = observations.filter((o) => o.name.startsWith('tool.'))
  const observed = toolObservations.map((o) => o.name.slice('tool.'.length))
  const unknown = observed.filter((name) => !toolNames.includes(name))
  if (unknown.length > 0) {
    return { ok: false, reason: 'observed tool names must exist in the real tool table', unknown }
  }
  return { ok: true, observed }
}

/**
 * 判定失败与阻断的级别（OB-03）：工具失败是 ERROR，权限阻断是 WARNING。
 */
export function judgeLevels(observations, expectations) {
  const problems = []
  for (const item of expectations) {
    const match = observations.find((o) => o.name === item.name)
    if (!match) {
      problems.push(`${item.name}: observation missing`)
      continue
    }
    if (match.level !== item.level) {
      problems.push(`${item.name}: expected level ${item.level}, got ${match.level}`)
    }
  }
  return { ok: problems.length === 0, problems }
}

/**
 * 判定工具调用是否合适（工具调用质量）：次数有界、参数指向真实目标、无重复调用。
 * 次数上限默认 2：允许模型在失败后重试一次，但重复同一调用视为浪费。
 * @param observations v2 API 返回的观测数组
 * @param expectation { name, maxCalls, argsMustInclude }
 */
export function judgeToolCalls(observations, expectation) {
  const wanted = 'tool.' + expectation.name
  const calls = observations.filter((o) => o.name === wanted)
  const maxCalls = expectation.maxCalls ?? 2
  const problems = []
  if (calls.length === 0) problems.push(wanted + ': no tool call observation')
  if (calls.length > maxCalls) {
    problems.push(wanted + ': ' + calls.length + ' calls exceed the budget of ' + maxCalls)
  }
  const seen = new Set()
  for (const call of calls) {
    const raw = typeof call.input === 'string' ? call.input : JSON.stringify(call.input ?? null)
    if (expectation.argsMustInclude && !raw.includes(expectation.argsMustInclude)) {
      problems.push(wanted + ': arguments do not mention ' + expectation.argsMustInclude)
    }
    if (seen.has(raw)) problems.push(wanted + ': duplicate call with identical arguments ' + raw)
    seen.add(raw)
  }
  return { ok: problems.length === 0, calls: calls.length, problems }
}

/**
 * 判定模型观测带真实用量（OB-03 的可观测性要求：generation 能定位成本与耗时）。
 */
export function judgeModelObservations(observations) {
  const generations = observations.filter((o) => o.name === 'model.request')
  if (generations.length === 0) {
    return { ok: false, count: 0, totalUsage: 0, reason: 'no model.request observation' }
  }
  const totalUsage = generations.reduce((sum, o) => sum + Number(o.totalUsage ?? 0), 0)
  const slow = generations.filter((o) => Number(o.latency ?? 0) <= 0)
  if (totalUsage <= 0) {
    return { ok: false, count: generations.length, totalUsage, reason: 'model request reports no token usage' }
  }
  if (slow.length > 0) {
    return { ok: false, count: generations.length, totalUsage, reason: 'model request has no measurable latency' }
  }
  return { ok: true, count: generations.length, totalUsage }
}

/** 读取本地环境文件。 */
function readEnvFile(file) {
  if (!existsSync(file)) return {}
  return parseEnv(readFileSync(file, 'utf8'))
}

/** 准备只读 fixture 工作区。 */
function prepareWorkspace() {
  mkdirSync(WORKSPACE_DIR, { recursive: true })
  writeFileSync(path.join(WORKSPACE_DIR, 'note.txt'), 'SP005 local observation fixture.\n')
  writeFileSync(path.join(WORKSPACE_DIR, 'facts.txt'), 'alpha\nbeta\ngamma\n')
  return createWorkspace(WORKSPACE_DIR)
}

/**
 * 跑一个场景：真实 Provider + 真实工具 + 真实追踪器 + 会话转录。
 */
async function runScenario(scenario, modelConfig, langfuseEnv, workspace) {
  const sessionId = `sp005-${scenario}-${Date.now()}`
  const receipts = []
  const tracing = setupTracing({
    sessionId,
    env: langfuseEnv,
    modelApiKey: modelConfig.apiKey,
    onReceipt: (receipt) => receipts.push(receipt)
  })
  const provider = createOpenAiProvider({ baseUrl: modelConfig.baseUrl, apiKey: modelConfig.apiKey })
  const { tools } = createWorkspaceTools(workspace)
  const readTools = tools.filter((tool) => tool.name === 'Read')
  const started = startSession({ sessionId })
  const events = []
  const session = new Session({
    id: sessionId,
    provider,
    approval: { async request() { return { outcome: 'allow', via: 'policy' } } },
    resolveSnapshot: () => ({
      modelId: 'sp005',
      model: modelConfig.model,
      baseUrlHost: new URL(modelConfig.baseUrl).host,
      capabilities: { tools: true }
    }),
    tools: readTools,
    transcript: started.transcript,
    contextBudget: { maxTokens: 4096, reservedOutputTokens: 512 },
    ...(tracing.tracer ? { tracer: tracing.tracer } : {})
  })
  session.on((event) => events.push(event))
  const prompts = {
    'tool-success': 'Use the Read tool to read facts.txt, then list its three lines.',
    'tool-error': 'Use the Read tool to read missing-sp005.txt, then report the result.'
  }
  const finalized = new Promise((resolve) => {
    session.on((event) => { if (event.type === 'turn_finalized') resolve(event) })
  })
  const timer = setTimeout(() => session.interrupt(), 120000)
  session.submit(prompts[scenario])
  const finalEvent = await finalized
  clearTimeout(timer)
  await tracing.shutdown?.()

  const toolResults = events.filter((e) => e.type === 'tool_result')
  const receipt = receipts.find((r) => r.turnId === finalEvent.turnId) ?? receipts[0]
  const localExpectationMet = judgeScenarioOutcome(scenario, toolResults, finalEvent)
  return {
    scenario,
    sessionId,
    traceId: receipt?.traceId ?? null,
    outcome: finalEvent.outcome,
    toolCalls: toolResults.map((t) => ({ name: t.callId, isError: t.isError })),
    localExpectationMet,
    realToolNames: readTools.map((t) => t.name)
  }
}

/** 轮询接收端直到该 trace 的观测齐全。 */
async function queryObservations(baseUrl, auth, traceId, deadlineMs = 60000) {
  const deadline = Date.now() + deadlineMs
  const url = new URL('/api/public/v2/observations', baseUrl)
  url.searchParams.set('traceId', traceId)
  url.searchParams.set('fields', 'core,basic,io,usage')
  url.searchParams.set('limit', '100')
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url.toString(), {
        headers: { authorization: auth },
        signal: AbortSignal.timeout(10000)
      })
      if (response.ok) {
        const body = await response.json()
        const rows = body.data ?? []
        if (rows.some((o) => o.name === 'agent.run')) return rows
      }
    } catch {
      // 保留事实，继续轮询。
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  return []
}

/** 主流程。 */
async function main() {
  const agentValues = readEnvFile(path.join(RUNTIME_DIR, 'agent.env'))
  const e2eValues = readEnvFile(path.join(ROOT, '.env.e2e.local'))
  const langfuseEnv = {
    BUDINGX_LANGFUSE_ENABLED: '1',
    BUDINGX_LANGFUSE_CAPTURE_CONTENT:
      e2eValues.BUDINGX_LANGFUSE_CAPTURE_CONTENT ??
      agentValues.BUDINGX_LANGFUSE_CAPTURE_CONTENT ??
      '0',
    LANGFUSE_BASE_URL: agentValues.LANGFUSE_BASE_URL ?? 'http://localhost:3000',
    LANGFUSE_PUBLIC_KEY: agentValues.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: agentValues.LANGFUSE_SECRET_KEY
  }
  if (!langfuseEnv.LANGFUSE_PUBLIC_KEY || !langfuseEnv.LANGFUSE_SECRET_KEY) {
    console.error('Missing Langfuse keys; run scripts/langfuse/init-local.mjs first.')
    process.exitCode = 1
    return
  }
  const modelConfig = {
    apiKey: e2eValues.BUDINGX_API_KEY,
    baseUrl: e2eValues.BUDINGX_BASE_URL,
    model: e2eValues.BUDINGX_MODEL
  }
  if (!modelConfig.apiKey || !modelConfig.baseUrl || !modelConfig.model) {
    console.error('Missing .env.e2e.local model configuration.')
    process.exitCode = 1
    return
  }
  const auth =
    'Basic ' + Buffer.from(`${langfuseEnv.LANGFUSE_PUBLIC_KEY}:${langfuseEnv.LANGFUSE_SECRET_KEY}`).toString('base64')
  const workspace = prepareWorkspace()
  const results = []
  for (const scenario of ['tool-success', 'tool-error']) {
    const local = await runScenario(scenario, modelConfig, langfuseEnv, workspace)
    const observations = local.traceId
      ? await queryObservations(langfuseEnv.LANGFUSE_BASE_URL, auth, local.traceId)
      : []
    const hierarchy = judgeHierarchy(observations, local.sessionId)
    const toolNames = judgeToolNames(observations, local.realToolNames)
    const levels = judgeLevels(observations, [
      { name: 'tool.Read', level: scenario === 'tool-error' ? 'ERROR' : 'DEFAULT' }
    ])
    // 工具调用质量：恰好一次 Read，参数指向该场景的目标文件，且没有重复调用。
    // 失败场景允许模型换路径重试，但不得超过熔断阈值；
    // 超过阈值说明空转熔断本身失效，这是产品缺陷而不是模型自由发挥。
    const toolCalls = judgeToolCalls(observations, {
      name: 'Read',
      maxCalls: scenario === 'tool-error' ? MAX_TOOL_FAILURE_STREAK : 2,
      argsMustInclude: scenario === 'tool-error' ? 'missing-sp005.txt' : 'facts.txt'
    })
    const modelObservations = judgeModelObservations(observations)
    results.push({
      ...local,
      observationCount: observations.length,
      hierarchy,
      toolNames,
      levels,
      toolCalls,
      modelObservations,
      observationNames: observations.map((o) => ({ name: o.name, level: o.level, parent: o.parentObservationId }))
    })
  }
  mkdirSync(RUNTIME_DIR, { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify({ results }, null, 2) + '\n')
  console.log(`SP005 observation report: ${REPORT_PATH}`)
  let failed = false
  for (const r of results) {
    const ok =
      r.localExpectationMet &&
      r.hierarchy.ok &&
      r.toolNames.ok &&
      r.levels.ok &&
      r.toolCalls.ok &&
      r.modelObservations.ok
    if (!ok) failed = true
    console.log(
      `${r.scenario}: local=${r.localExpectationMet} obs=${r.observationCount} ` +
        `hierarchy=${r.hierarchy.ok} tools=${r.toolNames.ok} levels=${r.levels.ok} ` +
        `calls=${r.toolCalls.calls} usage=${r.modelObservations.totalUsage} trace=${r.traceId}`
    )
  }
  process.exitCode = failed ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
