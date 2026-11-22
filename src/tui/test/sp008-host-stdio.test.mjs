// SP008 TB-01/02/07：真实进程验证 stdio 宿主、角色与 EOF 释放。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const cli = fileURLToPath(new URL('../dist/tui/cli.js', import.meta.url))
const cwd = process.cwd()

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

function start(home, baseUrl, args) {
  const child = spawn(process.execPath, [cli, 'serve', ...args], {
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
  const lines = []
  let raw = ''
  let stderr = ''
  const waiters = new Set()
  const flush = () => {
    const parts = raw.split('\n')
    raw = parts.pop() ?? ''
    for (const line of parts) {
      if (!line.trim()) continue
      let parsed
      try {
        parsed = JSON.parse(line)
      } catch {
        parsed = { __invalid: line }
      }
      lines.push(parsed)
      for (const waiter of waiters) waiter()
    }
  }
  child.stdout.on('data', (data) => {
    raw += data
    flush()
  })
  child.stderr.on('data', (data) => {
    stderr += data
  })
  const closed = new Promise((resolveClose) => child.on('close', (code) => resolveClose(code)))
  return {
    child,
    lines,
    get stderr() {
      return stderr
    },
    send(frame) {
      child.stdin.write(JSON.stringify(frame) + '\n')
    },
    end() {
      child.stdin.end()
    },
    waitFor(predicate, timeoutMs = 10_000) {
      return new Promise((resolveLine, rejectLine) => {
        const find = () => lines.find(predicate)
        const existing = find()
        if (existing) return resolveLine(existing)
        const timer = setTimeout(() => {
          waiters.delete(check)
          rejectLine(new Error('timed out; lines=' + JSON.stringify(lines) + ' stderr=' + stderr))
        }, timeoutMs)
        const check = () => {
          const found = find()
          if (found) {
            clearTimeout(timer)
            waiters.delete(check)
            resolveLine(found)
          }
        }
        waiters.add(check)
      })
    },
    closed
  }
}

function lockPath(home, sessionId) {
  return join(home, '.budingx', 'sessions', sessionId, 'writer.lock')
}

test('stdio 宿主：owner/observer 角色、写拒绝、历史与 EOF 释放', async (t) => {
  const baseUrl = await fixtureServer(t)
  const home = mkdtempSync(join(tmpdir(), 'budingx-host-stdio-'))
  const sessionId = 'stdio-session'
  const owner = start(home, baseUrl, ['--transport', 'stdio', '--session', sessionId, '--home', home])
  t.after(() => owner.child.kill())

  owner.send({ id: 'h1', type: 'hello', version: 1, clientId: 'stdio-owner' })
  const hello = await owner.waitFor((line) => line.id === 'h1')
  assert.equal(hello.ok, true)
  assert.equal(hello.result.type, 'hello_ok')
  assert.equal(hello.result.protocolVersion, 1)
  assert.equal(hello.result.scope, 'local')
  assert.equal(hello.result.role, 'owner')
  assert.equal(hello.result.sessionId, sessionId)
  assert.equal(existsSync(lockPath(home, sessionId)), true)

  const observer = start(home, baseUrl, ['--transport', 'stdio', '--session', sessionId, '--home', home])
  t.after(() => observer.child.kill())
  observer.send({ id: 'h2', type: 'hello', version: 1 })
  const hello2 = await observer.waitFor((line) => line.id === 'h2')
  assert.equal(hello2.result.role, 'observer')

  observer.send({ id: 'w', type: 'submit', text: 'nope' })
  const denied = await observer.waitFor((line) => line.id === 'w')
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'HOST_SESSION_003')

  owner.send({ id: 's', type: 'submit', text: 'hello host' })
  const accepted = await owner.waitFor((line) => line.id === 's')
  assert.deepEqual(accepted.result, { accepted: true })
  const finalized = await owner.waitFor(
    (line) => line.type === 'event' && line.event.type === 'turn_finalized'
  )
  assert.equal(finalized.event.outcome, 'completed')
  assert.ok(finalized.seq >= 1)

  owner.send({ id: 'hist', type: 'history' })
  const history = await owner.waitFor((line) => line.id === 'hist')
  assert.ok(history.result.messages.length >= 2)

  observer.send({ id: 'h2-hist', type: 'history' })
  const observerHistory = await observer.waitFor((line) => line.id === 'h2-hist')
  assert.ok(observerHistory.result.messages.length >= 1)

  observer.end()
  assert.equal(await observer.closed, 0)
  assert.equal(existsSync(lockPath(home, sessionId)), true, 'observer 退出不得释放 owner 的锁')

  owner.end()
  assert.equal(await owner.closed, 0)
  assert.equal(existsSync(lockPath(home, sessionId)), false)
  assert.match(owner.stderr, /ready on stdio/)
  for (const line of owner.lines) assert.equal(line.__invalid, undefined)
})

test('stdio 宿主：usage 错误与 ws 缺令牌的退出码', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-host-usage-'))
  const badTransport = start(home, 'http://127.0.0.1:1/v1', ['--transport', 'carrier-pigeon'])
  assert.equal(await badTransport.closed, 2)
  const wsNoToken = start(home, 'http://127.0.0.1:1/v1', [
    '--transport', 'ws',
    '--session', 'ws-session',
    '--home', home
  ])
  assert.equal(await wsNoToken.closed, 2)
})
