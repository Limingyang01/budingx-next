// SP008 T11：活动会话归属（SO-01…SO-04）与共享历史边界，真实 serve 子进程。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { startFixtureServer, spawnServe } from './helpers/host-process.mjs'

function lockPath(home, sessionId) {
  return join(home, '.budingx', 'sessions', sessionId, 'writer.lock')
}

function waitForEvent(client, predicate, label, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error('timed out waiting for ' + label))
    }, timeoutMs)
    const off = client.onEvent((event) => {
      if (!predicate(event)) return
      clearTimeout(timer)
      off()
      resolve(event)
    })
  })
}

function waitForRole(client, role, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error('timed out waiting for role ' + role))
    }, timeoutMs)
    const off = client.onRoleChanged((next) => {
      if (next !== role) return
      clearTimeout(timer)
      off()
      resolve()
    })
  })
}

async function expectReject(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code)
    return true
  })
}

test('SO-01/SO-02: a second process observes the same session and cannot write', async (t) => {
  const fixture = await startFixtureServer(t)
  const sessionId = 'so-shared-history'
  const owner = spawnServe(t, {
    args: ['--transport', 'stdio', '--session', sessionId],
    baseUrl: fixture.baseUrl
  })
  const { client: ownerClient, hello: ownerHello } = await owner.connect()
  assert.equal(ownerHello.role, 'owner')
  assert.equal(ownerHello.scope, 'local')
  assert.ok(existsSync(lockPath(owner.home, sessionId)))

  const observer = spawnServe(t, {
    home: owner.home,
    args: ['--transport', 'stdio', '--session', sessionId],
    baseUrl: fixture.baseUrl
  })
  const { client: observerClient, hello: observerHello } = await observer.connect()
  assert.equal(observerHello.role, 'observer')
  assert.equal(observerHello.sessionId, sessionId)
  assert.match(observer.stderr, /owned by another process/)

  await expectReject(observerClient.request('submit', { text: 'write from observer' }), 'HOST_SESSION_003')
  await expectReject(observerClient.request('interrupt'), 'HOST_SESSION_003')
  await expectReject(
    observerClient.request('set_permission_mode', { mode: 'full_access' }),
    'HOST_SESSION_003'
  )

  const description = await observerClient.request('describe')
  assert.equal(description.role, 'observer')
  assert.equal(description.scope, 'local')
  assert.equal(description.sessionId, sessionId)

  const finalized = waitForEvent(ownerClient, (event) => event.type === 'turn_finalized', 'turn_finalized')
  const accepted = await ownerClient.request('submit', { text: 'owner turn' })
  assert.deepEqual(accepted, { accepted: true })
  const event = await finalized
  assert.equal(event.outcome, 'completed')

  await ownerClient.request('shutdown')
  assert.deepEqual(await owner.closed, { code: 0, signal: null })
  assert.equal(existsSync(lockPath(owner.home, sessionId)), false)
  observerClient.close()
})

test('SO-03: process takeover refuses a live owner and succeeds after the owner crashes', async (t) => {
  const fixture = await startFixtureServer(t)
  const sessionId = 'so-crash-recovery'
  const first = spawnServe(t, {
    args: ['--transport', 'stdio', '--session', sessionId],
    baseUrl: fixture.baseUrl
  })
  const { client: firstClient, hello } = await first.connect()
  assert.equal(hello.role, 'owner')
  assert.deepEqual(await firstClient.request('ping'), { pong: true })

  const refused = spawnServe(t, {
    home: first.home,
    args: ['--transport', 'stdio', '--session', sessionId, '--takeover'],
    baseUrl: fixture.baseUrl
  })
  assert.deepEqual(await refused.closed, { code: 1, signal: null })
  assert.match(refused.stderr, /another process is still writing/)
  assert.deepEqual(await firstClient.request('ping'), { pong: true })
  assert.ok(existsSync(lockPath(first.home, sessionId)))

  first.child.kill('SIGKILL')
  await first.closed
  assert.ok(existsSync(lockPath(first.home, sessionId)))

  const second = spawnServe(t, {
    home: first.home,
    args: ['--transport', 'stdio', '--session', sessionId, '--takeover'],
    baseUrl: fixture.baseUrl
  })
  const { client: secondClient, hello: secondHello } = await second.connect()
  assert.equal(secondHello.role, 'owner')
  const finalized = waitForEvent(secondClient, (event) => event.type === 'turn_finalized', 'turn_finalized')
  await secondClient.request('submit', { text: 'after takeover' })
  const event = await finalized
  assert.equal(event.outcome, 'completed')

  await secondClient.request('shutdown')
  assert.deepEqual(await second.closed, { code: 0, signal: null })
  assert.equal(existsSync(lockPath(first.home, sessionId)), false)
})

test('SO-04/TB-06: same-process takeover demotes the old owner and observers may disconnect safely', async (t) => {
  const fixture = await startFixtureServer(t)
  const sessionId = 'so-role-handoff'
  const host = spawnServe(t, {
    args: ['--transport', 'ws', '--session', sessionId, '--token', 'test-token'],
    baseUrl: fixture.baseUrl
  })
  const { client: first } = await host.connect({ clientId: 'first' })
  const { client: second, hello } = await host.connect({ clientId: 'second' })
  assert.equal(hello.role, 'observer')

  const demoted = waitForRole(first, 'observer')
  assert.deepEqual(await second.request('takeover'), { role: 'owner' })
  await demoted
  assert.equal(first.role, 'observer')
  await expectReject(first.request('submit', { text: 'old owner' }), 'HOST_SESSION_003')

  const finalized = waitForEvent(second, (event) => event.type === 'turn_finalized', 'turn_finalized')
  assert.deepEqual(await second.request('submit', { text: 'new owner' }), { accepted: true })
  assert.equal((await finalized).outcome, 'completed')

  // An observer leaving must not disturb the owner round or the writer lock.
  first.close()
  assert.ok(existsSync(lockPath(host.home, sessionId)))
  assert.deepEqual(await second.request('ping'), { pong: true })
  assert.equal((await second.request('describe')).role, 'owner')

  await second.request('shutdown')
  assert.deepEqual(await host.closed, { code: 0, signal: null })
  assert.equal(existsSync(lockPath(host.home, sessionId)), false)
})
