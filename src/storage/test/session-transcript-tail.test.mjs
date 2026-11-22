// SP008 SH-03：并发追加时尾部半行不被计为损坏，也不改写原文件（先 RED）。
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createSessionTranscript } from '../../tui/dist/storage/session-transcript.js'

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'budingx-transcript-tail-'))
}

test('正在追加的尾部半行被跳过且不计 corruptLines，原文件保持不变', () => {
  const home = tempHome()
  const transcript = createSessionTranscript({ sessionId: 's1', home })
  transcript.append({ type: 'message', message: { role: 'user', content: 'one' } })
  transcript.append({ type: 'message', message: { role: 'assistant', content: 'two' } })

  const file = join(transcript.directory(), 'transcript.jsonl')
  // 活写者锁：本进程仍存活，半行才被视为正在追加。
  writeFileSync(join(transcript.directory(), 'writer.lock'), `${process.pid}\n${new Date().toISOString()}\n`)
  appendFileSync(file, '{"type":"message","message":{"role":"user","con')
  const before = readFileSync(file, 'utf8')

  const read = transcript.read()
  assert.equal(read.records.length, 2)
  assert.equal(read.corruptLines, 0)
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('以换行结束的完整坏行仍然计入 corruptLines', () => {
  const home = tempHome()
  const transcript = createSessionTranscript({ sessionId: 's2', home })
  transcript.append({ type: 'message', message: { role: 'user', content: 'one' } })

  const file = join(transcript.directory(), 'transcript.jsonl')
  appendFileSync(file, '{not json}\n')

  const read = transcript.read()
  assert.equal(read.records.length, 1)
  assert.equal(read.corruptLines, 1)
})
test('没有活写者时尾部半行仍按损坏行计数（保持 SP005 SR-07）', () => {
  const home = tempHome()
  const transcript = createSessionTranscript({ sessionId: 's3', home })
  transcript.append({ type: 'message', message: { role: 'user', content: 'one' } })

  const file = join(transcript.directory(), 'transcript.jsonl')
  // 崩溃进程遗留的陈旧锁（pid 极大概率不存在）。
  writeFileSync(join(transcript.directory(), 'writer.lock'), '999999\n2026-01-01T00:00:00.000Z\n')
  appendFileSync(file, '{"type":"message","message":{"role":"user","con')

  const read = transcript.read()
  assert.equal(read.records.length, 1)
  assert.equal(read.corruptLines, 1)
})
