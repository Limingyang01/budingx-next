// SP005 观测平台：stack-smoke 判定与批次形状的替身测试（不联网、不依赖模型）。

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSmokeBatch, judgeStackObservations } from './stack-smoke.mjs'

const SESSION = 'stack-smoke-session'

/** 构造一条齐全的观测集合。 */
function completeObservations() {
  return [
    { id: 'root', name: 'agent.run', parentObservationId: null, sessionId: SESSION },
    { id: 'model', name: 'model.request', parentObservationId: 'root', sessionId: SESSION },
    { id: 'tool', name: 'tool.Read', parentObservationId: 'root', sessionId: SESSION, level: 'ERROR' }
  ]
}

test('stack-smoke 判定：齐全的层级、工具失败与会话一致时通过', () => {
  const verdict = judgeStackObservations(completeObservations(), SESSION)
  assert.equal(verdict.count, 3)
  assert.equal(verdict.rootCount, 1)
  assert.equal(verdict.hierarchyOk, true)
  assert.equal(verdict.toolErrorVisible, true)
  assert.equal(verdict.modelPresent, true)
  assert.equal(verdict.sessionConsistent, true)
  assert.equal(verdict.ok, true)
})

test('stack-smoke 判定：工具失败不可见时不通过', () => {
  const observations = completeObservations()
  observations[2].level = 'DEFAULT'
  const verdict = judgeStackObservations(observations, SESSION)
  assert.equal(verdict.toolErrorVisible, false)
  assert.equal(verdict.ok, false)
})

test('stack-smoke 判定：根节点不唯一或子节点挂错父节点时不通过', () => {
  const duplicateRoot = [...completeObservations(), { id: 'root2', name: 'agent.run', parentObservationId: null, sessionId: SESSION }]
  assert.equal(judgeStackObservations(duplicateRoot, SESSION).hierarchyOk, false)
  const misattached = completeObservations()
  misattached[1].parentObservationId = 'tool'
  assert.equal(judgeStackObservations(misattached, SESSION).hierarchyOk, false)
})

test('stack-smoke 判定：会话不一致或空集合时不通过', () => {
  const mixed = completeObservations()
  mixed[1].sessionId = 'other-session'
  assert.equal(judgeStackObservations(mixed, SESSION).sessionConsistent, false)
  assert.equal(judgeStackObservations([], SESSION).ok, false)
})

test('stack-smoke 批次：根 span 无父节点，失败工具带 ERROR 属性与错误状态码', () => {
  const { batch, payloads, rootId } = buildSmokeBatch('c1'.repeat(16), 'c1'.repeat(8))
  assert.equal(batch.spans.length, 3)
  const root = batch.spans.find((span) => span.spanId === rootId)
  assert.equal(root.parentSpanId, undefined)
  assert.equal(root.name, 'agent.run')
  const tool = batch.spans.find((span) => span.name === 'tool.Read')
  assert.equal(tool.parentSpanId, rootId)
  assert.equal(tool.status.code, 2)
  assert.equal(tool.attributes['langfuse.observation.level'], 'ERROR')
  assert.ok(payloads.has(tool.spanId))
})
