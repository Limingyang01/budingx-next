import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assembleToolCalls } from '../../tui/dist/core/tool-calls.js'

test('tool_calls 跨事件碎片按 index 组装完整调用列表', () => {
  const { calls, errors } = assembleToolCalls([
    { index: 0, callId: 'call_a', nameDelta: 'read_' },
    { index: 0, nameDelta: 'file' },
    { index: 0, argsDelta: '{"path"' },
    { index: 0, argsDelta: ':"a.txt"}' },
    { index: 1, callId: 'call_b', nameDelta: 'list_dir', argsDelta: '{}' }
  ])
  assert.equal(errors.length, 0)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].id, 'call_a')
  assert.equal(calls[0].name, 'read_file')
  assert.equal(calls[0].arguments, '{"path":"a.txt"}')
  assert.equal(calls[1].index, 1)
  assert.equal(calls[1].name, 'list_dir')
})

test('缺 index 的碎片按出现顺序补位且不丢调用', () => {
  const { calls, errors } = assembleToolCalls([
    { callId: 'call_a', nameDelta: 'first', argsDelta: '{}' },
    { callId: 'call_b', nameDelta: 'second', argsDelta: '{}' }
  ])
  assert.equal(errors.length, 0)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].index, 0)
  assert.equal(calls[0].id, 'call_a')
  assert.equal(calls[0].name, 'first')
  assert.equal(calls[1].index, 1)
  assert.equal(calls[1].id, 'call_b')
  assert.equal(calls[1].name, 'second')
})

test('缺 index 的续流碎片并入当前调用而不是拆成新调用', () => {
  const { calls, errors } = assembleToolCalls([
    { index: 0, callId: 'call_a', nameDelta: 'run', argsDelta: '{"a"' },
    { argsDelta: ':1}' }
  ])
  assert.equal(errors.length, 0)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].arguments, '{"a":1}')
})

test('非法 JSON 参数归一为结构化错误项且进程不崩', () => {
  const { calls, errors } = assembleToolCalls([
    { index: 0, callId: 'call_a', nameDelta: 'broken', argsDelta: '{not json' }
  ])
  assert.equal(calls.length, 0)
  assert.equal(errors.length, 1)
  assert.match(errors[0].code, /^BUDINGX_PROVIDER_\d+$/)
  assert.equal(typeof errors[0].message, 'string')
})

test('缺少函数名或 id 的调用归一为结构化错误项', () => {
  const { calls, errors } = assembleToolCalls([
    { index: 0, argsDelta: '{}' },
    { index: 1, nameDelta: 'no_id', argsDelta: '{}' }
  ])
  assert.equal(calls.length, 0)
  assert.equal(errors.length, 2)
})

test('并行调用的顺序按 index 稳定', () => {
  const { calls } = assembleToolCalls([
    { index: 2, callId: 'c', nameDelta: 'third', argsDelta: '{}' },
    { index: 0, callId: 'a', nameDelta: 'first', argsDelta: '{}' },
    { index: 1, callId: 'b', nameDelta: 'second', argsDelta: '{}' }
  ])
  assert.deepEqual(
    calls.map((call) => call.name),
    ['first', 'second', 'third']
  )
})
