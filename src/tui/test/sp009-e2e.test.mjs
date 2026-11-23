// SP009 0.9.1 · 真实子进程端到端（本地 OpenAI 兼容 SSE fixture + 真实无头 CLI）。
// 证据层级 L3：真实进程 + 真实 HTTP 传输 + 真实工具执行；唯一假件是模型脚本。
// 直接验证用户反馈的「32 回合硬停」已修复，以及无头 --max-turns 的可选上限。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const cli = fileURLToPath(new URL('../dist/tui/cli.js', import.meta.url))

function runHeadless(args, baseUrl, home, extraEnv = {}, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BUDINGX_API_KEY: 'fixture-key',
        BUDINGX_MODEL: 'fixture',
        BUDINGX_BASE_URL: baseUrl,
        HOME: home,
        USERPROFILE: home,
        ...extraEnv
      },
      windowsHide: true
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out, err }))
    child.stdin.end(input)
  })
}

function parseEvents(out) {
  return out.split('\n').filter((l) => l.trim()).map((l) => {
    try { return JSON.parse(l) } catch { return undefined }
  }).filter(Boolean)
}

// 返回一个按请求计数决定「继续给工具调用」还是「收尾文本」的 SSE fixture。
async function toolLoopFixture(t, { toolCallsBeforeStop }) {
  let requests = 0
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    if (!req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end('not found')
      return
    }
    requests++
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (requests <= toolCallsBeforeStop) {
      const call = {
        index: 0,
        id: 'call-' + requests,
        type: 'function',
        function: { name: 'Read', arguments: JSON.stringify({ path: 'package.json' }) }
      }
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [call] }, finish_reason: null }] }) + '\n\n')
      res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + '\n\n')
    } else {
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '长任务完成' } }] }) + '\n\n')
      res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n')
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  return {
    baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1',
    requests: () => requests
  }
}

test('E2E LF-01 真实无头进程：40 次工具迭代不再被 32 回合硬停', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-e2e-home-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const fixture = await toolLoopFixture(t, { toolCallsBeforeStop: 40 })
  const { code, out } = await runHeadless(
    ['--prompt', '执行一个长任务', '--output-format', 'stream-json'],
    fixture.baseUrl, home
  )
  const events = parseEvents(out)
  const result = events.find((e) => e.type === 'result')
  assert.ok(result, '应输出 result 事件')
  assert.equal(result.subtype, 'success', '长任务应正常完成而非 error_max_turns')
  assert.equal(result.is_error, false)
  assert.equal(code, 0)
  assert.ok(fixture.requests() >= 41, '模型请求应超过旧的 32 上限，实际 ' + fixture.requests())
  // num_turns 统计用户输入回合（单个 --prompt = 1），迭代次数以模型请求数为准。
  assert.equal(result.num_turns, 1)
})

test('E2E LF-02 真实无头进程：--max-turns 2 以 error_max_turns 收尾', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-e2e-home-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const fixture = await toolLoopFixture(t, { toolCallsBeforeStop: 1000 })
  const { code, out } = await runHeadless(
    ['--prompt', '一直调用工具', '--output-format', 'stream-json', '--max-turns', '2'],
    fixture.baseUrl, home
  )
  const events = parseEvents(out)
  const result = events.find((e) => e.type === 'result')
  assert.ok(result)
  assert.equal(result.subtype, 'error_max_turns')
  assert.equal(result.is_error, true)
  assert.equal(code, 1)
  assert.ok(fixture.requests() <= 3, '达到上限即停，不应继续请求，实际 ' + fixture.requests())
})

test('E2E LF-02 非法 --max-turns 报用法错误（退出码 2）', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-e2e-home-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const fixture = await toolLoopFixture(t, { toolCallsBeforeStop: 0 })
  const { code, err } = await runHeadless(
    ['--prompt', 'hi', '--max-turns', 'abc'],
    fixture.baseUrl, home
  )
  assert.equal(code, 2)
  assert.match(err, /Invalid --max-turns/)
})

// 小窗口多回合 fixture：每个普通请求回一段较长文本（构成 user+assistant 回合），
// 识别摘要请求（含 <conversation>）并回摘要。多个用户回合才有可裁剪的回合边界。
async function compactFixture(t) {
  let requests = 0
  let summaryRequests = 0
  const big = '填充文本。'.repeat(400) // ≈ 2000+ token/回合
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    if (!req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end('not found')
      return
    }
    requests++
    const parsed = JSON.parse(body)
    const lastUser = [...(parsed.messages ?? [])].reverse().find((m) => m.role === 'user')
    const content = typeof lastUser?.content === 'string' ? lastUser.content : ''
    const isSummary = content.includes('<conversation>')
    if (isSummary) summaryRequests++
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const reply = isSummary ? '<summary>早期历史摘要</summary>' : big
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: reply } }] }) + '\n\n')
    res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n')
    res.write('data: [DONE]\n\n')
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  return {
    baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1',
    requests: () => requests,
    summaryRequests: () => summaryRequests
  }
}

test('E2E LC-04/06 真实无头进程：小窗口多回合自动触发模型摘要压缩且回合仍完成', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-e2e-home-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const fixture = await compactFixture(t)
  // 多个用户回合（stream-json 输入），小窗口下历史越线后应裁剪旧回合并发摘要请求。
  const input = Array.from({ length: 6 }, (_, i) =>
    JSON.stringify({ type: 'user', message: { role: 'user', content: '第' + i + '个问题' } })
  ).join('\n')
  const { code, out } = await runHeadless(
    ['--input-format', 'stream-json', '--output-format', 'stream-json'],
    fixture.baseUrl, home,
    { BUDINGX_CONTEXT_WINDOW: '15000' },
    input
  )
  const events = parseEvents(out)
  const results = events.filter((e) => e.type === 'result')
  assert.ok(results.length >= 1)
  assert.ok(results.every((r) => r.subtype === 'success'), '每个回合都应完成')
  assert.equal(code, 0)
  assert.ok(fixture.summaryRequests() >= 1, '应至少发起一次模型摘要请求，实际 ' + fixture.summaryRequests())
})
