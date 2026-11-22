// SP008 T17：owner 打断进行中回合与 history.limit 截断语义的真实进程端到端。
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { startFixtureServer, spawnServe } from './helpers/host-process.mjs'

const lockPath = (home, sessionId) => join(home, '.budingx', 'sessions', sessionId, 'writer.lock')

async function waitFor(read, predicate, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    const result = predicate(value)
    if (result) return result
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 20))
  }
  throw new Error('condition not met: ' + label)
}

async function interruptFlow(t, transportName) {
  const fixture = await startFixtureServer(t, 'slow')
  const sessionId = 'interrupt-' + transportName
  const serve = spawnServe(t, {
    args: ['--transport', transportName, '--session', sessionId],
    baseUrl: fixture.baseUrl
  })
  const { client } = await serve.connect()
  const events = []
  client.onEvent((event) => events.push(event))

  // 空闲时打断：没有活动回合，interrupted 必须为 false。
  assert.deepEqual(await client.request('interrupt'), { interrupted: false })

  const accepted = await client.request('submit', { text: 'long task' })
  assert.deepEqual(accepted, { accepted: true })
  await waitFor(() => events, (list) => list.some((event) => event.type === 'text_delta'), 'turn streaming')

  // 回合进行中打断：interrupted 为 true，回合以 cancelled 收尾。
  assert.deepEqual(await client.request('interrupt'), { interrupted: true })
  const finalized = await waitFor(
    () => events,
    (list) => list.find((event) => event.type === 'turn_finalized'),
    'turn finalized'
  )
  assert.equal(finalized.outcome, 'cancelled')

  // 回合结束后再次打断：返回 false，会话回到 idle。
  assert.deepEqual(await client.request('interrupt'), { interrupted: false })
  const description = await client.request('describe')
  assert.equal(description.state, 'idle')

  await client.request('shutdown')
  const { code } = await serve.closed
  assert.equal(code, 0)
  assert.equal(existsSync(lockPath(serve.home, sessionId)), false)
}

test('stdio：owner 打断进行中回合，cancelled 收尾，空闲 interrupt 返回 false', async (t) => {
  await interruptFlow(t, 'stdio')
})

test('ws：owner 打断进行中回合，cancelled 收尾，空闲 interrupt 返回 false', async (t) => {
  await interruptFlow(t, 'ws')
})

test('history.limit 截断语义：0 清空、1 截尾、超量不截断、非法值拒绝', async (t) => {
  const fixture = await startFixtureServer(t, 'text')
  const sessionId = 'history-limit-e2e'
  const serve = spawnServe(t, {
    args: ['--transport', 'stdio', '--session', sessionId],
    baseUrl: fixture.baseUrl
  })
  const { client } = await serve.connect()
  const events = []
  client.onEvent((event) => events.push(event))
  await client.request('submit', { text: 'hello' })
  await waitFor(
    () => events,
    (list) => list.some((event) => event.type === 'turn_finalized' && event.outcome === 'completed'),
    'turn completed'
  )

  const full = await client.request('history')
  assert.ok(full.messages.length >= 2)
  assert.equal(full.truncated, false)
  assert.deepEqual(full.needsReview, [])
  assert.deepEqual(full.warnings, [])

  const zero = await client.request('history', { limit: 0 })
  assert.deepEqual(zero.messages, [])
  assert.equal(zero.truncated, true)

  const one = await client.request('history', { limit: 1 })
  assert.equal(one.messages.length, 1)
  assert.equal(one.truncated, true)
  assert.deepEqual(one.messages[0], full.messages.at(-1))

  const over = await client.request('history', { limit: 999 })
  assert.deepEqual(over.messages, full.messages)
  assert.equal(over.truncated, false)

  await assert.rejects(client.request('history', { limit: -1 }), (error) => {
    assert.equal(error.code, 'HOST_PROTOCOL_002')
    assert.equal(error.message, 'history.limit must be a non-negative integer')
    return true
  })

  await client.request('shutdown')
  const { code } = await serve.closed
  assert.equal(code, 0)
  assert.equal(existsSync(lockPath(serve.home, sessionId)), false)
})
