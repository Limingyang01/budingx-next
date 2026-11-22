// SP008 TB-01/04/05/07：真实进程验证 WebSocket 宿主鉴权、角色、事件与限制。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { HostClient, HostRequestError } from '../dist/host/client.js'
import { WsConnectError, connectWebSocket } from '../dist/host/transport/ws-client.js'

const cli = fileURLToPath(new URL('../dist/tui/cli.js', import.meta.url))
const cwd = process.cwd()
const FRAME_LIMIT = 1024 * 1024

async function fixtureServer(t) {
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) {
      // drain
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(
      'data: {"choices":[{"delta":{"content":"pong"}}]}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
        'data: [DONE]\n\n'
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  return 'http://127.0.0.1:' + server.address().port + '/v1'
}

function startServe(t, baseUrl, args) {
  const home = mkdtempSync(join(tmpdir(), 'budingx-host-ws-'))
  const child = spawn(process.execPath, [cli, 'serve', ...args, '--home', home], {
    cwd,
    env: {
      ...process.env,
      BUDINGX_API_KEY: 'fixture-key',
      BUDINGX_MODEL: 'fixture',
      BUDINGX_BASE_URL: baseUrl,
      HOME: home,
      USERPROFILE: home
    },
    windowsHide: true
  })
  t.after(() => child.kill())
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (data) => (stdout += data))
  child.stderr.on('data', (data) => (stderr += data))
  const closed = new Promise((resolveClose) => child.on('close', (code) => resolveClose(code)))
  const ready = new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error('serve did not start: ' + stderr)), 15_000)
    const check = () => {
      const match = /listening on (ws:\/\/\S+)/.exec(stderr)
      if (match) {
        clearTimeout(timer)
        resolveReady(match[1])
      }
    }
    child.stderr.on('data', check)
    check()
  })
  return {
    home,
    child,
    closed,
    ready,
    get stdout() {
      return stdout
    },
    get stderr() {
      return stderr
    }
  }
}

async function connect(url, token, options = {}) {
  const transport = await connectWebSocket({ url, token, timeoutMs: 5000 })
  const client = new HostClient({ transport, requestTimeoutMs: options.requestTimeoutMs ?? 10_000 })
  const hello = await client.connect()
  return { client, hello }
}

test('WebSocket 宿主：401 鉴权、owner/observer、事件与关闭', async (t) => {
  const baseUrl = await fixtureServer(t)
  const serve = startServe(t, baseUrl, [
    '--transport', 'ws',
    '--host', '127.0.0.1',
    '--port', '0',
    '--token', 'secret-token-42',
    '--session', 'ws-session'
  ])
  const url = await serve.ready
  assert.match(url, /^ws:\/\/127\.0\.0\.1:\d+$/)

  await assert.rejects(connectWebSocket({ url, token: '' }), (error) => {
    assert.ok(error instanceof WsConnectError)
    assert.equal(error.statusCode, 401)
    return true
  })
  await assert.rejects(connectWebSocket({ url, token: 'wrong-token' }), (error) => {
    assert.ok(error instanceof WsConnectError)
    assert.equal(error.statusCode, 401)
    return true
  })

  const owner = await connect(url, 'secret-token-42', { requestTimeoutMs: 20_000 })
  assert.equal(owner.hello.role, 'owner')
  assert.equal(owner.hello.scope, 'local')
  assert.equal(owner.hello.sessionId, 'ws-session')
  assert.equal(existsSync(join(serve.home, '.budingx', 'sessions', 'ws-session', 'writer.lock')), true)

  const observer = await connect(url, 'secret-token-42')
  assert.equal(observer.hello.role, 'observer')
  await assert.rejects(observer.client.request('submit', { text: 'nope' }), (error) => {
    assert.ok(error instanceof HostRequestError)
    assert.equal(error.code, 'HOST_SESSION_003')
    return true
  })

  const finalized = new Promise((resolveEvent) => {
    owner.client.onEvent((event) => {
      if (event.type === 'turn_finalized') resolveEvent(event)
    })
  })
  await owner.client.request('submit', { text: 'hello ws' })
  const event = await finalized
  assert.equal(event.outcome, 'completed')

  const history = await owner.client.request('history', { limit: 10 })
  assert.ok(history.messages.length >= 2)
  const hello = await owner.client.request('describe')
  assert.equal(hello.sessionId, 'ws-session')
  assert.equal(hello.permissionMode, 'workspace_edit')

  assert.equal(serve.stdout, '')
  assert.equal(serve.stderr.includes('secret-token-42'), false)
  assert.equal(serve.stdout.includes('secret-token-42'), false)

  const stop = await owner.client.request('shutdown')
  assert.deepEqual(stop, { stopping: true })
  observer.client.close()
  const shutdown = await serve.closed
  assert.equal(shutdown, 0)
  assert.equal(existsSync(join(serve.home, '.budingx', 'sessions', 'ws-session', 'writer.lock')), false)
})

test('WebSocket 宿主：拒绝非回环绑定', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-host-ws-bind-'))
  const child = spawn(
    process.execPath,
    [cli, 'serve', '--transport', 'ws', '--host', '0.0.0.0', '--port', '0', '--token', 'x', '--home', home],
    {
      cwd,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      windowsHide: true
    }
  )
  let stderr = ''
  child.stderr.on('data', (data) => (stderr += data))
  const code = await new Promise((resolveClose) => child.on('close', resolveClose))
  assert.equal(code, 2)
  assert.match(stderr, /HOST_AUTH_004/)
  assert.match(stderr, /loopback/)
})

test('WebSocket 宿主：超过 1 MiB 的帧先收到 fatal 再断开', async (t) => {
  const baseUrl = await fixtureServer(t)
  const serve = startServe(t, baseUrl, [
    '--transport', 'ws',
    '--host', '127.0.0.1',
    '--port', '0',
    '--token', 'size-token',
    '--session', 'ws-large'
  ])
  const url = await serve.ready
  const { client } = await connect(url, 'size-token')
  const failure = assert.rejects(
    client.request('submit', { text: 'x'.repeat(FRAME_LIMIT) }),
    (error) => {
      assert.ok(error instanceof HostRequestError)
      assert.equal(error.code, 'HOST_PROTOCOL_005')
      return true
    }
  )
  await failure
  await new Promise((resolveClosed) => {
    const timer = setTimeout(resolveClosed, 2000)
    client.onClose(() => {
      clearTimeout(timer)
      resolveClosed()
    })
  })
  serve.child.kill()
})