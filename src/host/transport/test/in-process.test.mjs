// SP008 TB-01/TB-02：进程内传输能完成 hello 往返、事件广播与关闭清理。
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { SessionOwnershipRole, claimSessionOwnership } from '../../../tui/dist/host/ownership.js'
import { HostServer } from '../../../tui/dist/host/server.js'
import { connectInProcess } from '../../../tui/dist/host/transport/in-process.js'
import { SessionStore } from '../../../tui/dist/storage/session-store.js'

const sessionId = 'inproc-session'

function createServer() {
  const home = mkdtempSync(join(tmpdir(), 'budingx-host-inproc-'))
  const listeners = new Set()
  const calls = []
  const engine = {
    describe: () => ({
      sessionId,
      workspaceId: 'w1',
      title: 'in-process',
      state: 'idle',
      planMode: false,
      permissionMode: 'workspace_edit'
    }),
    history: () => ({ messages: [], truncated: false }),
    submit(text) {
      calls.push(text)
    },
    interrupt: () => true,
    approve: () => true,
    setPermissionMode: () => true,
    onEvent(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async dispose() {},
    emit(event) {
      for (const listener of listeners) listener(event)
    }
  }
  const ownership = new SessionOwnershipRole(claimSessionOwnership({ sessionId, home }))
  const server = new HostServer({
    sessionId,
    workspaceId: 'w1',
    ownership,
    engine,
    sessionStore: new SessionStore({ home, workspaceRoot: resolve('.') })
  })
  return { server, engine, calls }
}

function collect(transport) {
  const lines = []
  transport.onLine((line) => lines.push(JSON.parse(line)))
  return lines
}

async function settle() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

test('进程内传输完成 hello、写请求与事件广播', async () => {
  const { server, engine, calls } = createServer()
  const owner = connectInProcess(server)
  const ownerLines = collect(owner)
  owner.write(JSON.stringify({ id: 'h1', type: 'hello', version: 1, clientId: 'in-proc' }) + '\n')
  await settle()
  assert.equal(ownerLines[0].result.type, 'hello_ok')
  assert.equal(ownerLines[0].result.role, 'owner')
  assert.equal(ownerLines[0].result.scope, 'local')

  const observer = connectInProcess(server)
  const observerLines = collect(observer)
  observer.write(JSON.stringify({ id: 'h2', type: 'hello', version: 1 }) + '\n')
  await settle()
  assert.equal(observerLines[0].result.role, 'observer')

  owner.write(JSON.stringify({ id: 's1', type: 'submit', text: 'in process' }) + '\n')
  await settle()
  assert.deepEqual(calls, ['in process'])

  engine.emit({ type: 'status', state: 'idle' })
  await settle()
  assert.equal(ownerLines.at(-1).type, 'event')
  assert.equal(observerLines.at(-1).type, 'event')
  assert.equal(ownerLines.at(-1).seq, 1)
  assert.equal(observerLines.at(-1).seq, 1)
})

test('客户端主动关闭会从服务端移除连接，且不再投递帧', async () => {
  const { server } = createServer()
  const transport = connectInProcess(server)
  const lines = collect(transport)
  transport.write(JSON.stringify({ id: 'h', type: 'hello', version: 1 }) + '\n')
  await settle()
  assert.equal(server.clientCount, 1)
  transport.close('done')
  await settle()
  assert.equal(server.clientCount, 0)
  transport.write(JSON.stringify({ id: 'p', type: 'ping' }) + '\n')
  await settle()
  assert.equal(lines.length, 1)
})

test('服务端 shutdown 触发客户端关闭通知', async () => {
  const { server } = createServer()
  const transport = connectInProcess(server)
  collect(transport)
  let closed = false
  transport.onClose(() => {
    closed = true
  })
  transport.write(JSON.stringify({ id: 'h', type: 'hello', version: 1 }) + '\n')
  await settle()
  await server.shutdown()
  await settle()
  assert.equal(closed, true)
  assert.equal(server.clientCount, 0)
})
