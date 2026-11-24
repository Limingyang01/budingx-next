import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Session } from '../../tui/dist/core/session.js'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: true }
}

/** In-memory transcript port that records every append. */
function memoryTranscript() {
  const records = []
  return {
    records,
    transcript: {
      append(record) {
        records.push(record)
      },
      read() {
        return { records, corruptLines: 0, unsupported: false }
      },
      directory() {
        return '/memory'
      }
    }
  }
}

function scriptProvider(script) {
  const calls = []
  return {
    calls,
    provider: {
      async *stream(request) {
        calls.push(request)
        const events = script.shift() ?? [
          { type: 'message_completed', finishReason: 'stop' }
        ]
        for (const event of events) yield event
      }
    }
  }
}

function approvalGateway(decision = { outcome: 'allow', via: 'user' }) {
  return {
    async request() {
      return decision
    }
  }
}

function waitFor(session, predicate) {
  return new Promise((resolve) => {
    const off = session.on((event) => {
      if (predicate(event)) {
        off()
        resolve(event)
      }
    })
  })
}

function collect(session) {
  const events = []
  session.on((event) => events.push(event))
  return events
}

test('SR-05 转录记录用户消息、助手消息与回合结果', async () => {
  const { transcript, records } = memoryTranscript()
  const { provider } = scriptProvider([
    [
      { type: 'text_delta', text: '你好' },
      { type: 'message_completed', finishReason: 'stop' }
    ]
  ])
  const session = new Session({
    provider,
    approval: approvalGateway(),
    resolveSnapshot: () => SNAPSHOT,
    transcript
  })
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('hi')
  const event = await finalized
  assert.equal(event.outcome, 'completed')

  const messages = records.filter((record) => record.type === 'message')
  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'user')
  assert.equal(messages[1].role, 'assistant')
  const turns = records.filter((record) => record.type === 'turn')
  assert.equal(turns.length, 1)
  assert.equal(turns[0].outcome, 'completed')
})

test('SR-06 工具调用成功记录 completed，失败记录 failed', async () => {
  const { transcript, records } = memoryTranscript()
  const { provider } = scriptProvider([
    [
      {
        type: 'tool_call_delta',
        index: 0,
        callId: 'call-1',
        nameDelta: 'Read',
        argsDelta: '{}'
      },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ],
    [{ type: 'message_completed', finishReason: 'stop' }]
  ])
  const session = new Session({
    provider,
    approval: approvalGateway(),
    resolveSnapshot: () => SNAPSHOT,
    transcript,
    tools: [
      {
        name: 'Read',
        summary: 'read a file',
        describe: () => 'read a file',
        async execute() {
          return 'file content'
        }
      }
    ]
  })
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('read it')
  await finalized
  const steps = records.filter((record) => record.type === 'tool_step')
  assert.equal(steps.length, 1)
  assert.equal(steps[0].status, 'completed')
  assert.equal(steps[0].name, 'Read')
})

test('SR-06 工具失败记录 failed 并保留错误码', async () => {
  const { transcript, records } = memoryTranscript()
  const { provider } = scriptProvider([
    [
      {
        type: 'tool_call_delta',
        index: 0,
        callId: 'call-2',
        nameDelta: 'Explode',
        argsDelta: '{}'
      },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ],
    [{ type: 'message_completed', finishReason: 'stop' }]
  ])
  const session = new Session({
    provider,
    approval: approvalGateway(),
    resolveSnapshot: () => SNAPSHOT,
    transcript,
    tools: [
      {
        name: 'Explode',
        summary: 'always fails',
        describe: () => 'always fails',
        async execute() {
          const error = new Error('boom')
          error.code = 'BUDINGX_WORKSPACE_001'
          throw error
        }
      }
    ]
  })
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('run it')
  await finalized
  const steps = records.filter((record) => record.type === 'tool_step')
  assert.equal(steps.length, 1)
  assert.equal(steps[0].status, 'failed')
  assert.equal(steps[0].detail, 'BUDINGX_WORKSPACE_001')
})

test('FR-03 工具输出超限时带显式截断标记且不伪造完整结果', async () => {
  const { provider } = scriptProvider([
    [
      {
        type: 'tool_call_delta',
        index: 0,
        callId: 'call-3',
        nameDelta: 'Huge',
        argsDelta: '{}'
      },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ],
    [{ type: 'message_completed', finishReason: 'stop' }]
  ])
  const session = new Session({
    provider,
    approval: approvalGateway(),
    resolveSnapshot: () => SNAPSHOT,
    tools: [
      {
        name: 'Huge',
        summary: 'returns a huge output',
        describe: () => 'returns a huge output',
        async execute() {
          return 'x'.repeat(40000)
        }
      }
    ]
  })
  const toolResult = waitFor(session, (event) => event.type === 'tool_result')
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('run it')
  const result = await toolResult
  assert.equal(result.isError, false)
  assert.ok(result.content.length <= 32768)
  assert.match(result.content, /\[truncated\]/)
  assert.doesNotMatch(result.content, /BUDINGX_CORE_003/)
  await finalized
})

test('CB-01 超出预算时压缩历史并发出 context_compacted 事件', async () => {
  const { provider } = scriptProvider([
    [
      { type: 'text_delta', text: 'ok' },
      { type: 'message_completed', finishReason: 'stop' }
    ]
  ])
  const session = new Session({
    provider,
    approval: approvalGateway(),
    resolveSnapshot: () => SNAPSHOT,
    contextBudget: { maxTokens: 400, reservedOutputTokens: 100 }
  })
  const events = collect(session)
  // Seed a long history so the request is over the trigger threshold
  // (maxTokens 400 - reserved 100 = 300 target, trigger 255).
  session.restoreHistory([
    {
      id: 'm0',
      role: 'user',
      blocks: [{ type: 'text', text: '不要修改配置文件'.repeat(40) }]
    },
    {
      id: 'm1',
      role: 'assistant',
      blocks: [{ type: 'text', text: '好的'.repeat(80) }]
    }
  ])
  const compacted = waitFor(session, (event) => event.type === 'context_compacted')
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('继续')
  const event = await compacted
  assert.equal(event.type, 'context_compacted')
  assert.ok(event.replacedCount >= 1)
  assert.ok(event.preserved.some((item) => item.kind === 'constraint'))
  assert.equal(event.withinBudget, true)
  await finalized
  assert.ok(events.some((entry) => entry.type === 'context_compacted'))
})

test('CB-06 压缩无法达标时发出明确的 context_overflow 提示', async () => {
  const { provider } = scriptProvider([
    [
      { type: 'text_delta', text: 'ok' },
      { type: 'message_completed', finishReason: 'stop' }
    ]
  ])
  const session = new Session({
    provider,
    approval: approvalGateway(),
    resolveSnapshot: () => SNAPSHOT,
    contextBudget: { maxTokens: 100, reservedOutputTokens: 50 }
  })
  // 当前请求本身就是超长单条消息：没有更早的回合可裁剪，压缩必然无法达标。
  const notice = waitFor(
    session,
    (event) => event.type === 'notice' && event.code === 'context_overflow'
  )
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('x'.repeat(5000))
  const event = await notice
  assert.equal(event.level, 'error')
  assert.match(event.text, /single_message_too_large|unknown|compacted/)
  await finalized
})

test('FR-08 模型报告上下文溢出时压缩后重试一次', async () => {
  const { provider, calls } = scriptProvider([
    [
      {
        type: 'failed',
        error: {
          class: 'context_overflow',
          code: 'BUDINGX_PROVIDER_009',
          message: 'too many tokens',
          retryable: false
        }
      }
    ],
    [
      { type: 'text_delta', text: 'ok' },
      { type: 'message_completed', finishReason: 'stop' }
    ]
  ])
  const session = new Session({
    provider,
    approval: approvalGateway(),
    resolveSnapshot: () => SNAPSHOT,
    contextBudget: { maxTokens: 400, reservedOutputTokens: 100 }
  })
  // 历史里有更早的回合可裁剪：模型报告溢出后强制压缩并重试一次。
  session.restoreHistory([
    {
      id: 'm0',
      role: 'user',
      blocks: [{ type: 'text', text: '不要修改配置文件'.repeat(40) }]
    },
    {
      id: 'm1',
      role: 'assistant',
      blocks: [{ type: 'text', text: '好的'.repeat(80) }]
    }
  ])
  const compacted = waitFor(session, (event) => event.type === 'context_compacted')
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('继续')
  const event = await compacted
  assert.ok(event.replacedCount >= 1)
  const done = await finalized
  assert.equal(calls.length, 2)
  assert.equal(done.outcome, 'completed')
})

test('FR-08 上下文溢出且无法压缩时明确失败而不是静默重试', async () => {
  const { provider, calls } = scriptProvider([
    [
      {
        type: 'failed',
        error: {
          class: 'context_overflow',
          code: 'BUDINGX_PROVIDER_009',
          message: 'too many tokens',
          retryable: false
        }
      }
    ]
  ])
  const session = new Session({
    provider,
    approval: approvalGateway(),
    resolveSnapshot: () => SNAPSHOT,
    contextBudget: { maxTokens: 100, reservedOutputTokens: 50 }
  })
  // 当前请求本身超长：压缩无法裁掉它，只能明确失败，不静默重试。
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('x'.repeat(5000))
  const event = await finalized
  assert.equal(event.outcome, 'error')
  assert.equal(event.error.class, 'context_overflow')
  assert.equal(event.error.code, 'BUDINGX_PROVIDER_009')
  assert.equal(calls.length, 1)
})

test('FR-07 转录写入失败不影响本轮业务结果', async () => {
  const { provider } = scriptProvider([
    [
      { type: 'text_delta', text: 'ok' },
      { type: 'message_completed', finishReason: 'stop' }
    ]
  ])
  const session = new Session({
    provider,
    approval: approvalGateway(),
    resolveSnapshot: () => SNAPSHOT,
    transcript: {
      append() {
        throw new Error('disk full')
      },
      read() {
        return { records: [], corruptLines: 0, unsupported: false }
      },
      directory() {
        return '/memory'
      }
    }
  })
  const notice = waitFor(
    session,
    (event) => event.type === 'notice' && event.code === 'storage_write_failed'
  )
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('hi')
  const failure = await notice
  assert.equal(failure.level, 'error')
  assert.match(failure.text, /BUDINGX_STORAGE_005/)
  const event = await finalized
  assert.equal(event.outcome, 'completed')
})

test('SR-10 恢复会话不提升权限档位', () => {
  const modes = []
  const session = new Session({
    provider: scriptProvider([]).provider,
    approval: approvalGateway(),
    resolveSnapshot: () => SNAPSHOT,
    permissionModeCeiling: 'workspace_edit',
    permissionPolicy: {
      decide: () => ({ action: 'allow', reason: 'test' }),
      remember: () => {},
      getMode: () => 'full_access',
      setMode: (mode) => {
        modes.push(mode)
      }
    }
  })
  const applied = session.applyPermissionCeiling('full_access')
  assert.equal(applied, 'workspace_edit')
  assert.deepEqual(modes, ['workspace_edit'])
})

test('SR-06 恢复历史只装载消息，不执行任何工具', () => {
  let executed = 0
  const session = new Session({
    provider: scriptProvider([]).provider,
    approval: approvalGateway(),
    resolveSnapshot: () => SNAPSHOT,
    tools: [
      {
        name: 'Danger',
        summary: 'never runs on restore',
        describe: () => 'never runs on restore',
        async execute() {
          executed++
          return 'ran'
        }
      }
    ]
  })
  session.restoreHistory([
    {
      id: 'm0',
      role: 'user',
      blocks: [{ type: 'text', text: 'do it' }]
    }
  ])
  assert.equal(session.history.length, 1)
  assert.equal(executed, 0)
})
