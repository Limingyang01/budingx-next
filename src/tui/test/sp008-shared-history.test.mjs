// SP008 SH-03：另一进程追加写入时，只读恢复跳过尾部半行、报告完整记录、不回写原文件。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { SessionStore } from '../../tui/dist/storage/session-store.js'

const transcriptUrl = new URL('../../tui/dist/storage/session-transcript.js', import.meta.url).href
const storeUrl = new URL('../../tui/dist/storage/session-store.js', import.meta.url).href
const sessionId = 'shared-history'
const workspaceRoot = resolve('.')

function hashFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function childScript(home) {
  const workspaceId = createHash('sha256').update(workspaceRoot).digest('hex')
  return `
import { appendFileSync } from 'node:fs'
import { createSessionTranscript } from '${transcriptUrl}'
import { SessionWriterLock } from '${storeUrl}'
const lock = new SessionWriterLock('${sessionId}', process.env.HOME)
const acquired = lock.acquire()
if (!acquired.acquired) throw new Error('writer lock not acquired: ' + acquired.reason)
const transcript = createSessionTranscript({ sessionId: '${sessionId}', home: process.env.HOME })
transcript.append({ type: 'session_started', schemaVersion: 1, sessionId: '${sessionId}', workspaceId: '${workspaceId}' })
transcript.append({ type: 'message', id: 'm1', role: 'user', blocks: [{ type: 'text', text: 'one' }] })
transcript.append({ type: 'message', id: 'm2', role: 'assistant', blocks: [{ type: 'text', text: 'two' }] })
const file = transcript.directory() + '/transcript.jsonl'
appendFileSync(file, '{"type":"message","id":"m3","role":"assistant","blocks":[{"type":"text","text":"three')
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700)
appendFileSync(file, '"}]}\\n')
lock.release()
`
}

function waitFor(predicate, timeoutMs = 5000) {
  return new Promise((resolveWait, reject) => {
    const started = Date.now()
    const tick = () => {
      try {
        if (predicate()) return resolveWait()
      } catch {}
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting for the writer'))
      setTimeout(tick, 20)
    }
    tick()
  })
}

test('并发追加期间只读恢复得到完整记录，半行跳过且原文件字节不变', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-shared-history-'))
  const child = spawn(process.execPath, ['--input-type=module', '-e', childScript(home)], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => (stderr += chunk))
  const exited = new Promise((resolveExit) => child.on('exit', (code) => resolveExit(code)))

  const file = join(home, '.budingx', 'sessions', sessionId, 'transcript.jsonl')
  await waitFor(() => readFileSync(file, 'utf8').includes('"m2"'))

  const store = new SessionStore({ home, workspaceRoot })
  const before = hashFile(file)
  const first = store.restore(sessionId)
  assert.equal(first.status, 'restored', first.message)
  assert.equal(first.messages.length, 2)
  assert.equal(first.warnings.some((warning) => warning.includes('could not be read')), false)
  assert.equal(hashFile(file), before, 'restore must not rewrite the transcript')

  assert.equal(await exited, 0, stderr)
  const second = store.restore(sessionId)
  assert.equal(second.status, 'restored', second.message)
  assert.equal(second.messages.length, 3)
  assert.equal(second.warnings.some((warning) => warning.includes('could not be read')), false)
})
