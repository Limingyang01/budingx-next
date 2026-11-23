// SP005 端到端：上下文预算压缩 / 项目记忆跨进程 / 会话写锁互斥。
//
// 这一层连的是真实 HTTP 传输（本地 OpenAI 兼容脚本端点）、真实工具、
// 真实存储与真实子进程，只把模型换成脚本，因而可重复且不消耗额度。

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Session } from '../../tui/dist/core/session.js'
import { createOpenAiProvider } from '../../tui/dist/provider/openai.js'
import { createProjectMemory } from '../../tui/dist/storage/project-memory.js'
import { createSessionStore, startSession } from '../../tui/dist/storage/session-store.js'

const DIST = pathToFileURL(join(process.cwd(), 'src', 'tui', 'dist')).href

/** 起一个只记录请求、固定回文本的 OpenAI 兼容端点。 */
function createRecordingProvider(reply = '收到。') {
  const requests = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    if (!req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end('not found')
      return
    }
    requests.push(JSON.parse(body))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: reply } }] }) + '\n\n')
    res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n')
    res.write('data: [DONE]\n\n')
    res.end()
  })
  return { server, requests }
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}

function message(id, role, blocks) {
  return { id, role, blocks }
}

function turnPair(index, size) {
  const pad = 'x'.repeat(size)
  return [
    message('u' + index, 'user', [{ type: 'text', text: '第' + index + '步：' + pad }]),
    message('a' + index, 'assistant', [{ type: 'text', text: '好的，第' + index + '步完成。' + pad }])
  ]
}

test('CB-01/02/03/04 压缩后真实的模型请求仍保留约束、计划与未完成工具状态', async () => {
  const { server, requests } = createRecordingProvider()
  const port = await listen(server)
  try {
    const provider = createOpenAiProvider({
      baseUrl: 'http://127.0.0.1:' + port + '/v1',
      apiKey: 'test-key'
    })
    const session = new Session({
      provider,
      approval: { async request() { return { outcome: 'allow', via: 'policy' } } },
      resolveSnapshot: () => ({
        modelId: 'e2e',
        model: 'scripted',
        baseUrlHost: '127.0.0.1',
        capabilities: { tools: true }
      }),
      contextBudget: { maxTokens: 900, reservedOutputTokens: 100 },
      resolvePlanText: () => '1. 先改 core/context-budget.ts\n2. 再跑 npm test'
    })
    const events = []
    session.on((event) => events.push(event))

    // 恢复一段长历史：两条约束、若干个可丢弃的回合、一个结果未知的工具调用。
    // 结果未知的工具调用放在靠前的回合里，确保它落在被压缩掉的区间内。
    const history = [
      message('c1', 'user', [{ type: 'text', text: '不要修改 src/core 之外的任何文件。' }]),
      message('c2', 'user', [{ type: 'text', text: '必须保留现有测试，不得降低阈值。' }]),
      ...turnPair(1, 400),
      message('a-unknown', 'assistant', [
        { type: 'tool_use', id: 'call-open', name: 'Bash', input: { command: 'npm test' } }
      ]),
      ...turnPair(2, 400),
      ...turnPair(3, 400),
      ...turnPair(4, 400)
    ]
    session.restoreHistory(history)

    const finalized = new Promise((resolve) => {
      session.on((event) => { if (event.type === 'turn_finalized') resolve(event) })
    })
    session.submit('继续完成剩余工作。')
    await finalized

    // SP009 0.9.1 LC-06：压缩前先发一次模型摘要请求，再发真实回合请求。
    assert.equal(requests.length, 2, 'one summary request plus the real turn request')
    const summaryRequest = requests[0]
    assert.ok(
      String(summaryRequest.messages?.[0]?.content ?? '').includes('<conversation>'),
      'the summary request must carry the conversation to summarize'
    )
    const sent = requests[1].messages
    const wire = JSON.stringify(sent)

    // CB-02：两条用户约束都必须出现在真实请求里。
    assert.ok(wire.includes('不要修改 src/core 之外的任何文件'), 'constraint 1 must survive compaction')
    assert.ok(wire.includes('必须保留现有测试'), 'constraint 2 must survive compaction')
    assert.ok(wire.includes('<preserved_context>'), 'preserved items must be marked')
    // SP009 0.9.1 LC-06：被裁剪回合以模型摘要保留在压缩边界。
    assert.ok(wire.includes('<compacted_summary>'), 'the model summary must survive compaction')
    // CB-03：已批准计划仍然可读。
    assert.ok(wire.includes('context-budget.ts'), 'the approved plan must survive compaction')
    // CB-04：未完成的工具调用变成需要核对的结果，绝不伪装成功。
    const placeholder = sent
      .filter((m) => m.role === 'tool')
      .find((m) => String(m.content).includes('[compacted]'))
    assert.ok(placeholder, 'an unfinished tool call must become an explicit placeholder')
    assert.ok(!wire.includes('Tool call did not complete'), 'no fake success is allowed')

    // CB-01：压缩事件被发出，且区间可定位。
    const compacted = events.find((event) => event.type === 'context_compacted')
    assert.ok(compacted, 'a context_compacted event must be emitted')
    assert.ok(compacted.replacedCount > 0)
    assert.ok(compacted.estimatedAfter < compacted.estimatedBefore)

    // CB-05：压缩之后请求回到预算之内。
    assert.ok(compacted.withinBudget, 'the request must be back within budget')

    // 最近一条用户消息（当前请求）必须完整保留。
    assert.ok(wire.includes('继续完成剩余工作'), 'the current request must never be dropped')
  } finally {
    server.close()
  }
})

test('PM-02 项目记忆在真实子进程写入后，父进程能读到同一条', () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-sp005-pm-'))
  const root = join(home, 'workspace', 'shared-project')
  const script = [
    "import { createProjectMemory } from '" + DIST + "/storage/project-memory.js'",
    'const memory = createProjectMemory({ home: ' + JSON.stringify(home) + ', projectRoot: ' + JSON.stringify(root) + ' })',
    "const result = memory.write('build-command', 'npm run build 生成 dist，测试直接引用 dist。')",
    'console.log(JSON.stringify({ ok: result.ok, message: result.message ?? \'\' }))'
  ].join('\n')
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8'
  })
  assert.equal(child.status, 0, child.stderr)
  const written = JSON.parse(child.stdout.trim())
  assert.equal(written.ok, true)

  // 父进程（不同进程）读同一条记忆。
  const entries = createProjectMemory({ home, projectRoot: root }).read().entries
  assert.equal(entries.length, 1)
  assert.equal(entries[0].title, 'build-command')
  assert.match(entries[0].body, /npm run build/)

  // 另一个项目看不到它（PM-02 隔离）。
  const other = createProjectMemory({ home, projectRoot: join(home, 'workspace', 'other') })
  assert.equal(other.read().entries.length, 0)
})

test('SR-11 两个真实进程并发写同一会话时，第二个写入者被明确拒绝', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-sp005-lock-'))
  const sessionId = 'lock-session'
  startSession({ sessionId, home })
  const script = [
    "import { createSessionStore } from '" + DIST + "/storage/session-store.js'",
    'const store = createSessionStore({ home: ' + JSON.stringify(home) + ' })',
    'const result = store.acquire(' + JSON.stringify(sessionId) + ')',
    "console.log(JSON.stringify({ ok: result.acquired, reason: result.reason ?? '' }))",
    'await new Promise((resolve) => setTimeout(resolve, 4000))'
  ].join('\n')
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const line = await new Promise((resolve, reject) => {
    let buffer = ''
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      if (buffer.includes('\n')) resolve(buffer.trim())
    })
    child.on('error', reject)
    setTimeout(() => reject(new Error('holder did not report within 5s')), 5000)
  })
  const holder = JSON.parse(line)
  assert.equal(holder.ok, true, 'the first writer must acquire the lock')

  // 锁仍被另一个活进程持有时，本进程必须被明确拒绝，而不是悄悄写入。
  const blocked = createSessionStore({ home }).acquire(sessionId)
  assert.equal(blocked.acquired, false)
  assert.match(blocked.reason, /locked by a running process/)

  child.kill()
  await new Promise((resolve) => child.on('exit', resolve))
  // 进程被杀后锁成为陈旧锁：不静默删除，必须显式解锁（SR-11）。
  const stale = createSessionStore({ home }).acquire(sessionId)
  assert.equal(stale.acquired, false)
  assert.match(stale.reason, /stale lock/)
  const forced = createSessionStore({ home }).acquire(sessionId, { force: true })
  assert.equal(forced.acquired, true, 'an explicit unlock must be able to continue')
});
