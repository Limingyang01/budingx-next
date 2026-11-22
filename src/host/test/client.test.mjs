// SP008 T17：HostClient 的请求生命周期与全部错误分支（超时、关闭、fatal、错误透传）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HostClient, HostRequestError } from '../../tui/dist/host/client.js'

function fakeTransport() {
  const lineListeners = new Set()
  const closeListeners = new Set()
  const written = []
  let closed = false
  const close = (reason) => {
    if (closed) return
    closed = true
    for (const listener of closeListeners) listener(reason)
  }
  return {
    written,
    transport: {
      write(text) {
        written.push(text)
      },
      onLine(listener) {
        lineListeners.add(listener)
        return () => lineListeners.delete(listener)
      },
      onClose(listener) {
        closeListeners.add(listener)
        return () => closeListeners.delete(listener)
      },
      close
    },
    push(line) {
      for (const listener of lineListeners) listener(line)
    },
    closeFromServer(reason) {
      close(reason)
    },
    lastRequestId() {
      return JSON.parse(written.at(-1)).id
    }
  }
}

function helloResult(overrides = {}) {
  return {
    type: 'hello_ok',
    protocolVersion: 1,
    sessionId: 's1',
    workspaceId: 'w1',
    clientId: 'test-client',
    role: 'owner',
    scope: 'local',
    ...overrides
  }
}

async function connectedClient(t, options = {}) {
  const fake = fakeTransport()
  const client = new HostClient({ transport: fake.transport, clientId: 'test-client', ...options })
  const connecting = client.connect()
  fake.push(JSON.stringify({ id: fake.lastRequestId(), ok: true, result: helloResult() }))
  const hello = await connecting
  t.after(() => client.close())
  return { fake, client, hello }
}

test('connect 完成 hello 握手并记录角色，请求按 id 匹配响应', async (t) => {
  const { fake, client, hello } = await connectedClient(t)
  assert.equal(hello.type, 'hello_ok')
  assert.equal(client.role, 'owner')
  const pending = client.request('ping')
  const id = fake.lastRequestId()
  assert.equal(JSON.parse(fake.written.at(-1)).type, 'ping')
  fake.push(JSON.stringify({ id, ok: true, result: { pong: true } }))
  assert.deepEqual(await pending, { pong: true })
})

test('服务端错误响应原样透传错误码与文案', async (t) => {
  const { fake, client } = await connectedClient(t)
  const pending = client.request('submit', { text: 'hello' })
  fake.push(
    JSON.stringify({
      id: fake.lastRequestId(),
      ok: false,
      error: { code: 'HOST_SESSION_003', message: 'session is owned by another writer; this connection is read-only' }
    })
  )
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof HostRequestError)
    assert.equal(error.code, 'HOST_SESSION_003')
    assert.equal(error.message, 'session is owned by another writer; this connection is read-only')
    return true
  })
})

test('请求超时返回 HOST_STATE_006 并携带请求类型', async (t) => {
  const { client } = await connectedClient(t, { requestTimeoutMs: 30 })
  // 客户端超时计时器是 unref 的；fake transport 没有真实 I/O 句柄，
  // 用一个保活计时器维持事件循环，模拟真实传输的存活状态。
  const keepAlive = setTimeout(() => {}, 500)
  try {
    await assert.rejects(client.request('describe'), (error) => {
      assert.ok(error instanceof HostRequestError)
      assert.equal(error.code, 'HOST_STATE_006')
      assert.equal(error.message, 'request timed out: describe')
      return true
    })
  } finally {
    clearTimeout(keepAlive)
  }
})

test('关闭后的客户端拒绝新请求，onClose 立即回调', async (t) => {
  const fake = fakeTransport()
  const client = new HostClient({ transport: fake.transport })
  client.close('done')
  assert.equal(client.isClosed, true)
  await assert.rejects(client.request('ping'), (error) => {
    assert.equal(error.code, 'HOST_STATE_006')
    assert.equal(error.message, 'client is closed')
    return true
  })
  const reasons = []
  client.onClose((reason) => reasons.push(reason))
  await Promise.resolve()
  assert.equal(reasons.length, 1)
})

test('fatal 帧以同一错误拒绝全部挂起请求', async (t) => {
  const { fake, client } = await connectedClient(t)
  const first = client.request('describe')
  const second = client.request('history')
  fake.push(JSON.stringify({ type: 'fatal', code: 'HOST_PROTOCOL_005', message: 'frame exceeds 1048576 bytes' }))
  for (const pending of [first, second]) {
    await assert.rejects(pending, (error) => {
      assert.equal(error.code, 'HOST_PROTOCOL_005')
      assert.equal(error.message, 'frame exceeds 1048576 bytes')
      return true
    })
  }
})

test('传输断开拒绝挂起请求并触发 onClose，随后请求被拒绝', async (t) => {
  const { fake, client } = await connectedClient(t)
  const pending = client.request('describe')
  const closes = []
  client.onClose((reason) => closes.push(reason))
  fake.closeFromServer('server shutdown')
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'HOST_STATE_006')
    assert.equal(error.message, 'client closed')
    return true
  })
  assert.deepEqual(closes, ['server shutdown'])
  assert.equal(client.isClosed, true)
  await assert.rejects(client.request('ping'), (error) => error.message === 'client is closed')
})

test('event 与 role_changed 帧分派给监听器并更新角色', async (t) => {
  const { fake, client } = await connectedClient(t)
  const events = []
  const roles = []
  client.onEvent((event, seq) => events.push({ event, seq }))
  client.onRoleChanged((role) => roles.push(role))
  fake.push(JSON.stringify({ type: 'event', seq: 1, event: { type: 'status', state: 'streaming' } }))
  fake.push(JSON.stringify({ type: 'event', seq: 2, event: { type: 'text_delta', turnId: 't', messageId: 'm', text: '你好' } }))
  fake.push(JSON.stringify({ type: 'role_changed', role: 'observer' }))
  assert.equal(events.length, 2)
  assert.deepEqual(events.map((item) => item.seq), [1, 2])
  assert.equal(events[1].event.text, '你好')
  assert.deepEqual(roles, ['observer'])
  assert.equal(client.role, 'observer')
})

test('畸形与非对象帧被忽略，不影响后续请求', async (t) => {
  const { fake, client } = await connectedClient(t)
  fake.push('this is not json')
  fake.push('null')
  fake.push('42')
  fake.push(JSON.stringify({ id: 'unknown-id', ok: true, result: { pong: true } }))
  const pending = client.request('ping')
  fake.push(JSON.stringify({ id: fake.lastRequestId(), ok: true, result: { pong: true } }))
  assert.deepEqual(await pending, { pong: true })
})
