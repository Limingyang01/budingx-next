// SP004 agent-observability：Langfuse trace 查询（跨平台 Node，无 WSL/bash 引号问题）。
// 用 v2 Observations API 拉取观测并按 trace 汇总。Langfuse v4 events_only 模式下
// 旧 /api/public/traces 端点不可用，必须用 v2 observations（或 Web UI）。
//
// 运行：node scripts/langfuse/query-traces.mjs [--trace <id>] [--limit N] [--json]
// 配置取自 .runtime/langfuse/agent.env，进程环境 LANGFUSE_* 可覆盖。
// 纯函数 summarizeTraces 导出供测试；main 仅在直接执行时运行。

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 读取 Langfuse 连接配置（agent.env 优先，进程环境覆盖）。 */
export function loadLangfuseConfig(env = process.env) {
  const file = path.join(ROOT, '.runtime', 'langfuse', 'agent.env')
  const fileValues = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}
  const pick = (key) => env[key] ?? fileValues[key]
  return {
    baseUrl: pick('LANGFUSE_BASE_URL') || 'http://localhost:3000',
    publicKey: pick('LANGFUSE_PUBLIC_KEY'),
    secretKey: pick('LANGFUSE_SECRET_KEY')
  }
}

/** 按 trace 汇总观测（纯函数）。 */
export function summarizeTraces(observations) {
  const byTrace = new Map()
  for (const o of observations) {
    if (!byTrace.has(o.traceId)) byTrace.set(o.traceId, [])
    byTrace.get(o.traceId).push(o)
  }
  const summaries = []
  for (const [traceId, obs] of byTrace) {
    const root = obs.find((o) => o.name === 'agent.run' || o.name === 'agent.side_question')
    summaries.push({
      traceId,
      sessionId: root?.sessionId ?? obs[0]?.sessionId ?? '',
      total: obs.length,
      models: obs.filter((o) => o.name === 'model.request').length,
      tools: obs.filter((o) => o.name.startsWith('tool.')).length,
      errors: obs.filter((o) => o.level === 'ERROR').length,
      warnings: obs.filter((o) => o.level === 'WARNING').length,
      rootLevel: root?.level ?? null,
      rootOutcome: root?.metadata?.outcome ?? root?.statusMessage ?? null,
      startTime: root?.startTime ?? obs[0]?.startTime ?? null
    })
  }
  summaries.sort((a, b) => String(b.startTime).localeCompare(String(a.startTime)))
  return summaries
}

/** 拉取观测（v2 API，Basic 认证，fields=core,basic,io）。 */
export async function fetchObservations(config, { traceId, limit = 200 } = {}, fetchImpl = fetch) {
  if (!config.publicKey || !config.secretKey) {
    throw new Error('Missing Langfuse keys; run scripts/langfuse/init-local.mjs first.')
  }
  const url = new URL('/api/public/v2/observations', config.baseUrl)
  url.searchParams.set('fields', 'core,basic,io')
  url.searchParams.set('limit', String(limit))
  if (traceId) url.searchParams.set('traceId', traceId)
  const auth = 'Basic ' + Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')
  const response = await fetchImpl(url.toString(), {
    headers: { authorization: auth },
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) throw new Error(`Langfuse query failed: HTTP ${response.status}`)
  const body = await response.json()
  return body.data ?? []
}

function parseArgs(argv) {
  const args = { limit: 200, json: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--trace') args.traceId = argv[++i]
    else if (argv[i] === '--limit') args.limit = Number(argv[++i])
    else if (argv[i] === '--json') args.json = true
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const config = loadLangfuseConfig()
  const observations = await fetchObservations(config, args)
  const summaries = summarizeTraces(observations)
  if (args.json) {
    console.log(JSON.stringify(summaries, null, 2))
    return
  }
  console.log(`观测总数: ${observations.length} | trace 数: ${summaries.length}`)
  for (const s of summaries) {
    console.log(
      `- ${s.traceId} | 观测:${s.total} model:${s.models} tool:${s.tools} ` +
      `ERROR:${s.errors} WARNING:${s.warnings} | root:${s.rootLevel ?? '?'} outcome:${s.rootOutcome ?? '?'} | session:${s.sessionId}`
    )
  }
  if (summaries.length === 0) {
    console.log('（无观测。确认追踪已启用并跑过回合；v4 events_only 模式请用本脚本/UI，勿用旧 /api/public/traces。）')
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
