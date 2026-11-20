// SP005 复审回归：写入锁互斥、锁归属、记忆往返与凭据误判。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { SessionWriterLock } from '../../tui/dist/storage/session-store.js'
import {
  containsCredential,
  createProjectMemory
} from '../../tui/dist/storage/project-memory.js'
import { writeJsonAtomic, writeTextAtomic } from '../../tui/dist/storage/atomic.js'

const LOCK_CHILD = `
const { SessionWriterLock } = await import(process.env.LOCK_MODULE)
const lock = new SessionWriterLock('s1', process.env.LOCK_HOME)
const result = lock.acquire()
process.stdout.write(JSON.stringify({ pid: process.pid, acquired: result.acquired }))
`

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'budingx-review-storage-'))
}

function acquireInChild(moduleUrl, home) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', LOCK_CHILD], {
      env: { ...process.env, LOCK_MODULE: moduleUrl, LOCK_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`lock child exited ${code}: ${err}`))
        return
      }
      try {
        resolve(JSON.parse(out))
      } catch {
        reject(new Error(`unexpected lock child output: ${out} ${err}`))
      }
    })
  })
}

test('SR-11 写入锁在并发进程间真正互斥（排他创建，不允许两个进程同时持锁）', async () => {
  const home = tempHome()
  const moduleUrl = new URL('../../tui/dist/storage/session-store.js', import.meta.url).href
  const results = await Promise.all(
    Array.from({ length: 6 }, () => acquireInChild(moduleUrl, home))
  )
  const winners = results.filter((entry) => entry.acquired)
  assert.equal(
    winners.length,
    1,
    `exactly one process may hold the lock, got ${winners.length}: ${JSON.stringify(results)}`
  )
})

test('SR-11 非持有者 release 不会删除别人的锁', () => {
  const home = tempHome()
  const first = new SessionWriterLock('s1', home)
  const second = new SessionWriterLock('s1', home)
  assert.equal(first.acquire().acquired, true)
  assert.equal(second.acquire().acquired, false)
  // A process that never held the lock must not remove it.
  second.release()
  assert.equal(existsSync(first.path), true)
  const third = new SessionWriterLock('s1', home)
  assert.equal(third.acquire().acquired, false)
  first.release()
  assert.equal(existsSync(first.path), false)
})

test('SR-11 陈旧锁需要显式 force 才会被接管', () => {
  const home = tempHome()
  const lock = new SessionWriterLock('s1', home)
  mkdirSync(dirname(lock.path), { recursive: true })
  writeFileSync(lock.path, '999999\n2026-01-01T00:00:00.000Z\n')
  const blocked = new SessionWriterLock('s1', home)
  const refused = blocked.acquire()
  assert.equal(refused.acquired, false)
  assert.match(refused.reason, /stale lock/)
  assert.equal(blocked.acquire({ force: true }).acquired, true)
})

test('H3 正文里的 Markdown 标题不会截断条目或伪造新条目', () => {
  const memory = createProjectMemory({ home: tempHome(), projectRoot: '/workspace/notes' })
  const body = 'intro text\n## Section Two\nmore text\n- created: not metadata\n- scope: session'
  assert.equal(memory.write('My note', body).ok, true)
  const read = memory.read()
  assert.equal(read.corrupt, false)
  assert.equal(read.entries.length, 1)
  assert.equal(read.entries[0].title, 'My note')
  assert.equal(read.entries[0].body, body)
})

test('H3 标题里的换行不能伪造条目', () => {
  const memory = createProjectMemory({ home: tempHome(), projectRoot: '/workspace/title' })
  assert.equal(memory.write('evil\n## injected · title', 'body').ok, true)
  const read = memory.read()
  assert.equal(read.entries.length, 1)
  assert.equal(read.entries[0].title.includes('\n'), false)
})

test('PM-05 凭据检测拒绝真密钥但不误拒正常笔记', () => {
  const allowed = [
    'password: none',
    'api_key = variable',
    'token: not configured',
    'access_token: <redacted>',
    'client_secret: $CI_SECRET',
    'secret: see README',
    'secret_key: rotated monthly',
    'authorization: Bearer needed',
    'a normal note about the build'
  ]
  for (const text of allowed) {
    assert.equal(containsCredential(text), false, `must allow: ${text}`)
  }
  const rejected = [
    'password: hunter2xyz123',
    'api_key = sk-abcdefgh12345678',
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'Bearer abcdefghijkl',
    '-----BEGIN RSA PRIVATE KEY-----'
  ]
  for (const text of rejected) {
    assert.equal(containsCredential(text), true, `must reject: ${text}`)
  }
})

test('PM-06 真正损坏的记忆文件报损坏、保留原件并旁存 .bak', () => {
  const memory = createProjectMemory({ home: tempHome(), projectRoot: '/workspace/corrupt' })
  mkdirSync(dirname(memory.path), { recursive: true })
  const garbage = 'total garbage not a memory file\n\u0000 binary noise\n'
  writeFileSync(memory.path, garbage)
  const read = memory.read()
  assert.equal(read.corrupt, true)
  assert.match(read.corruptReason, /no readable entries/)
  // The original is never erased and a copy is kept next to it.
  assert.equal(readFileSync(memory.path, 'utf8'), garbage)
  assert.equal(existsSync(`${memory.path}.bak`), true)
  assert.equal(readFileSync(`${memory.path}.bak`, 'utf8'), garbage)
  // Writing into a corrupt file is refused instead of silently dropping notes.
  assert.equal(memory.write('after', 'body').code, 'memoryCorrupt')
})

test('H4 原子写先收紧临时文件权限再改名', { skip: process.platform === 'win32' }, () => {
  const home = tempHome()
  const jsonFile = join(home, 'private', 'data.json')
  writeJsonAtomic(jsonFile, { ok: true })
  assert.equal(statSync(jsonFile).mode & 0o777, 0o600)
  const textFile = join(home, 'private', 'data.md')
  writeTextAtomic(textFile, 'note')
  assert.equal(statSync(textFile).mode & 0o777, 0o600)
})
