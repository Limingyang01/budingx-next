// SP008 SO-01/SO-03/SH-05：活动会话归属 claim、只读观察与显式接管。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  HostOwnershipError,
  SessionOwnershipRole,
  claimSessionOwnership
} from '../../tui/dist/host/ownership.js'
import { SessionWriterLock } from '../../tui/dist/storage/session-store.js'

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'budingx-ownership-'))
}

test('空闲会话的首次 claim 获得 owner 并持有 writer.lock', () => {
  const home = tempHome()
  const claim = claimSessionOwnership({ sessionId: 's1', home })
  assert.equal(claim.role, 'owner')
  const role = new SessionOwnershipRole(claim)
  assert.equal(role.canWrite(), true)
  role.assertCanWrite()
  assert.equal(role.refresh(), 'owner')
  role.release()
  assert.equal(claim.role === 'owner' ? claim.lock.isOwned : false, false)
})

test('同一进程第二次 claim 得到 observer（活 owner），写入被拒绝', () => {
  const home = tempHome()
  const first = claimSessionOwnership({ sessionId: 's2', home })
  assert.equal(first.role, 'owner')
  const second = claimSessionOwnership({ sessionId: 's2', home })
  assert.equal(second.role, 'observer')
  assert.equal(second.reason, 'active_owner')
  const role = new SessionOwnershipRole(second)
  assert.equal(role.canWrite(), false)
  assert.throws(() => role.assertCanWrite(), (error) => {
    assert.equal(error.code, 'HOST_SESSION_003')
    return error instanceof HostOwnershipError
  })
})

test('陈旧锁得到 observer(stale)，takeover 后成为 owner', () => {
  const home = tempHome()
  const probe = new SessionWriterLock('s3', home)
  probe.acquire()
  probe.release()
  writeFileSync(probe.path, '999999\n2026-01-01T00:00:00.000Z\n')

  const claim = claimSessionOwnership({ sessionId: 's3', home })
  assert.equal(claim.role, 'observer')
  assert.equal(claim.reason, 'stale_lock')
  const role = new SessionOwnershipRole(claim)
  role.takeover()
  assert.equal(role.refresh(), 'owner')
  assert.equal(role.canWrite(), true)
  role.release()
})

test('活 owner（真实子进程）拒绝 takeover 并保持锁不变', async () => {
  const home = tempHome()
  const lockUrl = new URL('../../tui/dist/storage/session-store.js', import.meta.url).href
  const script = `
import { SessionWriterLock } from '${lockUrl}'
const lock = new SessionWriterLock('s4', process.env.HOME)
const result = lock.acquire()
if (!result.acquired) { console.error(result.reason); process.exit(2) }
process.stdout.write('locked\\n')
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000)
lock.release()
`
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let out = ''
  child.stdout.on('data', (chunk) => (out += chunk))
  await new Promise((resolveReady, reject) => {
    const started = Date.now()
    const tick = () => {
      if (out.includes('locked')) return resolveReady()
      if (Date.now() - started > 5000) return reject(new Error('child did not lock in time'))
      setTimeout(tick, 20)
    }
    tick()
  })

  const claim = claimSessionOwnership({ sessionId: 's4', home })
  assert.equal(claim.role, 'observer')
  assert.equal(claim.reason, 'active_owner')
  const role = new SessionOwnershipRole(claim)
  assert.throws(() => role.takeover(), (error) => {
    assert.equal(error.code, 'HOST_SESSION_003')
    return error instanceof HostOwnershipError
  })
  assert.equal(role.refresh(), 'observer')
  child.kill()
  await new Promise((resolveExit) => child.on('exit', resolveExit))
})
