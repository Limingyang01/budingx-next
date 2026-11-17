import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeForApi } from '../../tui/dist/core/normalize.js'

const user = (id, text) => ({ id, role: 'user', blocks: [{ type: 'text', text }] })
const assistant = (id, blocks) => ({ id, role: 'assistant', blocks })
const tool = (id, callId, content, isError = false) => ({
  id,
  role: 'tool',
  blocks: [{ type: 'tool_result', callId, content, isError }]
})

test('普通用户与助手文本原样保留', () => {
  const api = normalizeForApi([
    user('m1', 'hello'),
    assistant('m2', [{ type: 'text', text: 'hi there' }])
  ])
  assert.deepEqual(api, [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi there' }
  ])
})

test('孤儿 tool_result 被剥离，不进入模型上下文', () => {
  const api = normalizeForApi([
    user('m1', 'hello'),
    tool('m2', 'call_missing', 'orphan result')
  ])
  assert.deepEqual(api, [{ role: 'user', content: 'hello' }])
})

test('tool_use 与 tool_result 按顺序配对进入模型上下文', () => {
  const api = normalizeForApi([
    user('m1', 'read it'),
    assistant('m2', [
      { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'a.txt' } }
    ]),
    tool('m3', 'call_1', 'file body')
  ])
  assert.equal(api.length, 3)
  assert.deepEqual(api[1], {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"a.txt"}' }
      }
    ]
  })
  assert.deepEqual(api[2], {
    role: 'tool',
    tool_call_id: 'call_1',
    content: 'file body'
  })
})

test('重复 tool_use id 只保留首个', () => {
  const api = normalizeForApi([
    assistant('m1', [
      { type: 'tool_use', id: 'call_1', name: 'first', input: {} },
      { type: 'tool_use', id: 'call_1', name: 'second', input: {} }
    ])
  ])
  assert.equal(api.length, 2)
  assert.equal(api[0].tool_calls.length, 1)
  assert.equal(api[0].tool_calls[0].function.name, 'first')
  assert.equal(api[1].role, 'tool')
})

test('缺失 tool_result 的 tool_use 补合成结果，模型不会看到悬空调用', () => {
  const api = normalizeForApi([
    user('m1', 'read it'),
    assistant('m2', [
      { type: 'tool_use', id: 'call_1', name: 'read_file', input: {} }
    ])
  ])
  assert.equal(api.length, 3)
  assert.equal(api[2].role, 'tool')
  assert.equal(api[2].tool_call_id, 'call_1')
  assert.match(api[2].content, /did not complete/)
})

test('助手文本与工具调用同处一条 assistant 消息', () => {
  const api = normalizeForApi([
    assistant('m1', [
      { type: 'text', text: 'reading now' },
      { type: 'tool_use', id: 'call_1', name: 'read_file', input: {} }
    ]),
    tool('m2', 'call_1', 'body')
  ])
  assert.equal(api.length, 2)
  assert.equal(api[0].role, 'assistant')
  assert.equal(api[0].content, 'reading now')
  assert.equal(api[0].tool_calls.length, 1)
})

test('思考块与中断标记不进入模型上下文', () => {
  const api = normalizeForApi([
    assistant('m1', [
      { type: 'thinking', text: 'internal' },
      { type: 'text', text: 'answer' },
      { type: 'interrupt_mark', reason: 'user' }
    ])
  ])
  assert.deepEqual(api, [{ role: 'assistant', content: 'answer' }])
})
