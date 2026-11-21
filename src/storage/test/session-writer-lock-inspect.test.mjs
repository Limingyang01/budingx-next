// SP008 SO-01/SO-03：写锁可被无副作用地检查（pid/创建时间/是否活跃），不解析提示文案。
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  SessionWriterLock,
  inspectWriterLock
} from '../../tui/dist/storage/session-store.js'

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'budingx-writer-lock-'))
}

test('没有锁文件时 inspect 报告不活跃且不创建文件', () => {
  const home = tempHome()
  const lock = new SessionWriterLock('s1', home)
  const info = lock.inspect()
  assert.equal(info.active, false)
  assert.equal(info.pid, undefined)
  assert.equal(inspectWriterLock('s1', home).active, false)
})

test('活进程持有的锁报告 pid、创建时间与 active=true', () => {
  const home = tempHome()
  const lock = new SessionWriterLock('s2', home)
  const acquired = lock.acquire()
  assert.equal(acquired.acquired, true)
  const info = lock.inspect()
  assert.equal(info.active, true)
  assert.equal(info.pid, process.pid)
  assert.ok(typeof info.createdAt === 'string' && info.createdAt.length > 0)
  assert.equal(inspectWriterLock('s2', home).pid, process.pid)
  lock.release()
  assert.equal(lock.inspect().active, false)
})

test('陈旧 pid 的锁报告 active=false 且不删除锁文件', () => {
  const home = tempHome()
  const lock = new SessionWriterLock('s3', home)
  // 先创建目录，再手工放入崩溃进程的锁。
  assert.equal(lock.acquire().acquired, true)
  lock.release()
  const file = lock.path
  writeFileSync(file, '999999\n2026-01-01T00:00:00.000Z\n')
  const info = lock.inspect()
  assert.equal(info.active, false)
  assert.equal(info.pid, 999999)
  assert.equal(info.createdAt, '2026-01-01T00:00:00.000Z')
})
