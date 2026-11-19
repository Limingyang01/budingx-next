// SP005 观测平台：真实 Langfuse 栈的接入冒烟（不依赖模型额度）。
// 用生产导出器投递一条合成 trace（agent.run + model.request + tool.Read 失败），
// 再从 v2 Observations API 回查层级、工具名、失败可见性与会话一致性。
// 只证明「上报 → 索引 → 查询」链路，不替代真实模型回合的 OB 判定。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RUNTIME_DIR = path.join(ROOT, '.runtime', 'langfuse')
const AGENT_ENV_PATH = path.join(RUNTIME_DIR, 'agent.env')
const REPORT_PATH = path.join(RUNTIME_DIR, 'stack-smoke.json')
const QUERY_DEADLINE_MS = 60000
const SESSION_ID = 'stack-smoke-session'

/**
 * 判定回查结果：根节点唯一、子节点挂根、工具失败可见、模型节点存在、会话一致。
 * @param observations v2 Observations API 返回的数组
 * @param expectedSessionId 本地投递时写入的会话 ID
 */
export function judgeStackObservations(observations, expectedSessionId) {
  const roots = observations.filter((o) => o.name === 'agent.run')
  const children = observations.filter((o) => o.name !== 'agent.run')
  const hierarchyOk = roots.length === 1 &&
    !roots[0].parentObservationId &&
    children.length > 0 &&
    children.every((o) => o.parentObservationId === roots[0].id)
  const toolErrorVisible = children.some((o) => o.name.startsWith('tool.') && o.level === 'ERROR')
  const modelPresent = children.some((o) => o.name === 'model.request')
  const sessionConsistent = observations.length > 0 &&
    observations.every((o) => o.sessionId === expectedSessionId)
  return {
    count: observations.length,
    rootCount: roots.length,
    hierarchyOk,
    toolErrorVisible,
    modelPresent,
    sessionConsistent,
    ok: hierarchyOk && toolErrorVisible && modelPresent && sessionConsistent
  }
}

/** 读取 agent.env，并让进程环境优先。 */
function readConfig() {
  const fromFile = existsSync(AGENT_ENV_PATH) ? parseEnv(readFileSync(AGENT_ENV_PATH, 'utf8')) : {}
  const merged = { ...fromFile, ...process.env }
  return {
    baseUrl: merged.LANGFUSE_BASE_URL,
    publicKey: merged.LANGFUSE_PUBLIC_KEY,
    secretKey: merged.LANGFUSE_SECRET_KEY
  }
}

/** 构造合成批次：一条根 span、一个模型节点、一个失败工具节点。 */
export function buildSmokeBatch(traceId, rootId) {
  const modelId = 'c2'.repeat(8)
  const toolId = 'c3'.repeat(8)
  const start = BigInt(Date.now()) * 1000000n
  const attr = (spanId, parentSpanId, name, attributes, extra) => ({
    traceId,
    spanId,
    ...(parentSpanId ? { parentSpanId } : {}),
    name,
    startTimeUnixNano: String(start),
    endTimeUnixNano: String(start + 1200000000n),
    attributes,
    ...extra
  })
  return {
    rootId,
    toolId,
    batch: {
      spans: [
        attr(rootId, undefined, 'agent.run', {
          'session.id': SESSION_ID,
          'langfuse.observation.type': 'agent',
          'langfuse.trace.name': 'stack-smoke'
        }),
        attr(modelId, rootId, 'model.request', {
          'session.id': SESSION_ID,
          'langfuse.observation.type': 'generation',
          'langfuse.observation.model.name': 'stack-smoke-model'
        }),
        attr(toolId, rootId, 'tool.Read', {
          'session.id': SESSION_ID,
          'langfuse.observation.type': 'tool',
          'langfuse.observation.level': 'ERROR',
          'langfuse.observation.status_message': 'stack smoke synthetic failure'
        }, { status: { code: 2 } })
      ]
    },
    payloads: new Map([
      [rootId, { input: 'stack smoke input', output: 'stack smoke output' }],
      [toolId, { input: { file: 'README.md' }, output: 'ENOENT stack smoke' }]
    ])
  }
}

/** 按 traceId 轮询 v2 Observations API，直到节点齐全或截止。 */
export async function queryTrace(fetchImpl, baseUrl, auth, traceId, deadlineMs = QUERY_DEADLINE_MS) {
  const deadline = Date.now() + deadlineMs
  const url = new URL('/api/public/v2/observations', baseUrl)
  url.searchParams.set('traceId', traceId)
  url.searchParams.set('fields', 'core,basic,io')
  url.searchParams.set('limit', '100')
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url.toString(), {
        headers: { authorization: auth },
        signal: AbortSignal.timeout(10000)
      })
      if (response.ok) {
        const body = await response.json()
        const data = body.data ?? []
        if (data.length > 0) return data
      }
    } catch {
      // 查询失败保留事实，继续轮询直到截止。
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  return []
}

async function main() {
  const config = readConfig()
  const missing = ['baseUrl', 'publicKey', 'secretKey'].filter((key) => !config[key])
  if (missing.length > 0) {
    console.error('缺少 Langfuse 配置：' + missing.join(', ') + '（先运行 npm run langfuse:init，或导出 LANGFUSE_*）')
    process.exitCode = 1
    return
  }
  const exporterUrl = pathToFileURL(path.join(ROOT, 'src', 'tui', 'dist', 'observability', 'exporter.js'))
  const { OtlpExporter } = await import(exporterUrl.href)
  const exporter = new OtlpExporter({
    baseUrl: config.baseUrl,
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    captureContent: true
  })
  const traceId = 'c1'.repeat(16)
  const rootId = 'c1'.repeat(8)
  const { batch, payloads } = buildSmokeBatch(traceId, rootId)
  const sent = await exporter.sendBatch(batch, payloads)
  const auth = 'Basic ' + Buffer.from(config.publicKey + ':' + config.secretKey).toString('base64')
  const observations = sent ? await queryTrace(fetch, config.baseUrl, auth, traceId) : []
  const verdict = judgeStackObservations(observations, SESSION_ID)
  const report = {
    baseUrl: config.baseUrl,
    traceId,
    sessionId: SESSION_ID,
    sent,
    ...verdict,
    checkedAt: new Date().toISOString()
  }
  mkdirSync(RUNTIME_DIR, { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = verdict.ok ? 0 : 1
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
