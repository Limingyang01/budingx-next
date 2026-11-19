import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  judgeHierarchy,
  judgeToolNames,
  judgeLevels,
  judgeToolCalls,
  judgeModelObservations
} from './sp005-observation.mjs'

function observation(overrides) {
  return {
    id: 'obs-1',
    traceId: 'trace-1',
    parentObservationId: null,
    name: 'agent.run',
    type: 'agent',
    level: 'DEFAULT',
    sessionId: 'session-1',
    metadata: { outcome: 'success' },
    input: null,
    output: null,
    ...overrides
  }
}

test('OB-02 根观测必须唯一且无父链', () => {
  const result = judgeHierarchy([observation({})], 'session-1')
  assert.equal(result.ok, true)
})

test('OB-02 出现两个根观测判定失败', () => {
  const result = judgeHierarchy(
    [observation({}), observation({ id: 'obs-2' })],
    'session-1'
  )
  assert.equal(result.ok, false)
  assert.match(result.reason, /exactly one agent.run root/)
})

test('OB-02 根观测带父链判定失败', () => {
  const result = judgeHierarchy([observation({ parentObservationId: 'obs-0' })], 'session-1')
  assert.equal(result.ok, false)
  assert.match(result.reason, /must not have a parent/)
})

test('OB-02 子观测必须指向根观测', () => {
  const result = judgeHierarchy(
    [observation({}), observation({ id: 'obs-2', name: 'model.request', parentObservationId: 'obs-9' })],
    'session-1'
  )
  assert.equal(result.ok, false)
  assert.match(result.reason, /point at the root/)
})

test('OB-02 会话 ID 必须一致', () => {
  const result = judgeHierarchy(
    [observation({}), observation({ id: 'obs-2', name: 'model.request', parentObservationId: 'obs-1', sessionId: 'other' })],
    'session-1'
  )
  assert.equal(result.ok, false)
  assert.match(result.reason, /session id must be identical/)
})

test('OB-03 工具观测名必须来自真实工具表', () => {
  const result = judgeToolNames(
    [observation({ id: 'obs-2', name: 'tool.Read', parentObservationId: 'obs-1' })],
    ['Read', 'Write']
  )
  assert.equal(result.ok, true)
  assert.deepEqual(result.observed, ['Read'])
})

test('OB-03 出现未知工具名判定失败', () => {
  const result = judgeToolNames(
    [observation({ id: 'obs-2', name: 'tool.DeleteEverything', parentObservationId: 'obs-1' })],
    ['Read', 'Write']
  )
  assert.equal(result.ok, false)
  assert.deepEqual(result.unknown, ['DeleteEverything'])
})

test('OB-03 工具失败必须是 ERROR 级', () => {
  const ok = judgeLevels(
    [observation({ id: 'obs-2', name: 'tool.Read', parentObservationId: 'obs-1', level: 'ERROR' })],
    [{ name: 'tool.Read', level: 'ERROR' }]
  )
  assert.equal(ok.ok, true)
  const bad = judgeLevels(
    [observation({ id: 'obs-2', name: 'tool.Read', parentObservationId: 'obs-1', level: 'DEFAULT' })],
    [{ name: 'tool.Read', level: 'ERROR' }]
  )
  assert.equal(bad.ok, false)
  assert.match(bad.problems[0], /expected level ERROR/)
})

test('OB-03 权限阻断必须是 WARNING 级', () => {
  const result = judgeLevels(
    [observation({ id: 'obs-2', name: 'tool.Write', parentObservationId: 'obs-1', level: 'WARNING' })],
    [{ name: 'tool.Write', level: 'WARNING' }]
  )
  assert.equal(result.ok, true)
})

test('OB-03 工具调用次数在预算内且参数指向目标才合适', () => {
  const result = judgeToolCalls(
    [observation({ id: 'obs-2', name: 'tool.Read', parentObservationId: 'obs-1', input: '{"file":"facts.txt"}' })],
    { name: 'Read', maxCalls: 2, argsMustInclude: 'facts.txt' }
  )
  assert.equal(result.ok, true)
  assert.equal(result.calls, 1)
})

test('OB-03 没有工具调用或被重复调用判定不合适', () => {
  const none = judgeToolCalls([observation({})], { name: 'Read', maxCalls: 2 })
  assert.equal(none.ok, false)
  assert.match(none.problems[0], /no tool call observation/)
  const dup = judgeToolCalls(
    [
      observation({ id: 'obs-2', name: 'tool.Read', parentObservationId: 'obs-1', input: '{"file":"facts.txt"}' }),
      observation({ id: 'obs-3', name: 'tool.Read', parentObservationId: 'obs-1', input: '{"file":"facts.txt"}' })
    ],
    { name: 'Read', maxCalls: 2 }
  )
  assert.equal(dup.ok, false)
  assert.match(dup.problems.join(' '), /duplicate call/)
})

test('OB-03 工具参数偏离目标判定不合适', () => {
  const result = judgeToolCalls(
    [observation({ id: 'obs-2', name: 'tool.Read', parentObservationId: 'obs-1', input: '{"file":"other.txt"}' })],
    { name: 'Read', maxCalls: 2, argsMustInclude: 'facts.txt' }
  )
  assert.equal(result.ok, false)
  assert.match(result.problems[0], /arguments do not mention facts\.txt/)
})

test('OB-03 模型观测必须带真实用量与耗时', () => {
  const ok = judgeModelObservations([
    observation({ id: 'obs-2', name: 'model.request', parentObservationId: 'obs-1', totalUsage: 42, latency: 0.8 })
  ])
  assert.equal(ok.ok, true)
  assert.equal(ok.totalUsage, 42)
  const empty = judgeModelObservations([observation({})])
  assert.equal(empty.ok, false)
  assert.match(empty.reason, /no model.request/)
  const zero = judgeModelObservations([
    observation({ id: 'obs-2', name: 'model.request', parentObservationId: 'obs-1', totalUsage: 0, latency: 1 })
  ])
  assert.equal(zero.ok, false)
  assert.match(zero.reason, /no token usage/)
})

test('OB-03 缺少工具观测判定失败', () => {
  const result = judgeLevels([], [{ name: 'tool.Read', level: 'ERROR' }])
  assert.equal(result.ok, false)
  assert.match(result.problems[0], /observation missing/)
});
