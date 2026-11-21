// SP008 T11：SH-05/SO-03 崩溃恢复。预置带 needs_review 的 transcript，
// 先以 observer 只读读取，再在 SIGKILL 留下的陈旧锁上显式接管。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { startFixtureServer, spawnServe } from './helpers/host-process.mjs'

function workspaceId() {
  return createHash('sha256').update(resolve(process.cwd())).digest('hex')
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function seedCrashArtifacts(home, sessionId) {
  const directory = join(home, '.budingx', 'sessions', sessionId)
  mkdirSync(directory, { recursive: true })
  const now = '2026-11-22T00:00:00.000Z'
  const records = [
    {
      type: 'session_started',
      ts: now,
      schemaVersion: 1,
      sessionId,
      title: 'crash recovery fixture',
      workspaceId: workspaceId()
    },
    {
      type: 'message',
      ts: now,
      id: 'm1',
      role: 'user',
      blocks: [{ type: 'text', text: 'run the long command' }]
    },
    {
      type: 'message',
      ts: now,
      id: 'm2',
      parentId: 'm1',
      role: 'assistant',
      blocks: [
        { type: 'text', text: 'starting' },
        { type: 'tool_use', id: 'call-9', name: 'Bash', input: { command: 'sleep 100' } }
      ]
    },
    {
      type: 'tool_step',
      ts: now,
      turnId: 'turn-1',
      callId: 'call-9',
      name: 'Bash',
      status: 'needs_review',
      detail: 'turn ended before the tool result was known'
    },
    { type: 'turn', ts: now, turnId: 'turn-1', outcome: 'cancelled' }
  ]
  writeFileSync(
    join(directory, 'transcript.jsonl'),
    records.map((record) => JSON.stringify(record)).join('\n') + '\n'
  )
  // 死进程留下的锁：模拟 owner 崩溃，必须显式 takeover 才能写。
  writeFileSync(join(directory, 'writer.lock'), '999999\n' + now + '\n')
  writeFileSync(
    join(directory, 'meta.json'),
    JSON.stringify({
      schemaVersion: 1,
      sessionId,
      title: 'crash recovery fixture',
      createdAt: now,
      updatedAt: now,
      turns: 1,
      permissionMode: 'workspace_edit'
    })
  )
  return {
    directory,
    transcript: join(directory, 'transcript.jsonl'),
    lock: join(directory, 'writer.lock')
  }
}

test('SH-05/SO-03: a crashed owner leaves readable history, unknown steps are flagged and never replayed', async (t) => {
  const fixture = await startFixtureServer(t)
  const sessionId = 'sh-crash-recovery'
  const home = (await import('node:fs')).mkdtempSync(join((await import('node:os')).tmpdir(), 'budingx-sp008-crash-'))
  const artifacts = seedCrashArtifacts(home, sessionId)
  const before = sha256(artifacts.transcript)

  // Read-only observer: stale lock is not stolen, nothing is written or replayed.
  const observer = spawnServe(t, {
    home,
    args: ['--transport', 'stdio', '--session', sessionId],
    baseUrl: fixture.baseUrl
  })
  const { client: observerClient, hello: observerHello } = await observer.connect()
  assert.equal(observerHello.role, 'observer')
  assert.ok(existsSync(artifacts.lock))

  const observerDescription = await observerClient.request('describe')
  assert.equal(observerDescription.state, 'unknown')
  assert.deepEqual(observerDescription.needsReview, [
    {
      name: 'Bash',
      callId: 'call-9',
      detail: 'turn ended before the tool result was known'
    }
  ])
  assert.match(observerDescription.warnings.join(' '), /not replayed/)
  const observerHistory = await observerClient.request('history')
  assert.equal(observerHistory.messages.length, 2)
  assert.equal(observerHistory.messages[0].role, 'user')
  assert.equal(observerHistory.messages[1].role, 'assistant')
  assert.deepEqual(observerHistory.needsReview, observerDescription.needsReview)
  observerClient.close()
  assert.deepEqual(await observer.closed, { code: 0, signal: null })
  assert.equal(fixture.requestCount, 0)
  assert.equal(sha256(artifacts.transcript), before)

  // Owner starts, then crashes: lock remains stale, transcript is untouched.
  const owner = spawnServe(t, {
    home,
    args: ['--transport', 'stdio', '--session', sessionId, '--takeover'],
    baseUrl: fixture.baseUrl
  })
  const { client: ownerClient, hello: ownerHello } = await owner.connect()
  assert.equal(ownerHello.role, 'owner')
  const ownerDescription = await ownerClient.request('describe')
  assert.deepEqual(ownerDescription.needsReview, observerDescription.needsReview)
  assert.equal(ownerDescription.permissionMode, 'workspace_edit')
  const ownerHistory = await ownerClient.request('history')
  assert.equal(ownerHistory.messages.length, 2)
  owner.child.kill('SIGKILL')
  await owner.closed
  assert.ok(existsSync(artifacts.lock))
  assert.equal(sha256(artifacts.transcript), before)

  // Explicit takeover on the stale lock restores the same history, still no replay.
  const resumed = spawnServe(t, {
    home,
    args: ['--transport', 'stdio', '--session', sessionId, '--takeover'],
    baseUrl: fixture.baseUrl
  })
  const { client: resumedClient, hello: resumedHello } = await resumed.connect()
  assert.equal(resumedHello.role, 'owner')
  const description = await resumedClient.request('describe')
  assert.deepEqual(description.needsReview, [
    {
      name: 'Bash',
      callId: 'call-9',
      detail: 'turn ended before the tool result was known'
    }
  ])
  assert.match(description.warnings.join(' '), /not replayed/)
  const history = await resumedClient.request('history')
  assert.equal(history.messages.length, 2)
  assert.equal(history.truncated, false)
  assert.equal(fixture.requestCount, 0)
  assert.equal(sha256(artifacts.transcript), before)

  await resumedClient.request('shutdown')
  assert.deepEqual(await resumed.closed, { code: 0, signal: null })
  assert.equal(existsSync(artifacts.lock), false)
  assert.equal(sha256(artifacts.transcript), before)
})
