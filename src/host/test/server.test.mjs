// SP008 SO-01/SO-02/SO-03/SO-04、TB-02/03/04：宿主服务的角色、路由、事件与关闭。
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { HostServer } from '../../tui/dist/host/server.js'
import { SessionOwnershipRole, claimSessionOwnership } from '../../tui/dist/host/ownership.js'
import { SessionStore } from '../../tui/dist/storage/session-store.js'
import { SessionWriterLock } from '../../tui/dist/storage/session-store.js'

const sessionId = 'srv-session'
const workspaceRoot = resolve('.')

function fakeEngine() {
  const listeners = new Set()
  const calls = { submit: [], interrupt: 0, approvals: [], modes: [], disposed: 0 }
  let permissionMode = 'workspace_edit'
  return {
    calls,
    describe: () => ({
      sessionId,
      workspaceId: 'w1',
      title: 'fixture',
      state: 'idle',
      planMode: false,
      permissionMode
    }),
    history: (limit) => {
      const all = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]
      const messages = limit === undefined ? all : all.slice(Math.max(0, all.length - limit))
      return { messages, truncated: limit !== undefined && limit < all.length }
    },
    submit(text) {
      calls.submit.push(text)
    },
    interrupt() {
      calls.interrupt += 1
      return true
    },
    approve(requestId, outcome) {
      calls.approvals.push([requestId, outcome])
      return requestId === 'approval-1'
    },
    setPermissionMode(mode) {
      calls.modes.push(mode)
      permissionMode = mode
      return true
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async dispose() {
      calls.disposed += 1
    },
    emit(event) {
      for (const listener of listeners) listener(event)
    }
  }
}

function createPeer() {
  const sent = []
  let lineHandler = () => {}
  let closeHandler = () => {}
  let closed = false
  const connection = {
    send(text) {
      sent.push(text)
    },
    close() {
      closed = true
      closeHandler()
    },
    onLine(handler) {
      lineHandler = handler
    },
    onClose(handler) {
      closeHandler = handler
    }
  }
  return {
    connection,
    send(frame) {
      lineHandler(JSON.stringify(frame))
    },
    frames() {
      return sent
        .join('')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line))
    },
    closed() {
      return closed
    }
  }
}

function setup(options = {}) {
  const home = mkdtempSync(join(tmpdir(), 'budingx-host-server-'))
  const engine = options.engine === null ? undefined : fakeEngine()
  const claim = claimSessionOwnership({ sessionId, home })
  const ownership = new SessionOwnershipRole(claim)
  const store = new SessionStore({ home, workspaceRoot })
  let shutdowns = 0
  const server = new HostServer({
    sessionId,
    workspaceId: 'w1',
    ownership,
    ...(engine ? { engine } : {}),
    sessionStore: store,
    onShutdown: () => {
      shutdowns += 1
    }
  })
  return { home, server, engine, ownership, store, shutdowns: () => shutdowns }
}

async function hello(server, peer, version = 1) {
  const connection = peer.connection
  server.attach(connection)
  peer.send({ id: 'hello-1', type: 'hello', version, clientId: 'c1' })
  await Promise.resolve()
  return peer.frames().at(-1)
}

test('hello 返回 hello_ok，首个客户端 owner，第二个客户端 observer', async () => {
  const { server } = setup()
  const first = createPeer()
  const reply = await hello(server, first)
  assert.equal(reply.ok, true)
  assert.equal(reply.result.type, 'hello_ok')
  assert.equal(reply.result.protocolVersion, 1)
  assert.equal(reply.result.scope, 'local')
  assert.equal(reply.result.role, 'owner')
  assert.equal(reply.result.sessionId, sessionId)

  const second = createPeer()
  server.attach(second.connection)
  second.send({ id: 'h2', type: 'hello', version: 1 })
  const secondReply = second.frames().at(-1)
  assert.equal(secondReply.result.role, 'observer')
  assert.equal(secondReply.result.clientId, 'client-1')
})

test('observer 的写请求全部拒绝，读请求可用', async () => {
  const { server, engine } = setup()
  const owner = createPeer()
  await hello(server, owner)
  const observer = createPeer()
  server.attach(observer.connection)
  observer.send({ id: 'h2', type: 'hello', version: 1 })
  observer.frames().length = 0

  observer.send({ id: 'w1', type: 'submit', text: 'hi' })
  assert.equal(observer.frames().at(-1).error.code, 'HOST_SESSION_003')
  observer.send({ id: 'w2', type: 'set_permission_mode', mode: 'full_access' })
  assert.equal(observer.frames().at(-1).error.code, 'HOST_SESSION_003')
  observer.send({ id: 'r1', type: 'history', limit: 2 })
  const history = observer.frames().at(-1)
  assert.equal(history.ok, true)
  assert.equal(history.result.messages.length, 2)
  assert.equal(history.result.truncated, true)
  observer.send({ id: 'r2', type: 'ping' })
  assert.deepEqual(observer.frames().at(-1).result, { pong: true })
  assert.equal(engine.calls.submit.length, 0)
})

test('未 hello 的请求返回 HOST_AUTH_004', async () => {
  const { server } = setup()
  const peer = createPeer()
  server.attach(peer.connection)
  peer.send({ id: 'x', type: 'submit', text: 'hi' })
  assert.equal(peer.frames().at(-1).error.code, 'HOST_AUTH_004')
})

test('owner 可提交、打断、审批与切换权限；未知审批返回 HOST_STATE_006', async () => {
  const { server, engine } = setup()
  const owner = createPeer()
  await hello(server, owner)
  owner.frames().length = 0

  owner.send({ id: 'a', type: 'submit', text: 'hello' })
  assert.deepEqual(owner.frames().at(-1).result, { accepted: true })
  owner.send({ id: 'b', type: 'interrupt' })
  assert.deepEqual(owner.frames().at(-1).result, { interrupted: true })
  owner.send({ id: 'c', type: 'approval', requestId: 'unknown', outcome: 'allow' })
  assert.equal(owner.frames().at(-1).error.code, 'HOST_STATE_006')
  owner.send({ id: 'd', type: 'approval', requestId: 'approval-1', outcome: 'deny' })
  assert.deepEqual(owner.frames().at(-1).result, { accepted: true })
  owner.send({ id: 'e', type: 'set_permission_mode', mode: 'read_only' })
  assert.deepEqual(owner.frames().at(-1).result, { mode: 'read_only' })
  owner.send({ id: 'f', type: 'describe' })
  const describe = owner.frames().at(-1).result
  assert.equal(describe.role, 'owner')
  assert.equal(describe.scope, 'local')
  assert.equal(describe.permissionMode, 'read_only')

  assert.deepEqual(engine.calls.submit, ['hello'])
  assert.equal(engine.calls.interrupt, 1)
  assert.deepEqual(engine.calls.approvals, [
    ['unknown', 'allow'],
    ['approval-1', 'deny']
  ])
  assert.deepEqual(engine.calls.modes, ['read_only'])
})

test('畸形帧、未知类型与重复 id 返回稳定错误码且不断连', async () => {
  const { server } = setup()
  const owner = createPeer()
  await hello(server, owner)
  owner.frames().length = 0

  owner.send('{oops')
  const malformed = owner.frames().at(-1)
  assert.equal(malformed.error.code, 'HOST_PROTOCOL_002')
  assert.equal(malformed.id, '')

  owner.send({ id: 'u1', type: 'drop_database' })
  assert.equal(owner.frames().at(-1).error.code, 'HOST_STATE_006')

  owner.send({ id: 'dup', type: 'ping' })
  owner.send({ id: 'dup', type: 'ping' })
  assert.equal(owner.frames().at(-1).error.code, 'HOST_PROTOCOL_002')
  assert.equal(owner.closed(), false)

  owner.send({ id: 'later', type: 'ping' })
  assert.deepEqual(owner.frames().at(-1).result, { pong: true })
})

test('observer takeover 升级为 owner，原 owner 收到 role_changed 并降级', async () => {
  const { server, engine } = setup()
  const first = createPeer()
  await hello(server, first)
  const second = createPeer()
  server.attach(second.connection)
  second.send({ id: 'h2', type: 'hello', version: 1 })
  first.frames().length = 0
  second.frames().length = 0

  second.send({ id: 't1', type: 'takeover' })
  assert.deepEqual(second.frames().find((frame) => frame.id === 't1').result, { role: 'owner' })
  assert.ok(first.frames().some((frame) => frame.type === 'role_changed' && frame.role === 'observer'))
  first.send({ id: 'a', type: 'submit', text: 'from old owner' })
  assert.equal(first.frames().at(-1).error.code, 'HOST_SESSION_003')
  second.send({ id: 'b', type: 'submit', text: 'from new owner' })
  assert.deepEqual(second.frames().find((frame) => frame.id === 'b').result, { accepted: true })
  assert.deepEqual(engine.calls.submit, ['from new owner'])
})

test('引擎事件按 seq 广播给所有已 hello 的客户端', async () => {
  const { server, engine } = setup()
  const owner = createPeer()
  await hello(server, owner)
  const observer = createPeer()
  server.attach(observer.connection)
  observer.send({ id: 'h2', type: 'hello', version: 1 })
  owner.frames().length = 0
  observer.frames().length = 0

  engine.emit({ type: 'status', state: 'idle' })
  engine.emit({ type: 'text_delta', turnId: 't', messageId: 'm', text: 'hi' })
  for (const peer of [owner, observer]) {
    const events = peer.frames().filter((frame) => frame.type === 'event')
    assert.equal(events.length, 2)
    assert.deepEqual(events.map((frame) => frame.seq), [1, 2])
    assert.equal(events[0].event.type, 'status')
  }
})

test('shutdown 释放写锁、关闭连接并 dispose 引擎', async () => {
  const { server, engine, ownership, shutdowns } = setup()
  const owner = createPeer()
  await hello(server, owner)
  const lockPath = ownership.lockPath
  assert.equal(existsSync(lockPath), true)

  owner.send({ id: 's', type: 'shutdown' })
  assert.deepEqual(owner.frames().at(-1).result, { stopping: true })
  await new Promise((resolveTick) => setTimeout(resolveTick, 20))
  assert.equal(server.clientCount, 0)
  assert.equal(owner.closed(), true)
  assert.equal(existsSync(lockPath), false)
  assert.equal(engine.calls.disposed, 1)
  assert.equal(shutdowns(), 1)
})

test('无引擎的 observer 服务从磁盘恢复历史，describe 标记 unknown 与只读', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-host-observer-'))
  // 制造陈旧锁，让本次 claim 成为 observer。
  const probe = new SessionWriterLock(sessionId, home)
  probe.acquire()
  probe.release()
  writeFileSync(probe.path, '999999\n2026-01-01T00:00:00.000Z\n')

  const store = new SessionStore({ home, workspaceRoot })
  const { transcript } = await import('../../tui/dist/storage/session-store.js').then((module) =>
    module.startSession({ sessionId, home, workspaceRoot })
  )
  transcript.append({ type: 'message', id: 'm1', role: 'user', blocks: [{ type: 'text', text: 'one' }] })

  const claim = claimSessionOwnership({ sessionId, home })
  assert.equal(claim.role, 'observer')
  const server = new HostServer({
    sessionId,
    workspaceId: 'w1',
    ownership: new SessionOwnershipRole(claim),
    sessionStore: store
  })
  const peer = createPeer()
  server.attach(peer.connection)
  peer.send({ id: 'h', type: 'hello', version: 1 })
  assert.equal(peer.frames().at(-1).result.role, 'observer')
  peer.frames().length = 0

  peer.send({ id: 'd', type: 'describe' })
  const describe = peer.frames().at(-1).result
  assert.equal(describe.state, 'unknown')
  assert.equal(describe.permissionMode, 'read_only')

  peer.send({ id: 'h1', type: 'history' })
  const history = peer.frames().at(-1).result
  assert.equal(history.messages.length, 1)
  assert.equal(history.messages[0].id, 'm1')

  peer.send({ id: 's', type: 'submit', text: 'nope' })
  assert.equal(peer.frames().at(-1).error.code, 'HOST_SESSION_003')
})
