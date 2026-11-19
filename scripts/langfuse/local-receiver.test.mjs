// SP005：本机 Langfuse 兼容接收端的协议测试。
// 覆盖 OTLP 归一化、鉴权拒绝与 v2 observations 查询形状。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toObservations, createReceiver, attributesToObject } from './local-receiver.mjs'

/** 构造一个最小 OTLP 请求体。 */
function otlpBody(spans, resourceAttributes = [{ key: 'service.name', value: { stringValue: 'budingx-tui' } }]) {
  return {
    resourceSpans: [
      {
        resource: { attributes: resourceAttributes },
        scopeSpans: [{ scope: { name: 'budingx-agent' }, spans }]
      }
    ]
  }
}

test('attributesToObject reads typed OTLP values', () => {
  const result = attributesToObject([
    { key: 'a', value: { stringValue: 'x' } },
    { key: 'b', value: { intValue: 3 } },
    { key: 'c', value: { boolValue: true } }
  ])
  assert.deepEqual(result, { a: 'x', b: 3, c: true })
})

test('toObservations normalizes spans and preserves parent links', () => {
  const body = otlpBody([
    {
      traceId: 't1',
      spanId: 's1',
      name: 'agent.run',
      startTimeUnixNano: '1',
      endTimeUnixNano: '2',
      attributes: [
        { key: 'session.id', value: { stringValue: 'sess-1' } },
        { key: 'langfuse.observation.metadata.outcome', value: { stringValue: 'success' } }
      ]
    },
    {
      traceId: 't1',
      spanId: 's2',
      parentSpanId: 's1',
      name: 'tool.Read',
      startTimeUnixNano: '3',
      endTimeUnixNano: '4',
      attributes: [
        { key: 'session.id', value: { stringValue: 'sess-1' } },
        { key: 'langfuse.observation.level', value: { stringValue: 'ERROR' } }
      ]
    }
  ])
  const observations = toObservations(body)
  assert.equal(observations.length, 2)
  assert.equal(observations[0].parentObservationId, null)
  assert.equal(observations[1].parentObservationId, 's1')
  assert.equal(observations[0].sessionId, 'sess-1')
  assert.equal(observations[0].metadata.outcome, 'success')
  assert.equal(observations[1].level, 'ERROR')
})

test('receiver rejects unauthenticated ingestion and serves observations', async () => {
  const { server, store } = createReceiver({
    keys: { publicKey: 'pk-test', secretKey: 'sk-test' }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  const auth = 'Basic ' + Buffer.from('pk-test:sk-test').toString('base64')
  try {
    const unauth = await fetch(`${base}/api/public/otel/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(otlpBody([]))
    })
    assert.equal(unauth.status, 401)

    const health = await fetch(`${base}/api/public/health`)
    assert.equal(health.status, 200)
    assert.equal((await health.json()).status, 'OK')

    const posted = await fetch(`${base}/api/public/otel/v1/traces`, {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify(
        otlpBody([
          {
            traceId: 'trace-x',
            spanId: 'span-x',
            name: 'agent.run',
            startTimeUnixNano: '10',
            endTimeUnixNano: '20',
            attributes: [
              { key: 'session.id', value: { stringValue: 'sess-x' } },
              { key: 'langfuse.observation.metadata.outcome', value: { stringValue: 'success' } }
            ]
          }
        ])
      )
    })
    assert.equal(posted.status, 200)
    assert.equal(store.observations.length, 1)

    const queried = await fetch(
      `${base}/api/public/v2/observations?traceId=trace-x&fields=core,basic,io`,
      { headers: { authorization: auth } }
    )
    assert.equal(queried.status, 200)
    const body = await queried.json()
    assert.equal(body.data.length, 1)
    assert.equal(body.data[0].name, 'agent.run')
    assert.equal(body.data[0].sessionId, 'sess-x')
    assert.equal(body.data[0].metadata.outcome, 'success')
    assert.equal(body.meta.totalItems, 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('receiver serves the read-only viewer page and the open query endpoint', async () => {
  const { server } = createReceiver({ keys: { publicKey: 'pk-ui', secretKey: 'sk-ui' } })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  try {
    const page = await fetch(base + '/')
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-type'), /text\/html/)
    const html = await page.text()
    assert.match(html, /budingX/)
    assert.match(html, /ui\/observations/)
    // 页面内联脚本必须能被解析：字符串转义出错时浏览器会静默不执行（曾发生）。
    const inline = /<script>([\s\S]*?)<\/script>/.exec(html)
    assert.ok(inline, '查看页必须内联脚本')
    assert.doesNotThrow(() => new Function(inline[1]))

    const data = await fetch(base + '/ui/observations?limit=5')
    assert.equal(data.status, 200)
    const body = await data.json()
    assert.deepEqual(body.data, [])
    assert.equal(body.meta.limit, 5)
    assert.equal(body.meta.totalItems, 0)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
