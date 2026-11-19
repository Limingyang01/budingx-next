// SP004 agent-observability T32：验收脚本判定逻辑（替身）。
// 覆盖 OB-25、OB-26、OB-27。用合成观测验证判定，不依赖 live 平台/模型。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  judgeStructure,
  judgeContent,
  noContentAnywhere,
  aggregateExitCode,
  SCENARIOS
} from './verify-agent.mjs'

const SESSION = 'verify-session-1'
const SECRET = 'sk-lf-verify-synthetic-secret-000'

function obs(overrides) {
  return {
    id: 'o-' + Math.random().toString(36).slice(2),
    traceId: 'trace-1',
    parentObservationId: null,
    name: 'agent.run',
    type: 'AGENT',
    level: 'DEFAULT',
    sessionId: SESSION,
    input: null,
    output: null,
    ...overrides
  }
}

/** 构造一个成功场景的完整观测集。 */
function successSet() {
  const root = obs({ name: 'agent.run', id: 'root' })
  const model = obs({ name: 'model.request', type: 'GENERATION', parentObservationId: 'root', id: 'm1' })
  const tool = obs({ name: 'tool.Read', type: 'TOOL', parentObservationId: 'root', id: 't1' })
  return [root, model, tool]
}

function toolErrorSet() {
  const root = obs({ name: 'agent.run', id: 'root' })
  const model = obs({ name: 'model.request', type: 'GENERATION', parentObservationId: 'root', id: 'm1' })
  const tool = obs({ name: 'tool.Read', type: 'TOOL', parentObservationId: 'root', id: 't1', level: 'ERROR' })
  return [root, model, tool]
}

function modelErrorSet() {
  const root = obs({ name: 'agent.run', id: 'root', level: 'ERROR' })
  const model = obs({ name: 'model.request', type: 'GENERATION', parentObservationId: 'root', id: 'm1', level: 'ERROR' })
  return [root, model]
}

// ---------- judgeStructure（OB-27） ----------

test('a well formed success set passes hierarchy and session checks', () => {
  const { hierarchyOk, sessionConsistent } = judgeStructure('success', successSet(), SESSION)
  assert.equal(hierarchyOk, true)
  assert.equal(sessionConsistent, true)
})

test('a duplicate root fails hierarchy', () => {
  const set = successSet()
  set.push(obs({ name: 'agent.run', id: 'root2' }))
  assert.equal(judgeStructure('success', set, SESSION).hierarchyOk, false)
})

test('a missing required child fails hierarchy', () => {
  const set = successSet().filter((o) => o.name !== 'tool.Read')
  assert.equal(judgeStructure('success', set, SESSION).hierarchyOk, false)
})

test('a child with the wrong parent fails hierarchy', () => {
  const set = successSet()
  set.find((o) => o.name === 'tool.Read').parentObservationId = 'someone-else'
  assert.equal(judgeStructure('success', set, SESSION).hierarchyOk, false)
})

test('a wrong error level fails the tool-error scenario', () => {
  const set = toolErrorSet()
  set.find((o) => o.name === 'tool.Read').level = 'DEFAULT'
  assert.equal(judgeStructure('tool-error', set, SESSION).hierarchyOk, false)
})

test('a shared wrong session id fails session consistency', () => {
  const set = successSet().map((o) => ({ ...o, sessionId: 'other-session' }))
  const { sessionConsistent } = judgeStructure('success', set, SESSION)
  assert.equal(sessionConsistent, false)
})

test('the model-error scenario requires error root and model and no tools', () => {
  assert.equal(judgeStructure('model-error', modelErrorSet(), SESSION).hierarchyOk, true)
  const withTool = [...modelErrorSet(), obs({ name: 'tool.Read', parentObservationId: 'root' })]
  assert.equal(judgeStructure('model-error', withTool, SESSION).hierarchyOk, false)
})

test('an empty observation set fails hierarchy', () => {
  assert.equal(judgeStructure('success', [], SESSION).hierarchyOk, false)
})

// ---------- judgeContent（OB-25） ----------

test('content capture off returns null', () => {
  assert.equal(judgeContent('success', successSet(), false), null)
})

test('valid user and assistant arrays pass content verification', () => {
  const set = successSet()
  set[0].input = JSON.stringify([{ role: 'user', content: 'read note.txt' }])
  set[0].output = JSON.stringify([{ role: 'assistant', content: 'done' }])
  assert.equal(judgeContent('success', set, true), true)
})

test('a leaked synthetic secret fails content verification', () => {
  const set = successSet()
  set[0].input = JSON.stringify([{ role: 'user', content: `key ${SECRET}` }])
  set[0].output = JSON.stringify([{ role: 'assistant', content: 'done' }])
  assert.equal(judgeContent('success', set, true), false)
})

test('model-error with no assistant message accepts an empty output array', () => {
  const set = modelErrorSet()
  set[0].input = JSON.stringify([{ role: 'user', content: 'read note.txt' }])
  set[0].output = JSON.stringify([])
  assert.equal(judgeContent('model-error', set, true), true)
})

test('malformed io fails content verification', () => {
  const set = successSet()
  set[0].input = 'not-json'
  set[0].output = JSON.stringify([{ role: 'assistant', content: 'done' }])
  assert.equal(judgeContent('success', set, true), false)
})

test('noContentAnywhere detects any present payload', () => {
  assert.equal(noContentAnywhere(successSet()), true)
  const withContent = successSet()
  withContent[1].output = 'something'
  assert.equal(noContentAnywhere(withContent), false)
})

// ---------- aggregateExitCode（OB-26） ----------

function passingResult(scenario, captureContent) {
  return {
    scenario,
    localExpectationMet: true,
    platformIndexed: true,
    hierarchyOk: true,
    sessionConsistent: true,
    contentVerified: captureContent ? true : null,
    noContent: !captureContent
  }
}

test('all passing scenarios yield exit code 0', () => {
  const results = SCENARIOS.map((s) => passingResult(s, false))
  assert.equal(aggregateExitCode(results, false), 0)
})

test('any failed local expectation yields non zero', () => {
  const results = SCENARIOS.map((s) => passingResult(s, false))
  results[0].localExpectationMet = false
  assert.equal(aggregateExitCode(results, false), 1)
})

test('an unindexed scenario yields non zero even if everything else passes', () => {
  const results = SCENARIOS.map((s) => passingResult(s, false))
  results[1].platformIndexed = false
  assert.equal(aggregateExitCode(results, false), 1)
})

test('a hierarchy failure yields non zero even when indexed', () => {
  const results = SCENARIOS.map((s) => passingResult(s, false))
  results[2].hierarchyOk = false
  assert.equal(aggregateExitCode(results, false), 1)
})

test('content capture on requires contentVerified true', () => {
  const results = SCENARIOS.map((s) => passingResult(s, true))
  assert.equal(aggregateExitCode(results, true), 0)
  results[0].contentVerified = null
  assert.equal(aggregateExitCode(results, true), 1)
})

test('content capture off requires no payload anywhere', () => {
  const results = SCENARIOS.map((s) => passingResult(s, false))
  results[0].noContent = false
  assert.equal(aggregateExitCode(results, false), 1)
})
