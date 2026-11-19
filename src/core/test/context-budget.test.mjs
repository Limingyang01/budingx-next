// SP005 §4 CB-01…CB-07：上下文预算与压缩的单元用例。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPACTED_TOOL_MARKER,
  COMPACT_FLOOR_RATIO,
  COMPACT_TRIGGER_RATIO,
  MAX_PRESERVED_CONSTRAINTS,
  collectConstraintItems,
  compactFloor,
  createContextBudgetManager,
  estimateTokens,
  targetTokens,
  triggerTokens
} from '../../tui/dist/core/context-budget.js'

let counter = 0
function user(text) {
  counter++
  return { id: `u${counter}`, role: 'user', blocks: [{ type: 'text', text }] }
}
function assistant(text) {
  counter++
  return { id: `a${counter}`, role: 'assistant', blocks: [{ type: 'text', text }] }
}
function toolUse(id, name) {
  counter++
  return { id: `m${counter}`, role: 'assistant', blocks: [{ type: 'tool_use', id, name, input: {} }] }
}

/** 构造若干「历史回合 + 当前回合」的消息序列，每条消息长度可控。 */
function turns(count, size) {
  const messages = []
  for (let index = 0; index < count; index++) {
    messages.push(user(`历史任务 ${index} `.repeat(size)))
    messages.push(assistant(`历史回答 ${index} `.repeat(size)))
  }
  return messages
}

const manager = createContextBudgetManager()

test('CB-05 阈值公式与常量一致', () => {
  const input = { messages: [], maxTokens: 1000, reservedOutputTokens: 200 }
  assert.equal(targetTokens(input), 800)
  assert.equal(triggerTokens(input), Math.floor(800 * COMPACT_TRIGGER_RATIO))
  assert.equal(compactFloor(input), Math.floor(800 * COMPACT_FLOOR_RATIO))
})

test('CB-05 未超触发阈值时不压缩', () => {
  const messages = [user('短问题'), assistant('短回答')]
  const result = manager.compact({ messages, maxTokens: 1000 }, [])
  assert.equal(result.compacted, false)
  assert.equal(result.replacedCount, 0)
  assert.equal(result.messages.length, 2)
})

test('CB-02 压缩后保留用户约束', () => {
  const messages = [
    user('不要修改 README 文件'),
    assistant('好的，我记住了这个约束。'),
    ...turns(4, 30),
    user('现在的任务是最后一个问题')
  ]
  const preserved = collectConstraintItems(messages)
  assert.equal(preserved.length, 1)
  assert.equal(preserved[0].kind, 'constraint')
  const result = manager.compact({ messages, maxTokens: 400 }, preserved)
  assert.equal(result.compacted, true)
  assert.ok(result.replacedCount > 0)
  assert.ok(result.withinBudget, '压缩后必须回到预算内')
  const joined = JSON.stringify(result.messages)
  assert.ok(joined.includes('不要修改 README 文件'), '约束文本必须在压缩后保留')
})

test('CB-02 约束保留项最多 8 条且取最近', () => {
  const messages = []
  for (let index = 0; index < 12; index++) messages.push(user(`不要做第 ${index} 件事`))
  const preserved = collectConstraintItems(messages)
  assert.equal(preserved.length, MAX_PRESERVED_CONSTRAINTS)
  assert.ok(preserved[preserved.length - 1].text.includes('第 11 件事'))
})

test('CB-03 计划保留项在压缩后仍在上下文中', () => {
  const messages = [
    user('第一轮任务'),
    assistant('已完成'),
    ...turns(4, 30),
    user('第三轮问题')
  ]
  const preserved = [
    { kind: 'plan', id: 'plan-1', text: '目标：实现 SP005 持久化', reason: '已批准计划' }
  ]
  const result = manager.compact({ messages, maxTokens: 400 }, preserved)
  assert.equal(result.compacted, true)
  assert.ok(JSON.stringify(result.messages).includes('实现 SP005 持久化'))
})

test('CB-04 未完成工具调用变为显式失败占位，不伪造成功', () => {
  const messages = [
    user('请写入文件'),
    toolUse('call-1', 'Write'),
    ...turns(4, 30),
    user('最后问题')
  ]
  const result = manager.compact({ messages, maxTokens: 400 }, [])
  assert.equal(result.compacted, true)
  const block = result.messages
    .flatMap((message) => message.blocks)
    .find((entry) => entry.type === 'tool_result' && entry.callId === 'call-1')
  assert.ok(block, '未完成工具调用必须有占位结果')
  assert.equal(block.isError, true)
  assert.ok(block.content.includes(COMPACTED_TOOL_MARKER))
})

test('CB-07 压缩是幂等的', () => {
  const messages = [...turns(6, 30), user('第三轮')]
  const first = manager.compact({ messages, maxTokens: 400 }, [])
  assert.equal(first.compacted, true)
  const second = manager.compact({ messages: first.messages, maxTokens: 400 }, first.preserved)
  assert.ok(second.replacedCount <= first.replacedCount + 1)
})

test('CB-06 单条消息超预算时给出明确原因', () => {
  const messages = [user('x'.repeat(5000)), assistant('ok')]
  const result = manager.compact({ messages, maxTokens: 100 }, [])
  assert.equal(result.withinBudget, false)
  assert.equal(result.overflowReason, 'single_message_too_large')
})

test('CB-06 无可压缩范围时给出明确原因', () => {
  const messages = [user('x'.repeat(500)), assistant('y'.repeat(500))]
  const result = manager.compact({ messages, maxTokens: 100 }, [])
  assert.equal(result.withinBudget, false)
  assert.ok(result.overflowReason)
})

test('CB-05 压缩后长度回到目标以内', () => {
  const messages = [...turns(8, 40), user('最终问题')]
  const result = manager.compact({ messages, maxTokens: 600 }, [])
  assert.equal(result.compacted, true)
  assert.equal(result.withinBudget, true)
  assert.ok(result.estimatedTokens <= targetTokens({ messages, maxTokens: 600 }))
})

test('estimateTokens 对空输入为 0', () => {
  assert.equal(estimateTokens([]), 0)
})
