// Session transcript and session store unit tests (SP005 AC SR-01..SR-11).
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TRANSCRIPT_VERSION,
  createSessionTranscript,
  messagesFromRecords,
  needsReviewSteps
} from '../../tui/dist/storage/session-transcript.js'
import {
  SessionStore,
  SessionWriterLock,
  startSession
} from '../../tui/dist/storage/session-store.js'

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'budingx-sp005-transcript-'))
}

function sessionDir(home, sessionId) {
  return join(home, '.budingx', 'sessions', sessionId)
}

test('SR-01 转录写入会话私有目录，文件仅当前用户可读', () => {
  const home = tempHome()
  const transcript = createSessionTranscript({ sessionId: 's1', home })
  transcript.append({
    type: 'message',
    ts: '2026-01-01T00:00:00.000Z',
    id: 'm1',
    role: 'user',
    blocks: [{ type: 'text', text: 'hello' }]
  })
  const file = join(sessionDir(home, 's1'), 'transcript.jsonl')
  assert.ok(existsSync(file))
  const lines = readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(lines.length, 1)
  assert.equal(JSON.parse(lines[0]).type, 'message')
  if (process.platform !== 'win32') {
    const mode = statSync(file).mode & 0o777
    assert.equal(mode & 0o077, 0, 'file must not be group/other readable')
  }
})

test('SR-01 转录不会触碰 ~/.claude 路径', () => {
  const home = tempHome()
  const transcript = createSessionTranscript({ sessionId: 's2', home })
  transcript.append({ type: 'note', ts: '2026-01-01T00:00:00.000Z', text: 'x' })
  assert.ok(existsSync(join(home, '.budingx')))
  assert.ok(!existsSync(join(home, '.claude')))
})

test('SR-07 半写入损坏行被跳过并计数，原文件保持不变', () => {
  const home = tempHome()
  const transcript = createSessionTranscript({ sessionId: 's3', home })
  transcript.append({ type: 'note', ts: '2026-01-01T00:00:00.000Z', text: 'ok' })
  const file = join(sessionDir(home, 's3'), 'transcript.jsonl')
  const before = readFileSync(file, 'utf8')
  writeFileSync(file, before + '{"type":"message","id":"m2","role":"user","blo')
  const read = transcript.read()
  assert.equal(read.corruptLines, 1)
  assert.equal(read.records.length, 1)
  assert.equal(read.records[0].type, 'note')
  assert.ok(readFileSync(file, 'utf8').includes('ok'))
})

test('SR-08 更新版本号的转录只读拒绝，不被覆盖', () => {
  const home = tempHome()
  const dir = sessionDir(home, 's4')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'transcript.jsonl')
  const payload =
    JSON.stringify({
      type: 'session_started',
      ts: '2026-01-01T00:00:00.000Z',
      schemaVersion: TRANSCRIPT_VERSION + 1,
      sessionId: 's4'
    }) + '\n'
  writeFileSync(file, payload)
  const transcript = createSessionTranscript({ sessionId: 's4', home })
  const read = transcript.read()
  assert.equal(read.unsupported, true)
  assert.equal(read.records.length, 0)
  assert.equal(readFileSync(file, 'utf8'), payload)
})

test('SR-05 恢复得到历史消息与工具结果', () => {
  const home = tempHome()
  const transcript = createSessionTranscript({ sessionId: 's5', home })
  transcript.append({
    type: 'message',
    ts: '2026-01-01T00:00:00.000Z',
    id: 'm1',
    role: 'user',
    blocks: [{ type: 'text', text: 'read file' }]
  })
  transcript.append({
    type: 'message',
    ts: '2026-01-01T00:00:01.000Z',
    id: 'm2',
    role: 'assistant',
    blocks: [{ type: 'tool_use', id: 'c1', name: 'Read', input: { path: 'a.txt' } }]
  })
  transcript.append({
    type: 'message',
    ts: '2026-01-01T00:00:02.000Z',
    id: 'm3',
    role: 'tool',
    blocks: [{ type: 'tool_result', callId: 'c1', content: 'file body', isError: false }]
  })
  const messages = messagesFromRecords(transcript.read().records)
  assert.equal(messages.length, 3)
  assert.equal(messages[2].role, 'tool')
  assert.equal(messages[2].blocks[0].content, 'file body')
})

test('SR-06 结果未知的工具步骤被标记为需核对，而不是重放', () => {
  const home = tempHome()
  const transcript = createSessionTranscript({ sessionId: 's6', home })
  transcript.append({
    type: 'tool_step',
    ts: '2026-01-01T00:00:00.000Z',
    turnId: 't1',
    callId: 'c1',
    name: 'Write',
    status: 'completed'
  })
  transcript.append({
    type: 'tool_step',
    ts: '2026-01-01T00:00:01.000Z',
    turnId: 't1',
    callId: 'c2',
    name: 'Bash',
    status: 'needs_review'
  })
  const review = needsReviewSteps(transcript.read().records)
  assert.equal(review.length, 1)
  assert.equal(review[0].type, 'tool_step')
})

test('SR-06 会话恢复不重放任何工具步骤', () => {
  const home = tempHome()
  const store = new SessionStore({ home })
  const { transcript } = startSession({ sessionId: 's7', title: 'demo', home })
  transcript.append({
    type: 'tool_step',
    ts: '2026-01-01T00:00:00.000Z',
    turnId: 't1',
    callId: 'c1',
    name: 'Bash',
    status: 'needs_review',
    detail: 'process was killed'
  })
  store.writeMeta({
    schemaVersion: TRANSCRIPT_VERSION,
    sessionId: 's7',
    title: 'demo',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    turns: 1,
    permissionMode: 'workspace_edit'
  })
  const result = store.restore('s7')
  assert.equal(result.status, 'restored')
  assert.equal(result.needsReview.length, 1)
  assert.equal(result.needsReview[0].name, 'Bash')
  assert.equal(result.summary.permissionMode, 'workspace_edit')
  assert.equal(result.messages.length, 0)
})

test('SR-03 会话列表给出 id、标题、更新时间与轮次', () => {
  const home = tempHome()
  const store = new SessionStore({ home })
  const { transcript } = startSession({ sessionId: 's8', title: 'fix the build', home })
  transcript.append({
    type: 'turn',
    ts: '2026-01-01T00:00:00.000Z',
    turnId: 't1',
    outcome: 'completed'
  })
  store.writeMeta({
    schemaVersion: TRANSCRIPT_VERSION,
    sessionId: 's8',
    title: 'fix the build',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    turns: 1
  })
  const list = store.list()
  assert.equal(list.length, 1)
  assert.equal(list[0].sessionId, 's8')
  assert.equal(list[0].title, 'fix the build')
  assert.equal(list[0].turns, 1)
  assert.equal(list[0].updatedAt, '2026-01-02T00:00:00.000Z')
})

test('SR-09 未知会话 id 返回明确错误而不是空会话', () => {
  const home = tempHome()
  const store = new SessionStore({ home })
  const result = store.restore('missing-session')
  assert.equal(result.status, 'not_found')
  assert.ok(result.message && result.message.includes('missing-session'))
  assert.equal(result.messages.length, 0)
})

test('SR-10 恢复的会话保留原权限档位，不被提升', () => {
  const home = tempHome()
  const store = new SessionStore({ home })
  startSession({ sessionId: 's10', title: 'x', home })
  store.writeMeta({
    schemaVersion: TRANSCRIPT_VERSION,
    sessionId: 's10',
    title: 'x',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    turns: 0,
    permissionMode: 'read_only'
  })
  const result = store.restore('s10')
  assert.equal(result.summary.permissionMode, 'read_only')
  assert.notEqual(result.summary.permissionMode, 'full_access')
})

test('AC-NAME-01/02 用户标题独立持久化，写锁、长度及历史追加保持一致', () => {
  const home = tempHome()
  const store = new SessionStore({ home, workspaceRoot: home })
  const { transcript } = startSession({ sessionId: 'naming', home, workspaceRoot: home })
  transcript.append({
    type: 'message', ts: '2026-01-01T00:00:00.000Z', id: 'first', role: 'user',
    blocks: [{ type: 'text', text: '原始标题' }]
  })
  const writer = store.acquire('naming')
  assert.equal(writer.acquired, true)
  try {
    assert.equal(store.rename('naming', '新的中文标题', writer.lock).ok, true)
    assert.equal(store.rename('naming', '    ', writer.lock).ok, false)
    assert.equal(store.rename('naming', '🌏'.repeat(81), writer.lock).ok, false)
    assert.equal(store.acquire('naming').acquired, false)
    transcript.append({ type: 'turn', ts: new Date().toISOString(), turnId: 'one', outcome: 'completed' })
    const restored = new SessionStore({ home, workspaceRoot: home }).restore('naming')
    assert.equal(restored.summary.title, '新的中文标题')
    assert.equal(restored.summary.turns, 1)
    assert.equal(restored.summary.sessionId, 'naming')
    assert.equal(restored.messages[0].blocks[0].text, '原始标题')
    assert.equal(store.readMeta('naming').title, '原始标题')
  } finally {
    writer.lock.release()
  }
})

test('AC-FORK-01/02 分支继承完整历史、来源及核对步骤，损坏来源没有半成品', () => {
  const home = tempHome()
  const store = new SessionStore({ home, workspaceRoot: home })
  const { transcript } = startSession({ sessionId: 'source', title: '主会话', home, workspaceRoot: home })
  transcript.append({
    type: 'message', ts: '2026-01-01T00:00:00.000Z', id: 'point', role: 'assistant',
    blocks: [{ type: 'tool_use', id: 'w1', name: 'Write', input: { path: 'a.txt' } }]
  })
  const first = store.fork('source', { permissionMode: 'read_only' })
  const second = store.fork('source', { permissionMode: 'read_only' })
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.notEqual(first.sessionId, second.sessionId)
  assert.deepEqual(store.readMeta(first.sessionId).forkedFrom, { sessionId: 'source', messageId: 'point' })
  const branch = store.restore(first.sessionId)
  assert.equal(branch.summary.permissionMode, 'read_only')
  assert.deepEqual(branch.needsReview.map((step) => step.callId), ['w1'])
  assert.match(branch.summary.title, /主会话/)
  assert.equal(store.restore('source').messages.length, 1)

  const original = join(sessionDir(home, 'source'), 'transcript.jsonl')
  const damaged = readFileSync(original, 'utf8') + '{"incomplete":\n'
  writeFileSync(original, damaged)
  assert.equal(store.fork('source').ok, false)
  assert.equal(store.list().length, 3)
  assert.equal(readFileSync(original, 'utf8'), damaged)
})

test('SR-11 活跃写锁拒绝第二个写入者，陈旧锁不静默删除', () => {
  const home = tempHome()
  mkdirSync(sessionDir(home, 's11'), { recursive: true })
  const first = new SessionWriterLock('s11', home)
  const acquired = first.acquire()
  assert.equal(acquired.acquired, true)

  const second = new SessionWriterLock('s11', home)
  const rejected = second.acquire()
  assert.equal(rejected.acquired, false)
  assert.ok(rejected.acquired === false && rejected.reason.includes('locked'))

  writeFileSync(join(sessionDir(home, 's11'), 'writer.lock'), '999999\n2026-01-01T00:00:00.000Z\n')
  const third = new SessionWriterLock('s11', home)
  const stale = third.acquire()
  assert.equal(stale.acquired, false)
  const forced = third.acquire({ force: true })
  assert.equal(forced.acquired, true)
  third.release()
  first.release()
})

test('SR-11 写锁释放后可以再次获取', () => {
  const home = tempHome()
  mkdirSync(sessionDir(home, 's12'), { recursive: true })
  const lock = new SessionWriterLock('s12', home)
  assert.equal(lock.acquire().acquired, true)
  lock.release()
  assert.equal(lock.acquire().acquired, true)
  lock.release()
})
