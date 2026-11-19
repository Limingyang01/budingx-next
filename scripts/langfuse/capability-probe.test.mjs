// SP004 agent-observability：能力探针与 trace 查询的纯函数测试。
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createBugFixture, summarizeEvents, loadRuntimeConfig } from './capability-probe.mjs'
import { summarizeTraces, loadLangfuseConfig, fetchObservations } from './query-traces.mjs'

test('createBugFixture writes a buggy module and a failing test', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cap-fixture-'))
  const { mathPath, testPath } = createBugFixture(dir)
  assert.ok(readFileSync(mathPath, 'utf8').includes('a - b'))
  assert.ok(readFileSync(testPath, 'utf8').includes('assert.equal(add(2, 3), 5)'))
})

test('summarizeEvents extracts tools, edits, commands and outcome', () => {
  const events = [
    { type: 'tool_call_completed', name: 'Read' },
    { type: 'tool_call_completed', name: 'Read' },
    { type: 'tool_call_completed', name: 'Edit' },
    { type: 'change_set', changes: [{ path: 'math.js' }] },
    { type: 'tool_call_completed', name: 'Bash' },
    { type: 'command_finished', outcome: 'failed' },
    { type: 'text_delta', text: 'fixed' },
    { type: 'turn_finalized', outcome: 'error', error: { code: 'BUDINGX_EXEC_005' } }
  ]
  const s = summarizeEvents(events)
  assert.deepEqual(s.toolCounts, { Read: 2, Edit: 1, Bash: 1 })
  assert.equal(s.toolTotal, 4)
  assert.deepEqual(s.editedFiles, ['math.js'])
  assert.deepEqual(s.commandOutcomes, ['failed'])
  assert.equal(s.commandSucceeded, false)
  assert.equal(s.outcome, 'error')
  assert.equal(s.errorCode, 'BUDINGX_EXEC_005')
  assert.equal(s.answer, 'fixed')
})

test('summarizeEvents reports success when a command completed', () => {
  const s = summarizeEvents([
    { type: 'command_finished', outcome: 'completed' },
    { type: 'turn_finalized', outcome: 'completed' }
  ])
  assert.equal(s.commandSucceeded, true)
  assert.equal(s.outcome, 'completed')
  assert.equal(s.errorCode, null)
})

function obs(overrides) {
  return {
    traceId: 't1', name: 'agent.run', level: 'DEFAULT', sessionId: 's1',
    startTime: '2026-11-19T00:00:00Z', metadata: {}, ...overrides
  }
}

test('summarizeTraces groups by trace and counts roles and levels', () => {
  const observations = [
    obs({ name: 'agent.run', level: 'ERROR', statusMessage: 'BUDINGX_EXEC_005' }),
    obs({ name: 'model.request' }),
    obs({ name: 'tool.Read' }),
    obs({ name: 'tool.Bash', level: 'ERROR' }),
    obs({ traceId: 't2', name: 'agent.run', sessionId: 's2', startTime: '2026-11-19T01:00:00Z' }),
    obs({ traceId: 't2', name: 'model.request', sessionId: 's2' })
  ]
  const summaries = summarizeTraces(observations)
  assert.equal(summaries.length, 2)
  // 按 startTime 降序：t2 在前。
  assert.equal(summaries[0].traceId, 't2')
  const t1 = summaries.find((s) => s.traceId === 't1')
  assert.equal(t1.total, 4)
  assert.equal(t1.models, 1)
  assert.equal(t1.tools, 2)
  assert.equal(t1.errors, 2)
  assert.equal(t1.rootLevel, 'ERROR')
  assert.equal(t1.rootOutcome, 'BUDINGX_EXEC_005')
})

test('summarizeTraces prefers metadata.outcome over statusMessage', () => {
  const [s] = summarizeTraces([obs({ metadata: { outcome: 'blocked' }, statusMessage: 'x' })])
  assert.equal(s.rootOutcome, 'blocked')
})

test('loadLangfuseConfig lets process env override the agent.env file', () => {
  const config = loadLangfuseConfig({
    LANGFUSE_BASE_URL: 'http://localhost:9999',
    LANGFUSE_PUBLIC_KEY: 'pk-override',
    LANGFUSE_SECRET_KEY: 'sk-override'
  })
  assert.equal(config.baseUrl, 'http://localhost:9999')
  assert.equal(config.publicKey, 'pk-override')
  assert.equal(config.secretKey, 'sk-override')
})

test('fetchObservations queries v2 with basic auth and returns data', async () => {
  let seen = null
  const fakeFetch = async (url, init) => {
    seen = { url, init }
    return new Response(JSON.stringify({ data: [obs({})] }), { status: 200 })
  }
  const rows = await fetchObservations(
    { baseUrl: 'http://localhost:3000', publicKey: 'pk', secretKey: 'sk' },
    { traceId: 't1', limit: 50 },
    fakeFetch
  )
  assert.equal(rows.length, 1)
  assert.ok(seen.url.includes('/api/public/v2/observations'))
  assert.ok(seen.url.includes('traceId=t1'))
  assert.ok(seen.url.includes('fields=core%2Cbasic%2Cio') || seen.url.includes('fields=core,basic,io'))
  assert.ok(seen.init.headers.authorization.startsWith('Basic '))
})

test('fetchObservations throws without keys', async () => {
  await assert.rejects(
    () => fetchObservations({ baseUrl: 'http://localhost:3000' }, {}, async () => new Response('{}')),
    /Missing Langfuse keys/
  )
})
