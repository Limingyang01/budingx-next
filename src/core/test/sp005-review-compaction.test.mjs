// SP005 复审回归：保留项裁剪、压缩可重放、预算阈值统一与恢复权限。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AUTOCOMPACT_BUFFER_TOKENS,
  compactFloor,
  createContextBudgetManager,
  estimateTokens,
  normalizeBudget,
  reservedOutputFor,
  targetTokens,
  triggerTokens
} from '../../tui/dist/core/context-budget.js'
import { ERROR_CODES } from '../../tui/dist/core/constants.js'
import { Session } from '../../tui/dist/core/session.js'
import { messagesFromRecords } from '../../tui/dist/storage/session-transcript.js'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: true }
}

const mk = (id, role, blocks) => ({ id, role, blocks })
const user = (id, text) => mk(id, 'user', [{ type: 'text', text }])
const assistant = (id, text) => mk(id, 'assistant', [{ type: 'text', text }])

test('CB-04 超出预算的保留项被裁剪，压缩结果不再超限', () => {
  const manager = createContextBudgetManager()
  const big = 'x'.repeat(1200)
  const messages = [
    user('u1', 'old ' + big),
    assistant('a1', 'reply ' + big),
    user('u2', 'current question')
  ]
  const preserved = Array.from({ length: 8 }, (_, index) => ({
    kind: 'constraint',
    id: `c${index}`,
    text: `constraint ${index}: ${big}`,
    reason: 'r'
  }))
  const result = manager.compact({ messages, maxTokens: 400, reservedOutputTokens: 0 }, preserved)
  const floor = compactFloor({ messages, maxTokens: 400, reservedOutputTokens: 0 })
  assert.equal(result.compacted, true)
  assert.equal(result.withinBudget, true)
  const keptTokens = estimateTokens(
    result.preserved.map((item) => ({
      id: item.id,
      role: 'user',
      blocks: [{ type: 'text', text: item.text }]
    }))
  )
  assert.ok(keptTokens <= floor, `preserved ${keptTokens} must stay within floor ${floor}`)
})

test('CB-01 压缩结果带可重放产物：顺序、合成消息与被丢弃 id', () => {
  const manager = createContextBudgetManager()
  const big = 'x'.repeat(1200)
  const messages = [
    user('u1', 'old ' + big),
    assistant('a1', 'reply ' + big),
    user('u2', 'current question')
  ]
  const preserved = [{ kind: 'constraint', id: 'u1', text: 'do not change config', reason: 'r' }]
  const result = manager.compact({ messages, maxTokens: 400, reservedOutputTokens: 0 }, preserved)
  assert.equal(result.compacted, true)
  assert.ok(result.artifacts, 'compaction must expose artifacts for the transcript')
  assert.equal(result.artifacts.order.length, result.messages.length)
  assert.deepEqual(result.artifacts.order, result.messages.map((message) => message.id))
  assert.ok(result.artifacts.droppedIds.includes('u1'))
  for (const synthetic of result.artifacts.synthetic) {
    assert.ok(result.artifacts.order.includes(synthetic.id))
  }
})

test('SR-02 转录重放压缩记录，恢复得到压缩后的历史而不是压缩前', () => {
  const ts = '2026-01-01T00:00:00.000Z'
  const records = [
    { type: 'message', ts, id: 'm1', role: 'user', blocks: [{ type: 'text', text: 'one' }] },
    { type: 'message', ts, id: 'm2', role: 'assistant', blocks: [{ type: 'text', text: 'two' }] },
    {
      type: 'compaction',
      ts,
      turnId: 't1',
      droppedIds: ['m1'],
      order: ['preserved-x', 'm2'],
      synthetic: [
        { id: 'preserved-x', role: 'user', blocks: [{ type: 'text', text: 'kept facts' }] }
      ]
    },
    { type: 'message', ts, id: 'm3', role: 'user', blocks: [{ type: 'text', text: 'three' }] }
  ]
  const messages = messagesFromRecords(records)
  assert.deepEqual(messages.map((message) => message.id), ['preserved-x', 'm2', 'm3'])
  assert.equal(messages[0].blocks[0].text, 'kept facts')
})

test('CB-05 预算默认值与阈值由同一处计算（会话与 /context 不再分叉）', () => {
  assert.deepEqual(normalizeBudget(100000), { maxTokens: 100000, reservedOutputTokens: 25000 })
  assert.equal(normalizeBudget(100000, 1000).reservedOutputTokens, 1000)
  assert.equal(reservedOutputFor(400), 100)
  assert.equal(reservedOutputFor(400, 0), 0)
  const input = { messages: [], maxTokens: 100000, reservedOutputTokens: 25000 }
  assert.equal(targetTokens(input), 75000)
  // SP009 0.9.1：触发阈值改为「窗口 − 13k 缓冲」（对齐参考仓），不再是 0.85 比例。
  assert.equal(triggerTokens(input), 100000 - AUTOCOMPACT_BUFFER_TOKENS)
})

test('SR-10 恢复权限沿用会话原模式，且绝不升权', () => {
  const written = []
  let current = 'full_access'
  const session = new Session({
    provider: { async *stream() {} },
    approval: { async request() { return { outcome: 'allow', via: 'user' } } },
    resolveSnapshot: () => SNAPSHOT,
    permissionPolicy: {
      decide: () => ({ action: 'allow', reason: 'test' }),
      remember: () => {},
      getMode: () => current,
      setMode: (mode) => {
        current = mode
        written.push(mode)
      }
    }
  })
  // Restoring a read-only session never keeps the wider current mode.
  assert.equal(session.restorePermissionMode('read_only'), 'read_only')
  assert.deepEqual(written, ['read_only'])
  // A recorded wider mode must not raise the current one.
  current = 'read_only'
  assert.equal(session.restorePermissionMode('full_access'), 'read_only')
  assert.deepEqual(written, ['read_only'])
  // Sessions recorded before SP005 have no mode; keep the current one.
  assert.equal(session.restorePermissionMode(undefined), undefined)
})

test('CB-01 会话压缩把 compaction 记录写入转录（恢复不再撤销压缩）', async () => {
  const records = []
  const transcript = {
    append: (record) => records.push(record),
    read: () => ({ records: [], corruptLines: 0, unsupported: false }),
    directory: () => '/tmp/sp005-review'
  }
  const session = new Session({
    provider: {
      async *stream() {
        yield { type: 'message_completed', finishReason: 'stop' }
      }
    },
    approval: { async request() { return { outcome: 'allow', via: 'user' } } },
    resolveSnapshot: () => SNAPSHOT,
    transcript,
    contextBudget: { maxTokens: 60, reservedOutputTokens: 0 }
  })
  session.restoreHistory([
    { id: 'h1', role: 'user', blocks: [{ type: 'text', text: 'x'.repeat(400) }] },
    { id: 'h2', role: 'assistant', blocks: [{ type: 'text', text: 'y'.repeat(400) }] },
    { id: 'h3', role: 'user', blocks: [{ type: 'text', text: 'ok' }] }
  ])
  const finalized = new Promise((resolve) => {
    const off = session.on((event) => {
      if (event.type === 'turn_finalized') {
        off()
        resolve(event)
      }
    })
  })
  session.submit('next')
  const event = await finalized
  assert.equal(event.outcome, 'completed')
  const compaction = records.find((record) => record.type === 'compaction')
  assert.ok(compaction, 'a compaction record must be written to the transcript')
  assert.ok(compaction.droppedIds.includes('h1'))
  assert.ok(compaction.droppedIds.includes('h2'))
  assert.ok(compaction.order.includes('h3'))
  assert.equal(compaction.order.length, 2)
})
