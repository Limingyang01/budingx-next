// SP003 核心权限契约用例（plan T9：PC-01 通道、PC-06/PC-10、FC-04）。
// 验证 Session 与 PermissionPolicy/审批三档/上下文块/变更事件的接线；
// 具体三模式判定在 src/workspace/test/policy.test.mjs 覆盖。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Session } from '../../tui/dist/core/session.js'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: true }
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

function toolTurn(name, args) {
  return [
    [
      {
        type: 'tool_call_delta',
        index: 0,
        callId: 'call_1',
        nameDelta: name,
        argsDelta: JSON.stringify(args)
      },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ],
    [{ type: 'message_completed', finishReason: 'stop' }]
  ]
}

function approvalGateway(decision) {
  const requests = []
  return {
    requests,
    gateway: {
      async request(request) {
        requests.push(request)
        return decision
      }
    }
  }
}

function fakePolicy(verdict, options = {}) {
  const remembered = []
  const listeners = []
  return {
    remembered,
    policy: {
      decide: () => verdict,
      remember: (request) => remembered.push(request),
      getMode: () => options.mode ?? 'workspace_edit',
      setMode: (mode) => {
        options.mode = mode
        for (const listener of listeners) listener(mode)
      },
      onModeChanged: (listener) => listeners.push(listener)
    }
  }
}

function writeHandler(executed) {
  return {
    name: 'Write',
    summary: 'Write a file',
    describe: (input) => `write ${input.path}`,
    capability: () => 'write',
    target: (input) => ({ path: input.path, kind: 'file' }),
    async execute(input, context) {
      executed.push(input)
      if (context.changes) {
        context.changes([
          {
            id: 'c-1',
            path: input.path,
            operation: 'update',
            additions: 1,
            removals: 0,
            at: new Date().toISOString()
          }
        ])
      }
      return `wrote ${input.path}`
    }
  }
}

function buildSession(provider, extra) {
  const executed = []
  const session = new Session({
    provider,
    approval: approvalGateway({ outcome: 'allow', via: 'user' }).gateway,
    resolveSnapshot: () => SNAPSHOT,
    tools: [writeHandler(executed)],
    ...extra
  })
  return { session, executed }
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

test('策略 deny 时工具不执行、回错误结果并发拒绝事件，回合继续收敛', async () => {
  const { provider, calls } = scriptProvider(toolTurn('Write', { path: 'a.txt' }))
  const { policy } = fakePolicy({ action: 'deny', reason: '模式只读' })
  const { session, executed } = buildSession(provider, { permissionPolicy: policy })
  const denial = waitFor(session, (event) => event.type === 'denial_recorded')
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('write it')
  const denialEvent = await denial
  assert.equal(denialEvent.denial.tool, 'Write')
  assert.equal(denialEvent.denial.path, 'a.txt')
  const final = await finalized
  assert.equal(final.outcome, 'completed')
  assert.equal(executed.length, 0)
  // 第二次请求里模型看到的是被拒绝的工具结果，会话没有中断。
  const toolMessage = calls[1].messages.find((message) => message.role === 'tool')
  assert.match(toolMessage.content, /Denied: 模式只读/)
})

test('策略 ask 时进入审批；选择"本会话记住"会调用 remember 并执行工具', async () => {
  const { provider } = scriptProvider(toolTurn('Write', { path: 'a.txt' }))
  const { policy, remembered } = fakePolicy({ action: 'ask', reason: '需要确认' })
  const gateway = approvalGateway({ outcome: 'allow_session', via: 'user' })
  const { session, executed } = buildSession(provider, {
    permissionPolicy: policy,
    approval: gateway.gateway
  })
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('write it')
  await finalized
  assert.equal(gateway.requests.length, 1)
  assert.equal(remembered.length, 1)
  assert.equal(remembered[0].path, 'a.txt')
  assert.equal(executed.length, 1)
})

test('策略 allow 时跳过审批直接执行，并由 ToolContext.changes 发出 change_set', async () => {
  const { provider } = scriptProvider(toolTurn('Write', { path: 'a.txt' }))
  const { policy } = fakePolicy({ action: 'allow', reason: '完全权限' })
  const gateway = approvalGateway({ outcome: 'deny', via: 'user' })
  const { session, executed } = buildSession(provider, {
    permissionPolicy: policy,
    approval: gateway.gateway
  })
  const changes = waitFor(session, (event) => event.type === 'change_set')
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('write it')
  const changeEvent = await changes
  await finalized
  assert.equal(gateway.requests.length, 0)
  assert.equal(executed.length, 1)
  assert.equal(changeEvent.changes[0].path, 'a.txt')
})

test('无策略时保持 SP002 行为：requiresApproval 仍然生效', async () => {
  const { provider } = scriptProvider(toolTurn('Write', { path: 'a.txt' }))
  const executed = []
  const gateway = approvalGateway({ outcome: 'deny', via: 'user' })
  const session = new Session({
    provider,
    approval: gateway.gateway,
    resolveSnapshot: () => SNAPSHOT,
    tools: [
      {
        name: 'Write',
        describe: () => 'write',
        requiresApproval: () => true,
        async execute() {
          executed.push(1)
          return 'no'
        }
      }
    ]
  })
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('write it')
  await finalized
  assert.equal(gateway.requests.length, 1)
  assert.equal(executed.length, 0)
})

test('submit 的 @ 上下文块包成 file_context 且与用户原话分离', async () => {
  const { provider, calls } = scriptProvider([
    [{ type: 'message_completed', finishReason: 'stop' }]
  ])
  const { session } = buildSession(provider, {})
  const finalized = waitFor(session, (event) => event.type === 'turn_finalized')
  session.submit('解释这个文件', {
    context: [{ source: 'src/a.ts', content: 'export const a = 1' }]
  })
  await finalized
  const user = calls[0].messages.find((message) => message.role === 'user')
  assert.match(user.content, /^<file_context source="src\/a\.ts">/)
  assert.match(user.content, /<\/file_context>\n\n解释这个文件$/)
})

test('permissionPolicy 模式变更通过 permission_changed 事件可见', async () => {
  const { provider } = scriptProvider([[{ type: 'message_completed', finishReason: 'stop' }]])
  const { policy } = fakePolicy({ action: 'allow', reason: 'ok' }, { mode: 'read_only' })
  const { session } = buildSession(provider, { permissionPolicy: policy })
  const changed = waitFor(session, (event) => event.type === 'permission_changed')
  policy.setMode('full_access')
  const event = await changed
  assert.equal(event.mode, 'full_access')
  session.dispose()
})
