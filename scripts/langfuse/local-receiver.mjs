// SP005：本机 Langfuse 兼容接收端（离线替代件）。
//
// 背景：真实 Langfuse 栈需要 Docker/WSL + postgres/clickhouse/redis/minio。
// 在没有容器运行时的开发机上，可用本接收端观察 Agent 回合：
//   - 接收 OTLP JSON（/api/public/otel/v1/traces），与 src/observability/exporter.ts 同协议；
//   - 提供 v2 Observations 读取接口（/api/public/v2/observations），字段与 Langfuse 对齐；
//   - 提供 /api/public/health 与 /api/public/projects 供脚本前置校验。
//
// 它只做「本机观察」，不复制 Langfuse 源码，也不实现 Web UI、评分或数据集。
// 证据仅落 .runtime/（Git 忽略），仓库只留脱敏摘要。
//
// 用法：node scripts/langfuse/local-receiver.mjs [--port 3000] [--storage <dir>]
// 鉴权：Basic <publicKey>:<secretKey>；密钥来自 --public-key/--secret-key 或环境变量。

import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 把 OTLP 属性数组转成普通对象。 */
export function attributesToObject(attributes) {
  const result = {}
  for (const entry of attributes ?? []) {
    if (!entry || typeof entry.key !== 'string') continue
    const value = entry.value ?? {}
    if (typeof value.stringValue === 'string') result[entry.key] = value.stringValue
    else if (typeof value.intValue === 'number') result[entry.key] = value.intValue
    else if (typeof value.boolValue === 'boolean') result[entry.key] = value.boolValue
    else if (typeof value.doubleValue === 'number') result[entry.key] = value.doubleValue
  }
  return result
}

/** 从 OTLP 资源与 span 属性里取 sessionId。 */
export function sessionIdOf(spanAttributes, resourceAttributes) {
  const attributes = { ...resourceAttributes, ...spanAttributes }
  return (
    attributes['session.id'] ??
    attributes['langfuse.session.id'] ??
    attributes['langfuse.trace.metadata.sessionId'] ??
    attributes['sessionId'] ??
    ''
  )
}

/**
 * 把一批 OTLP span 归一化为内部观测记录。
 * 纯函数，便于单测。
 */
export function toObservations(body) {
  const observations = []
  for (const resourceSpan of body?.resourceSpans ?? []) {
    const resourceAttributes = attributesToObject(resourceSpan?.resource?.attributes)
    for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
      for (const span of scopeSpan?.spans ?? []) {
        const attributes = attributesToObject(span.attributes)
        const outcome = attributes['langfuse.observation.metadata.outcome']
        const level =
          attributes['langfuse.observation.level'] ??
          (span.status?.code === 2 ? 'ERROR' : 'DEFAULT')
        const input = attributes['langfuse.observation.input']
        const output = attributes['langfuse.observation.output']
        observations.push({
          id: span.spanId,
          traceId: span.traceId,
          parentObservationId: span.parentSpanId ?? null,
          name: span.name,
          type: attributes['langfuse.observation.type'] ?? 'span',
          startTime: span.startTimeUnixNano ?? null,
          endTime: span.endTimeUnixNano ?? null,
          level,
          statusMessage: attributes['langfuse.observation.status_message'] ?? null,
          sessionId: sessionIdOf(attributes, resourceAttributes),
          metadata: outcome ? { outcome } : {},
          input: input ?? null,
          output: output ?? null,
          attributes
        })
      }
    }
  }
  return observations
}

/** 解析 Basic 认证头。 */
function parseAuth(header) {
  if (typeof header !== 'string' || !header.startsWith('Basic ')) return undefined
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    const index = decoded.indexOf(':')
    if (index < 0) return undefined
    return { publicKey: decoded.slice(0, index), secretKey: decoded.slice(index + 1) }
  } catch {
    return undefined
  }
}

/** 读取本机密钥（优先命令行，其次环境变量）。 */
function readKeys(argv, env) {
  const pick = (flag) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  return {
    publicKey: pick('--public-key') ?? env.LANGFUSE_PUBLIC_KEY ?? 'pk-lf-local',
    secretKey: pick('--secret-key') ?? env.LANGFUSE_SECRET_KEY ?? 'sk-lf-local'
  }
}

/** 数值排序辅助：纳秒字符串转大整数比较。 */
function compareNanos(a, b) {
  const left = BigInt(a ?? '0')
  const right = BigInt(b ?? '0')
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
 * 构造接收端服务。
 * @returns { server, store }
 */
export function createReceiver(options = {}) {
  const keys = options.keys ?? { publicKey: 'pk-lf-local', secretKey: 'sk-lf-local' }
  const store = { observations: [] }

  const authorized = (req) => {
    const auth = parseAuth(req.headers.authorization)
    if (!auth) return false
    return auth.publicKey === keys.publicKey && auth.secretKey === keys.secretKey
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (req.method === 'GET' && url.pathname === '/api/public/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'OK', version: 'local-receiver' }))
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/public/projects') {
      if (!authorized(req)) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: 'Unauthorized' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'budingx-agent', name: 'budingX Agent' }] }))
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/public/otel/v1/traces') {
      if (!authorized(req)) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: 'Unauthorized' }))
        return
      }
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          const observations = toObservations(body)
          for (const observation of observations) {
            const index = store.observations.findIndex((o) => o.id === observation.id)
            if (index >= 0) store.observations[index] = observation
            else store.observations.push(observation)
          }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ partialSuccess: {} }))
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ message: String(error?.message ?? error) }))
        }
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/public/v2/observations') {
      if (!authorized(req)) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: 'Unauthorized' }))
        return
      }
      const traceId = url.searchParams.get('traceId')
      const sessionId = url.searchParams.get('sessionId')
      const name = url.searchParams.get('name')
      const limit = Number(url.searchParams.get('limit') ?? '100')
      const page = Number(url.searchParams.get('page') ?? '1')
      const fields = url.searchParams.get('fields') ?? 'core,basic,io'
      const wantIo = fields.includes('io')
      let rows = store.observations.slice()
      if (traceId) rows = rows.filter((o) => o.traceId === traceId)
      if (sessionId) rows = rows.filter((o) => o.sessionId === sessionId)
      if (name) rows = rows.filter((o) => o.name === name)
      rows.sort((a, b) => compareNanos(a.startTime, b.startTime))
      const totalItems = rows.length
      const pageSize = Math.max(1, Math.min(limit || 100, 500))
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
      const slice = rows.slice((page - 1) * pageSize, page * pageSize)
      const data = slice.map((o) => ({
        id: o.id,
        traceId: o.traceId,
        parentObservationId: o.parentObservationId,
        name: o.name,
        type: o.type,
        startTime: o.startTime,
        endTime: o.endTime,
        level: o.level,
        statusMessage: o.statusMessage,
        sessionId: o.sessionId,
        metadata: o.metadata,
        input: wantIo ? o.input : null,
        output: wantIo ? o.output : null
      }))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          data,
          meta: { page, limit: pageSize, totalItems, totalPages }
        })
      )
      return
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ message: 'Not found' }))
  })

  return { server, store }
}

/** 从磁盘恢复已有观测（接收端重启后不丢历史）。 */
export function loadObservations(file) {
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 持久化观测到磁盘。 */
export function saveObservations(file, observations) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(observations, null, 2))
}

function parseArgs(argv) {
  const args = { port: 3000, storage: path.join(ROOT, '.runtime', 'langfuse', 'local-receiver') }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') args.port = Number(argv[++i])
    else if (argv[i] === '--storage') args.storage = argv[++i]
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const keys = readKeys(process.argv.slice(2), process.env)
  const storageFile = path.join(args.storage, 'observations.json')
  const { server, store } = createReceiver({ keys })
  store.observations = loadObservations(storageFile)
  const timer = setInterval(() => {
    try {
      saveObservations(storageFile, store.observations)
    } catch {
      /* 落盘失败不影响接收 */
    }
  }, 1000)
  timer.unref?.()
  server.listen(args.port, '127.0.0.1', () => {
    console.log(
      `Local Langfuse-compatible receiver on http://127.0.0.1:${args.port} ` +
      `(observations persisted to ${storageFile})`
    )
  })
  const shutdown = () => {
    try {
      saveObservations(storageFile, store.observations)
    } catch {
      /* 忽略 */
    }
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1000).unref?.()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
