// SP004 agent-observability T28：配置加载、URL 校验、上下文与 OTLP 导出器。
// 覆盖 OB-06…OB-10、OB-16、OB-20、OB-22、OB-23。
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  buildRequestBody,
  loadTracingEnvironment,
  isValidBaseUrl,
  OtlpExporter,
  TraceContext,
  TracingRuntime
} from '../../tui/dist/observability/index.js'

const ENABLED_ENV = {
  BUDINGX_LANGFUSE_ENABLED: '1',
  LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
  LANGFUSE_SECRET_KEY: 'sk-lf-test',
  LANGFUSE_BASE_URL: 'http://localhost:3000'
}

function tempEnvFile(contents) {
  const dir = mkdtempSync(path.join(tmpdir(), 'obs-config-'))
  const file = path.join(dir, 'agent.env')
  writeFileSync(file, contents)
  return file
}

// ---------- 配置加载（OB-07…OB-09） ----------

test('only the five allowlisted variables are imported from the env file', () => {
  const file = tempEnvFile(
    [
      'BUDINGX_LANGFUSE_ENABLED=1',
      'BUDINGX_LANGFUSE_CAPTURE_CONTENT=1',
      'LANGFUSE_BASE_URL=http://localhost:3000',
      'LANGFUSE_PUBLIC_KEY=pk-file',
      'LANGFUSE_SECRET_KEY=sk-file',
      'NODE_OPTIONS=--require=evil.js',
      'PATH_EXTRA=nope'
    ].join('\n')
  )
  const result = loadTracingEnvironment({}, file)
  assert.equal(result.BUDINGX_LANGFUSE_ENABLED, '1')
  assert.equal(result.LANGFUSE_PUBLIC_KEY, 'pk-file')
  assert.equal(result.NODE_OPTIONS, undefined)
  assert.equal(result.PATH_EXTRA, undefined)
})

test('the inherited environment wins over the env file', () => {
  const file = tempEnvFile('LANGFUSE_PUBLIC_KEY=pk-file\n')
  const result = loadTracingEnvironment({ LANGFUSE_PUBLIC_KEY: 'pk-env' }, file)
  assert.equal(result.LANGFUSE_PUBLIC_KEY, 'pk-env')
})

test('a relative env file path keeps the inherited environment and reports', () => {
  const reports = []
  const result = loadTracingEnvironment({ LANGFUSE_PUBLIC_KEY: 'pk-env' }, 'relative/path.env', (m) =>
    reports.push(m)
  )
  assert.equal(result.LANGFUSE_PUBLIC_KEY, 'pk-env')
  assert.equal(reports.length, 1)
})

test('an unreadable env file keeps the inherited environment and reports', () => {
  const reports = []
  const result = loadTracingEnvironment(
    { LANGFUSE_PUBLIC_KEY: 'pk-env' },
    path.join(tmpdir(), 'definitely-missing-obs.env'),
    (m) => reports.push(m)
  )
  assert.equal(result.LANGFUSE_PUBLIC_KEY, 'pk-env')
  assert.equal(reports.length, 1)
})

test('no env file means no diagnostic and no change', () => {
  const reports = []
  const result = loadTracingEnvironment({ A: '1' }, undefined, (m) => reports.push(m))
  assert.equal(result.A, '1')
  assert.equal(reports.length, 0)
})

// ---------- URL 校验（OB-10） ----------

test('base url validation rejects unsafe and non local plain http endpoints', () => {
  assert.equal(isValidBaseUrl('file:///etc/passwd'), false)
  assert.equal(isValidBaseUrl('ftp://example.com'), false)
  assert.equal(isValidBaseUrl('http://user:pass@example.com'), false)
  assert.equal(isValidBaseUrl('https://user:pass@example.com'), false)
  assert.equal(isValidBaseUrl('http://example.com'), false)
})

test('base url validation accepts local http and any https', () => {
  assert.equal(isValidBaseUrl('http://localhost:3000'), true)
  assert.equal(isValidBaseUrl('http://127.0.0.1:3000'), true)
  assert.equal(isValidBaseUrl('https://cloud.example.com'), true)
})

// ---------- 导出器与请求体（OB-16、A-14、11b、11c） ----------

function sampleBatch() {
  const context = new TraceContext()
  const root = context.beginTurn('session-1', 'turn-1', {
    'session.id': 'session-1',
    'turn.id': 'turn-1',
    'langfuse.trace.metadata.runId': 'run-1',
    'langfuse.observation.type': 'agent'
  })
  const model = context.begin(
    'model.request',
    {
      'langfuse.observation.type': 'generation',
      'gen_ai.request.model': 'test-model',
      'session.id': 'session-1',
      'turn.id': 'turn-1'
    },
    root
  )
  context.setAttributes(model, {
    'langfuse.observation.usage_details': JSON.stringify({ input: 12, output: 5 })
  })
  context.end(model, 'success')
  const tool = context.begin(
    'tool.Read',
    {
      'langfuse.observation.type': 'tool',
      'gen_ai.tool.call.id': 'call-1',
      'session.id': 'session-1',
      'turn.id': 'turn-1'
    },
    root
  )
  context.end(tool, 'success')
  context.end(root, 'success')
  return context.sealTurn('turn-1')
}

test('the request body carries the otlp envelope and the official attribute names', () => {
  const body = buildRequestBody(sampleBatch(), { captureContent: false })
  const resourceSpans = body.resourceSpans
  assert.equal(resourceSpans.length, 1)
  const resourceAttrs = resourceSpans[0].resource.attributes
  assert.equal(resourceAttrs[0].key, 'service.name')
  assert.equal(resourceAttrs[0].value.stringValue, 'budingx-tui')
  const scopeSpans = resourceSpans[0].scopeSpans
  assert.equal(scopeSpans[0].scope.name, 'budingx-agent')
  const spans = scopeSpans[0].spans
  assert.equal(spans.length, 3)

  const root = spans.find((s) => s.name === 'agent.run')
  assert.ok(root, 'root observation must exist')
  const rootKeys = root.attributes.map((a) => a.key)
  assert.ok(rootKeys.includes('langfuse.observation.type'))
  assert.ok(rootKeys.includes('langfuse.observation.metadata.outcome'))
  assert.ok(rootKeys.includes('session.id'))
  assert.ok(rootKeys.includes('turn.id'))

  const model = spans.find((s) => s.name === 'model.request')
  const modelKeys = model.attributes.map((a) => a.key)
  assert.ok(modelKeys.includes('gen_ai.request.model'))
  assert.ok(modelKeys.includes('langfuse.observation.usage_details'))
  const usage = model.attributes.find((a) => a.key === 'langfuse.observation.usage_details')
  assert.deepEqual(JSON.parse(usage.value.stringValue), { input: 12, output: 5 })
})

test('every span carries both timestamps', () => {
  const body = buildRequestBody(sampleBatch(), { captureContent: false })
  for (const span of body.resourceSpans[0].scopeSpans[0].spans) {
    assert.ok(span.startTimeUnixNano, `${span.name} needs a start time`)
    assert.ok(span.endTimeUnixNano, `${span.name} needs an end time`)
  }
})

test('child spans point at the root and share the trace id', () => {
  const body = buildRequestBody(sampleBatch(), { captureContent: false })
  const spans = body.resourceSpans[0].scopeSpans[0].spans
  const root = spans.find((s) => s.name === 'agent.run')
  for (const span of spans) {
    if (span.name === 'agent.run') continue
    assert.equal(span.parentSpanId, root.spanId)
    assert.equal(span.traceId, root.traceId)
  }
})

test('no input or output attributes exist when content capture is off', () => {
  const body = buildRequestBody(sampleBatch(), { captureContent: false })
  for (const span of body.resourceSpans[0].scopeSpans[0].spans) {
    const keys = span.attributes.map((a) => a.key)
    assert.ok(!keys.includes('langfuse.observation.input'))
    assert.ok(!keys.includes('langfuse.observation.output'))
  }
})

test('the exporter posts to the traces endpoint with the required headers', async () => {
  const seen = []
  const exporter = new OtlpExporter({
    baseUrl: 'http://localhost:3000',
    publicKey: 'pk-lf-test',
    secretKey: 'sk-lf-test',
    captureContent: false,
    fetch: async (url, init) => {
      seen.push({ url, init })
      return new Response('{}', { status: 200 })
    }
  })
  const ok = await exporter.sendBatch(sampleBatch())
  assert.equal(ok, true)
  assert.equal(seen[0].url, 'http://localhost:3000/api/public/otel/v1/traces')
  assert.equal(seen[0].init.method, 'POST')
  assert.equal(seen[0].init.headers['x-langfuse-ingestion-version'], '4')
  assert.equal(seen[0].init.redirect, 'error')
  assert.ok(seen[0].init.headers.authorization.startsWith('Basic '))
  assert.ok(seen[0].init.signal, 'a timeout signal must be attached')
})

test('the exporter swallows platform errors', async () => {
  const failing = new OtlpExporter({
    baseUrl: 'http://localhost:3000',
    publicKey: 'pk',
    secretKey: 'sk',
    fetch: async () => {
      throw new Error('connection refused')
    }
  })
  assert.equal(await failing.sendBatch(sampleBatch()), false)

  const serverError = new OtlpExporter({
    baseUrl: 'http://localhost:3000',
    publicKey: 'pk',
    secretKey: 'sk',
    fetch: async () => new Response('nope', { status: 500 })
  })
  assert.equal(await serverError.sendBatch(sampleBatch()), false)
})

// ---------- 运行时（OB-06、OB-20、OB-22、OB-23） ----------

test('a runtime without enablement never sends anything', async () => {
  let calls = 0
  const runtime = new TracingRuntime({
    config: { enabled: false },
    sessionId: 'session-1',
    fetch: async () => {
      calls++
      return new Response('{}', { status: 200 })
    }
  })
  const root = runtime.begin('agent.run', { 'turn.id': 't1', 'session.id': 'session-1' })
  assert.equal(root, undefined)
  runtime.sealTurn('t1')
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(calls, 0)
})

test('a turn seals and sends its batch in the background', async () => {
  const seen = []
  const runtime = new TracingRuntime({
    config: { enabled: true, baseUrl: 'http://localhost:3000', publicKey: 'pk', secretKey: 'sk' },
    sessionId: 'session-1',
    fetch: async (url, init) => {
      seen.push({ url, init })
      return new Response('{}', { status: 200 })
    }
  })
  const root = runtime.begin('agent.run', {
    'turn.id': 'turn-1',
    'session.id': 'session-1',
    'langfuse.observation.type': 'agent'
  })
  const model = runtime.begin('model.request', { 'gen_ai.request.model': 'm' }, root)
  runtime.end(model, 'success')
  runtime.end(root, 'success')
  runtime.sealTurn('turn-1')

  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(seen.length, 1)
  const body = JSON.parse(seen[0].init.body)
  const spans = body.resourceSpans[0].scopeSpans[0].spans
  assert.equal(spans.length, 2)
  const rootSpan = spans.find((s) => s.name === 'agent.run')
  const modelSpan = spans.find((s) => s.name === 'model.request')
  assert.equal(modelSpan.parentSpanId, rootSpan.spanId)
})

test('the receipt reports the trace id and the send result', async () => {
  const receipts = []
  const runtime = new TracingRuntime({
    config: { enabled: true, baseUrl: 'http://localhost:3000', publicKey: 'pk', secretKey: 'sk' },
    sessionId: 'session-1',
    report: (r) => receipts.push(r),
    fetch: async () => new Response('{}', { status: 200 })
  })
  const root = runtime.begin('agent.run', { 'turn.id': 'turn-1', 'session.id': 'session-1' })
  runtime.end(root, 'success')
  runtime.sealTurn('turn-1')
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(receipts.length, 1)
  assert.equal(receipts[0].turnId, 'turn-1')
  assert.equal(receipts[0].sessionId, 'session-1')
  assert.equal(typeof receipts[0].traceId, 'string')
  assert.equal(receipts[0].sent, true)
})

test('disabling stops new observations and drops the pending batches', async () => {
  let calls = 0
  const runtime = new TracingRuntime({
    config: { enabled: true, baseUrl: 'http://localhost:3000', publicKey: 'pk', secretKey: 'sk' },
    sessionId: 'session-1',
    fetch: async () => {
      calls++
      return new Response('{}', { status: 200 })
    }
  })
  runtime.disable()
  const root = runtime.begin('agent.run', { 'turn.id': 'turn-1', 'session.id': 'session-1' })
  assert.equal(root, undefined)
  runtime.sealTurn('turn-1')
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(calls, 0)
})

test('a turn outcome of blocked maps to a warning level', () => {
  const context = new TraceContext()
  const root = context.beginTurn('s', 't', { 'turn.id': 't', 'session.id': 's' })
  const tool = context.begin('tool.Read', { 'turn.id': 't', 'session.id': 's' }, root)
  context.end(tool, 'blocked')
  const batch = context.sealTurn('t')
  const span = batch.spans.find((s) => s.name === 'tool.Read')
  assert.equal(span.attributes['langfuse.observation.metadata.outcome'], 'blocked')
  assert.equal(span.attributes['langfuse.observation.level'], 'WARNING')
})

test('an error outcome maps to an error level and status code', () => {
  const context = new TraceContext()
  const root = context.beginTurn('s', 't', { 'turn.id': 't', 'session.id': 's' })
  context.end(root, 'error', { code: 'BUDINGX_CORE_001' })
  const batch = context.sealTurn('t')
  const span = batch.spans.find((s) => s.name === 'agent.run')
  assert.equal(span.attributes['langfuse.observation.level'], 'ERROR')
  assert.equal(span.attributes['langfuse.observation.status_message'], 'BUDINGX_CORE_001')
  assert.deepEqual(span.status, { code: 2 })
})

test('the span limit drops the whole turn batch', () => {
  const context = new TraceContext()
  const root = context.beginTurn('s', 't', { 'turn.id': 't', 'session.id': 's' })
  for (let i = 0; i < 260; i++) {
    context.begin('tool.Read', { 'turn.id': 't', 'session.id': 's' }, root)
  }
  const batch = context.sealTurn('t')
  assert.equal(batch, undefined)
})

test('payloads reach the request body and are redacted', async () => {
  let body = null
  const runtime = new TracingRuntime({
    config: {
      enabled: true,
      baseUrl: 'http://localhost:3000',
      publicKey: 'pk',
      secretKey: 'sk',
      captureContent: true,
      knownSecrets: ['sk-lf-test']
    },
    sessionId: 's1',
    fetch: async (_url, init) => {
      body = JSON.parse(init.body)
      return new Response('{}', { status: 200 })
    }
  })
  const root = runtime.begin('agent.run', { 'turn.id': 't1', 'session.id': 's1' })
  runtime.setPayload(root, 'input', [{ role: 'user', content: 'hello sk-lf-test' }])
  runtime.setPayload(root, 'output', [{ role: 'assistant', content: 'hi there' }])
  runtime.end(root, 'success')
  runtime.sealTurn('t1')
  await new Promise((resolve) => setTimeout(resolve, 50))

  const span = body.resourceSpans[0].scopeSpans[0].spans[0]
  const keys = span.attributes.map((a) => a.key)
  assert.ok(keys.includes('langfuse.observation.input'))
  assert.ok(keys.includes('langfuse.observation.output'))
  const input = span.attributes.find((a) => a.key === 'langfuse.observation.input')
  assert.equal(input.value.stringValue, '[{"role":"user","content":"hello [redacted]"}]')
  assert.ok(!JSON.stringify(body).includes('sk-lf-test'), 'the secret must not reach the wire')
})

test('a closed runtime stops accepting new observations', async () => {
  let calls = 0
  const runtime = new TracingRuntime({
    config: { enabled: true, baseUrl: 'http://localhost:3000', publicKey: 'pk', secretKey: 'sk' },
    sessionId: 's1',
    fetch: async () => {
      calls++
      return new Response('{}', { status: 200 })
    }
  })
  await runtime.shutdown()
  const root = runtime.begin('agent.run', { 'turn.id': 't1', 'session.id': 's1' })
  assert.equal(root, undefined)
  runtime.sealTurn('t1')
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(calls, 0)
})

test('ending the root observation seals the batch without an explicit seal call', async () => {
  const seen = []
  const runtime = new TracingRuntime({
    config: { enabled: true, baseUrl: 'http://localhost:3000', publicKey: 'pk', secretKey: 'sk' },
    sessionId: 'session-1',
    fetch: async (url, init) => {
      seen.push({ url, init })
      return new Response('{}', { status: 200 })
    }
  })
  const root = runtime.begin('agent.run', {
    'turn.id': 'turn-1',
    'session.id': 'session-1',
    'langfuse.observation.type': 'agent'
  })
  const model = runtime.begin('model.request', { 'gen_ai.request.model': 'm' }, root)
  runtime.end(model, 'success')
  runtime.end(root, 'success')
  // 不调用 sealTurn：根收尾必须自动封存整批。
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(seen.length, 1)
  const body = JSON.parse(seen[0].init.body)
  const spans = body.resourceSpans[0].scopeSpans[0].spans
  assert.equal(spans.length, 2)
})

test('shutdown returns within its budget even when the platform hangs', async () => {
  const runtime = new TracingRuntime({
    config: { enabled: true, baseUrl: 'http://localhost:3000', publicKey: 'pk', secretKey: 'sk' },
    sessionId: 's1',
    fetch: async () => new Promise(() => {})
  })
  const root = runtime.begin('agent.run', { 'turn.id': 't1', 'session.id': 's1' })
  runtime.end(root, 'success')
  runtime.sealTurn('t1')
  const started = Date.now()
  await runtime.shutdown()
  const elapsed = Date.now() - started
  assert.ok(elapsed < 5000, `shutdown took ${elapsed}ms, must stay bounded`)
})
