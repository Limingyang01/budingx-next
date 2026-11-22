// SP008 T11：TB-01/02/03/04/06 三传输同构、事件顺序、审批往返与畸形帧韧性。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { HostServer } from '../dist/host/server.js'
import { SessionOwnershipRole, claimSessionOwnership } from '../dist/host/ownership.js'
import { SessionStore } from '../dist/storage/session-store.js'
import { HostClient } from '../dist/host/client.js'
import { connectInProcess } from '../dist/host/transport/in-process.js'
import { startFixtureServer, spawnServe } from './helpers/host-process.mjs'

function workspaceId() {
  return createHash('sha256').update(resolve(process.cwd())).digest('hex')
}

function waitForEvent(client, predicate, label, timeoutMs = 20_000) {
  return new Promise((resolveEvent, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error('timed out waiting for ' + label))
    }, timeoutMs)
    const off = client.onEvent((event) => {
      if (!predicate(event)) return
      clearTimeout(timer)
      off()
      resolveEvent(event)
    })
  })
}

function eventLog(client) {
  const events = []
  client.onEvent((event, seq) => events.push({ type: event.type, seq, event }))
  return events
}

async function waitForRecorded(recorded, predicate, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = recorded.find(predicate)
    if (found !== undefined) return found
    if (Date.now() > deadline) throw new Error('timed out waiting for ' + label)
    await new Promise((resolveWait) => setTimeout(resolveWait, 20))
  }
}

function responseFor(recorded, id) {
  return recorded
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return undefined
      }
    })
    .find((frame) => frame && frame.id === id && typeof frame.ok === 'boolean')
}

test('TB-01/TB-06: in-process, stdio and WS expose the same identity fields and leak no key', async (t) => {
  const fixture = await startFixtureServer(t)
  const home = mkdtempSync(join(tmpdir(), 'budingx-sp008-parity-'))
  const sessionId = 'tb-transport-parity'

  // In-process server: same protocol frames, no child process.
  const ownership = new SessionOwnershipRole(claimSessionOwnership({ sessionId: 'tb-in-process', home }))
  const server = new HostServer({
    sessionId: 'tb-in-process',
    workspaceId: 'workspace-in-process',
    ownership,
    sessionStore: new SessionStore({ home, workspaceRoot: process.cwd() })
  })
  t.after(() => server.shutdown())
  const inProcessRaw = connectInProcess(server)
  const inProcessLines = []
  inProcessRaw.onLine((line) => inProcessLines.push(line))
  const inProcessClient = new HostClient({ transport: inProcessRaw })
  const inProcessHello = await inProcessClient.connect()

  const stdio = spawnServe(t, {
    home,
    args: ['--transport', 'stdio', '--session', sessionId],
    baseUrl: fixture.baseUrl
  })
  const { client: stdioClient, hello: stdioHello } = await stdio.connect()

  const ws = spawnServe(t, {
    home,
    args: ['--transport', 'ws', '--session', sessionId, '--token', 'test-token'],
    baseUrl: fixture.baseUrl
  })
  const { client: wsClient, hello: wsHello } = await ws.connect({ token: 'test-token' })

  for (const hello of [inProcessHello, stdioHello, wsHello]) {
    assert.equal(hello.type, 'hello_ok')
    assert.equal(hello.protocolVersion, 1)
    assert.equal(hello.scope, 'local')
    assert.equal(typeof hello.clientId, 'string')
    assert.equal(typeof hello.sessionId, 'string')
    assert.equal(typeof hello.workspaceId, 'string')
  }
  assert.equal(stdioHello.role, 'owner')
  assert.equal(wsHello.role, 'observer')
  assert.equal(stdioHello.sessionId, wsHello.sessionId)
  assert.equal(stdioHello.workspaceId, workspaceId())
  assert.equal(wsHello.workspaceId, workspaceId())

  const allBytes = JSON.stringify([...stdio.recorded, ...ws.recorded, ...inProcessLines])
    + stdio.stderr
    + ws.stderr
  assert.doesNotMatch(allBytes, /fixture-key/)
  assert.doesNotMatch(allBytes, /test-token/)
  assert.doesNotMatch(allBytes, /credentials\.json/)
  assert.doesNotMatch(ws.stderr, /test-token/)

  await stdioClient.request('shutdown')
  assert.deepEqual(await stdio.closed, { code: 0, signal: null })
  inProcessClient.close()
  wsClient.close()
})

test('TB-04: malformed, unknown, duplicate and oversized frames do not break the stdio host', async (t) => {
  const fixture = await startFixtureServer(t)
  const host = spawnServe(t, {
    args: ['--transport', 'stdio', '--session', 'tb-frames'],
    baseUrl: fixture.baseUrl
  })
  const { client, transport } = await host.connect()

  transport.write('{"id":"m1","type":"describe"\n')
  const malformed = await waitForRecorded(
    host.recorded,
    (line) => {
      const frame = responseFor([line], '')
      return frame !== undefined && frame.error?.code === 'HOST_PROTOCOL_002'
    },
    'malformed reply'
  )
  assert.equal(JSON.parse(malformed).error.code, 'HOST_PROTOCOL_002')

  transport.write(JSON.stringify({ id: 'm2', type: 'not_a_request' }) + '\n')
  const unknown = await waitForRecorded(host.recorded, (line) => responseFor([line], 'm2') !== undefined, 'unknown reply')
  assert.equal(JSON.parse(unknown).error.code, 'HOST_STATE_006')

  assert.deepEqual(await client.request('ping'), { pong: true })
  transport.write(JSON.stringify({ id: 'dup-1', type: 'ping' }) + '\n')
  const firstPing = await waitForRecorded(
    host.recorded,
    (line) => responseFor([line], 'dup-1') !== undefined,
    'first dup-1 reply'
  )
  assert.deepEqual(JSON.parse(firstPing).result, { pong: true })
  transport.write(JSON.stringify({ id: 'dup-1', type: 'ping' }) + '\n')
  const duplicate = await waitForRecorded(
    host.recorded,
    (line) => {
      try {
        return JSON.parse(line).error?.code === 'HOST_PROTOCOL_002'
      } catch {
        return false
      }
    },
    'duplicate reply'
  )
  assert.equal(JSON.parse(duplicate).error.code, 'HOST_PROTOCOL_002')

  transport.write(JSON.stringify({ id: 'big', type: 'submit', text: 'x'.repeat(1024 * 1024 + 64) }) + '\n')
  const oversized = await waitForRecorded(
    host.recorded,
    (line) => responseFor([line], 'big') !== undefined,
    'oversized reply',
    30_000
  )
  assert.equal(JSON.parse(oversized).error.code, 'HOST_PROTOCOL_005')

  assert.deepEqual(await client.request('ping'), { pong: true })
  const finalized = waitForEvent(client, (event) => event.type === 'turn_finalized', 'turn_finalized')
  await client.request('submit', { text: 'still alive' })
  assert.equal((await finalized).outcome, 'completed')

  await client.request('shutdown')
  assert.deepEqual(await host.closed, { code: 0, signal: null })
})

test('TB-02/SO-02: two WS clients share one ordered event stream; observer disconnect is isolated', async (t) => {
  const fixture = await startFixtureServer(t)
  const host = spawnServe(t, {
    args: ['--transport', 'ws', '--session', 'tb-event-stream'],
    baseUrl: fixture.baseUrl
  })
  const { client: owner } = await host.connect({ clientId: 'owner' })
  const { client: observer } = await host.connect({ clientId: 'observer' })
  const ownerEvents = eventLog(owner)
  const observerEvents = eventLog(observer)

  assert.deepEqual(await owner.request('submit', { text: 'fan out to both' }), { accepted: true })
  const ownerFinal = await waitForEvent(owner, (event) => event.type === 'turn_finalized', 'owner finalized')
  const observerFinal = await waitForEvent(observer, (event) => event.type === 'turn_finalized', 'observer finalized')
  assert.equal(observerFinal.turnId, ownerFinal.turnId)
  assert.equal(ownerFinal.outcome, 'completed')

  const ownerTypes = ownerEvents.map((entry) => entry.type)
  const observerTypes = observerEvents.map((entry) => entry.type)
  assert.deepEqual(observerTypes, ownerTypes)
  const seqs = ownerEvents.map((entry) => entry.seq)
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b))
  assert.equal(new Set(seqs).size, seqs.length)
  assert.deepEqual(
    observerEvents.map((entry) => entry.seq),
    seqs
  )

  observer.close()
  assert.deepEqual(await owner.request('ping'), { pong: true })
  assert.equal((await owner.request('describe')).role, 'owner')
  await owner.request('shutdown')
  assert.deepEqual(await host.closed, { code: 0, signal: null })
})

test('TB-03: an approval round-trips over WS and an allowed tool turn completes', async (t) => {
  const fixture = await startFixtureServer(t, 'bash')
  const host = spawnServe(t, {
    args: ['--transport', 'ws', '--session', 'tb-approval'],
    baseUrl: fixture.baseUrl
  })
  const { client } = await host.connect({ token: 'test-token' })
  const events = []
  client.onEvent((event) => events.push(event))
  const approval = waitForEvent(client, (event) => event.type === 'approval_requested', 'approval_requested')
  await client.request('submit', { text: 'run echo' })
  const requested = await approval
  assert.equal(requested.name, 'Bash')
  assert.equal(typeof requested.requestId, 'string')
  assert.deepEqual(await client.request('approval', { requestId: requested.requestId, outcome: 'allow' }), {
    accepted: true
  })
  const finalized = await waitForEvent(client, (event) => event.type === 'turn_finalized', 'turn_finalized')
  assert.equal(finalized.outcome, 'completed')
  const resolved = events.find((event) => event.type === 'approval_resolved')
  assert.equal(resolved.outcome, 'allow')
  assert.equal(resolved.via, 'user')
  assert.ok(events.some((event) => event.type === 'tool_result' && event.isError === false))
  await client.request('shutdown')
  assert.deepEqual(await host.closed, { code: 0, signal: null })
})
