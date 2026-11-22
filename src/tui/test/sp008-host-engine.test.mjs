// SP008 T9：AgentRuntime → HostEngine 适配与审批桥。
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { ConfigStore } from '../dist/storage/config-store.js'
import { createAgentRuntime } from '../dist/tui/runtime.js'
import { HostApprovalGateway, createHostEngine } from '../dist/tui/host-engine.js'

async function fixtureServer(t) {
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) {
      // drain
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(
      'data: {"choices":[{"delta":{"content":"pong"}}]}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
        'data: [DONE]\n\n'
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  return 'http://127.0.0.1:' + server.address().port + '/v1'
}

function createEngine(baseUrl, t) {
  const home = mkdtempSync(join(tmpdir(), 'budingx-host-engine-'))
  const configStore = new ConfigStore(join(home, 'config.json'))
  const gateway = new HostApprovalGateway()
  const runtime = createAgentRuntime({
    cwd: resolve('.'),
    home,
    configStore,
    mode: 'workspace_edit',
    getConfig: () => ({
      baseUrl,
      model: 'fixture',
      apiKey: 'fixture-key',
      timeoutMs: 5000,
      source: 'file'
    }),
    approval: gateway
  })
  t.after(() => runtime.session.dispose())
  const engine = createHostEngine({ runtime, workspaceId: 'workspace-1', gateway })
  return { engine, gateway, runtime }
}

function finalized(engine) {
  return new Promise((resolveTurn) => {
    const off = engine.onEvent((event) => {
      if (event.type === 'turn_finalized') {
        off()
        resolveTurn(event)
      }
    })
  })
}

test('describe 暴露会话、工作区、状态与权限档位', async (t) => {
  const baseUrl = await fixtureServer(t)
  const { engine } = createEngine(baseUrl, t)
  const description = engine.describe()
  assert.equal(description.sessionId, engine.describe().sessionId)
  assert.equal(description.workspaceId, 'workspace-1')
  assert.equal(description.state, 'idle')
  assert.equal(description.planMode, false)
  assert.equal(description.permissionMode, 'workspace_edit')
})

test('submit 走真实 Session 回合，事件与历史随后可读取', async (t) => {
  const baseUrl = await fixtureServer(t)
  const { engine } = createEngine(baseUrl, t)
  const events = []
  const off = engine.onEvent((event) => events.push(event))
  const finished = finalized(engine)
  engine.submit('hello')
  const result = await finished
  off()
  assert.equal(result.outcome, 'completed')
  assert.ok(events.some((event) => event.type === 'text_delta'))
  const history = engine.history()
  assert.ok(history.messages.length >= 2)
  assert.equal(history.messages.at(-1).role, 'assistant')
  const limited = engine.history(1)
  assert.equal(limited.messages.length, 1)
  assert.equal(limited.truncated, true)
})

test('审批桥一次生效、未知请求返回 false、超时按策略拒绝', async (t) => {
  const baseUrl = await fixtureServer(t)
  const { engine, gateway } = createEngine(baseUrl, t)
  const request = {
    requestId: 'approval-1',
    turnId: 'turn-1',
    callId: 'call-1',
    name: 'Bash',
    summary: 'run echo'
  }
  const decided = gateway.request(request)
  assert.equal(engine.approve('approval-1', 'allow'), true)
  assert.deepEqual(await decided, { outcome: 'allow', via: 'user' })
  assert.equal(engine.approve('approval-1', 'deny'), false)
  assert.equal(engine.approve('missing', 'deny'), false)

  const short = new HostApprovalGateway(20)
  const timedOut = await short.request({ ...request, requestId: 'approval-2' })
  assert.deepEqual(timedOut, { outcome: 'deny', via: 'policy' })
  assert.equal(short.pendingCount, 0)
})

test('dispose 取消挂起审批并清理会话', async (t) => {
  const baseUrl = await fixtureServer(t)
  const { engine, gateway } = createEngine(baseUrl, t)
  const pending = gateway.request({
    requestId: 'approval-3',
    turnId: 'turn-1',
    callId: 'call-1',
    name: 'Bash',
    summary: 'run echo'
  })
  await engine.dispose()
  assert.deepEqual(await pending, { outcome: 'cancelled', via: 'policy' })
  assert.equal(gateway.pendingCount, 0)
})
