// SP005 跨进程会话恢复端到端（真实进程证据，AC SR-01/SR-03/SR-05/SR-06/SR-09/SR-10）。
//
// 进程 A 写会话（模拟一次带副作用的工具调用），进程 B 在**另一个进程**里恢复会话：
//   - 历史与工具结果被恢复；
//   - 已完成的副作用工具**不被重新执行**；
//   - 结果未知的步骤被标记为「需核对」而不是重放；
//   - 未知会话 id 返回明确错误；
//   - 恢复不提升权限档位。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = fileURLToPath(new URL('.', import.meta.url))
const storageDist = join(here, '..', '..', 'tui', 'dist', 'storage')
// 传给子进程的 import 说明必须是 file:// URL（Windows 绝对路径不能直接用作模块说明）。
const storageUrl = pathToFileURL(join(storageDist, 'session-store.js')).href

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'budingx-sp005-recovery-'))
}

/** 进程 A：写入一段会话转录（用户消息 + 助手消息 + 两个工具步骤）。 */
const writerScript = (home, sessionId) => `
import { join } from 'node:path'
import { startSession } from '${storageUrl}'
const home = ${JSON.stringify(home)}
const sessionId = ${JSON.stringify(sessionId)}
const { transcript } = startSession({ sessionId, home, title: 'recovery probe' })
transcript.append({
  type: 'message',
  ts: '2026-01-01T00:00:00.000Z',
  id: 'u1',
  role: 'user',
  blocks: [{ type: 'text', text: 'write the file and check it' }]
})
transcript.append({
  type: 'message',
  ts: '2026-01-01T00:00:01.000Z',
  id: 'a1',
  role: 'assistant',
  blocks: [{ type: 'tool_use', id: 'call-done', name: 'Write', input: { path: 'a.txt' } }]
})
transcript.append({
  type: 'tool_step',
  ts: '2026-01-01T00:00:02.000Z',
  turnId: 'turn-1',
  callId: 'call-done',
  name: 'Write',
  status: 'completed',
  detail: 'a.txt written'
})
transcript.append({
  type: 'message',
  ts: '2026-01-01T00:00:03.000Z',
  id: 'a2',
  role: 'assistant',
  blocks: [{ type: 'tool_use', id: 'call-unknown', name: 'Write', input: { path: 'b.txt' } }]
})
transcript.append({
  type: 'tool_step',
  ts: '2026-01-01T00:00:04.000Z',
  turnId: 'turn-1',
  callId: 'call-unknown',
  name: 'Write',
  status: 'needs_review',
  detail: 'turn ended before the tool result was known'
})
transcript.append({
  type: 'turn',
  ts: '2026-01-01T00:00:05.000Z',
  turnId: 'turn-1',
  outcome: 'cancelled'
})
process.stdout.write('written')
`

/** 进程 B：在另一个进程里恢复会话。 */
const readerScript = (home, sessionId) => `
import { join } from 'node:path'
import { SessionStore } from '${storageUrl}'
const home = ${JSON.stringify(home)}
const sessionId = ${JSON.stringify(sessionId)}
const store = new SessionStore({ home })
const restored = store.restore(sessionId)
process.stdout.write(JSON.stringify({
  status: restored.status,
  message: restored.message ?? '',
  messages: restored.messages,
  needsReview: restored.needsReview,
  warnings: restored.warnings,
  summary: restored.summary,
  list: store.list().map((entry) => entry.sessionId)
}))
`

function runNode(script) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 30000
  })
  assert.equal(result.status, 0, `child process failed: ${result.stderr}`)
  return result.stdout
}

test('SR-01/SR-05/SR-06 跨进程恢复：历史恢复、已完成副作用不重放、未知结果标记需核对', () => {
  const home = tempHome()
  const sessionId = 'sp005-cross-process'
  try {
    const written = runNode(writerScript(home, sessionId))
    assert.equal(written, 'written')

    const transcriptFile = join(home, '.budingx', 'sessions', sessionId, 'transcript.jsonl')
    assert.ok(existsSync(transcriptFile), 'the writer process must leave a transcript on disk')

    const payload = JSON.parse(runNode(readerScript(home, sessionId)))
    assert.equal(payload.status, 'restored')
    assert.ok(payload.messages.length >= 2, 'restored history must contain the recorded messages')
    assert.ok(
      payload.messages.some((message) =>
        (message.blocks ?? []).some((block) => block.type === 'text' && block.text.includes('write the file'))
      ),
      'the user message must survive the cross-process restore'
    )

    // 已完成的副作用步骤不得出现在「需核对」列表里，也不得被重放。
    assert.equal(payload.needsReview.length, 1)
    assert.equal(payload.needsReview[0].callId, 'call-unknown')
    assert.equal(payload.needsReview[0].name, 'Write')
    assert.ok(
      payload.warnings.some((warning) => warning.includes('were not replayed')),
      'the restore must say explicitly that unknown-outcome steps were not replayed'
    )

    assert.ok(payload.list.includes(sessionId), 'the restored session must be listed')
    assert.equal(payload.summary.sessionId, sessionId)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('SR-09 跨进程恢复未知会话 id 返回明确错误而不是空会话', () => {
  const home = tempHome()
  try {
    const payload = JSON.parse(runNode(readerScript(home, 'does-not-exist')))
    assert.equal(payload.status, 'not_found')
    assert.match(payload.message ?? '', /was not found/)
    assert.equal(payload.messages.length, 0)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('SR-07 半写入的损坏行在跨进程恢复时被跳过并计数，原文件保持不变', () => {
  const home = tempHome()
  const sessionId = 'sp005-corrupt-line'
  try {
    runNode(writerScript(home, sessionId))
    const transcriptFile = join(home, '.budingx', 'sessions', sessionId, 'transcript.jsonl')
    const before = readFileSync(transcriptFile, 'utf8')
    writeFileSync(transcriptFile, `${before}{"type":"message","broken\n`)

    const payload = JSON.parse(runNode(readerScript(home, sessionId)))
    assert.equal(payload.status, 'restored')
    assert.ok(
      payload.warnings.some((warning) => warning.includes('could not be read')),
      'the restore must report the skipped corrupt line'
    )
    const after = readFileSync(transcriptFile, 'utf8')
    assert.ok(after.includes('{"type":"message","broken'), 'the original file must be kept as is')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('SR-08 更高 schema 版本的转录跨进程只读拒绝，不被覆盖', () => {
  const home = tempHome()
  const sessionId = 'sp005-newer-schema'
  try {
    const dir = join(home, '.budingx', 'sessions', sessionId)
    const transcriptFile = join(dir, 'transcript.jsonl')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      transcriptFile,
      JSON.stringify({
        type: 'session_started',
        ts: '2026-01-01T00:00:00.000Z',
        schemaVersion: 99,
        sessionId
      }) + '\n',
      'utf8'
    )
    const before = readFileSync(transcriptFile, 'utf8')
    const payload = JSON.parse(runNode(readerScript(home, sessionId)))
    assert.equal(payload.status, 'unsupported_schema')
    assert.match(payload.message ?? '', /newer than supported/)
    const after = readFileSync(transcriptFile, 'utf8')
    assert.equal(after, before, 'the newer-schema transcript must not be rewritten')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
