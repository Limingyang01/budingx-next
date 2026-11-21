// SP006 §11：无头 CLI 与事件协议（真实子进程 + 本地 SSE fixture）。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const cli = fileURLToPath(new URL('../dist/tui/cli.js', import.meta.url))
const isolatedHome = mkdtempSync(join(tmpdir(), 'budingx-headless-home-'))

function run(args = [], input = '', env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BUDINGX_API_KEY: 'fixture-key',
        BUDINGX_MODEL: 'fixture',
        BUDINGX_BASE_URL: '',
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        ...env
      },
      windowsHide: true
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (data) => { out += data })
    child.stderr.on('data', (data) => { err += data })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out, err }))
    child.stdin.end(input)
  })
}

async function fixtureServer(t, reply = 'hello') {
  const calls = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    calls.push(JSON.parse(body).messages)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(
      'data: {"choices":[{"delta":{"content":"' + reply + '"}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n'
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  return { calls, baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1' }
}

test('用法错误退出码 2：未知选项、非法格式、互斥参数、缺值', async () => {
  const unknown = await run(['--unknown'])
  assert.equal(unknown.code, 2)
  assert.match(unknown.err, /Unknown option/)
  assert.equal(unknown.out, '')
  const badFormat = await run(['--output-format', 'xml', '--prompt', 'hi'])
  assert.equal(badFormat.code, 2)
  assert.match(badFormat.err, /Invalid --output-format/)
  const conflict = await run(['--prompt', 'hi', '--input-file', 'in.txt'])
  assert.equal(conflict.code, 2)
  assert.match(conflict.err, /mutually exclusive/)
  const missing = await run(['--output-format'])
  assert.equal(missing.code, 2)
  assert.match(missing.err, /requires a value/)
})

test('stream-json：init/user/assistant/result 顺序与字段', async (t) => {
  const fixture = await fixtureServer(t)
  const result = await run(['--prompt', 'hi', '--output-format', 'stream-json'], '', {
    BUDINGX_BASE_URL: fixture.baseUrl
  })
  assert.equal(result.code, 0, result.err)
  assert.doesNotMatch(result.out, /\u001b\[/)
  const events = result.out.trim().split('\n').map((line) => JSON.parse(line))
  const init = events[0]
  assert.equal(init.type, 'system')
  assert.equal(init.subtype, 'init')
  assert.equal(typeof init.session_id, 'string')
  assert.equal(init.model, 'fixture')
  assert.ok(Array.isArray(init.tools) && init.tools.length > 0)
  assert.ok(events.some((event) => event.type === 'status' || event.subtype === 'status'))
  const user = events.find((event) => event.type === 'user')
  assert.equal(user.message.content, 'hi')
  const assistant = events.filter((event) => event.type === 'assistant')
  assert.ok(assistant.length >= 2)
  // 增量事件逐段拼接 = 完整回复；收尾的整段事件（delta:false）供脚本直接取用。
  assert.equal(
    assistant.filter((event) => event.delta).map((event) => event.message.content).join(''),
    'hello'
  )
  assert.equal(assistant.at(-1).delta, false)
  assert.equal(assistant.at(-1).message.content, 'hello')
  const last = events.at(-1)
  assert.equal(last.type, 'result')
  assert.equal(last.subtype, 'success')
  assert.equal(last.is_error, false)
  assert.equal(last.num_turns, 1)
  assert.equal(last.stop_reason, 'completed')
  assert.equal(typeof last.session_id, 'string')
  assert.equal(last.total_cost_usd, 0)
  assert.ok(Array.isArray(last.permission_denials))
  assert.equal(fixture.calls.length, 1)
})

test('json：只输出单个结果对象且不带 type 包装', async (t) => {
  const fixture = await fixtureServer(t)
  const result = await run(['--prompt', 'hi', '--output-format', 'json'], '', {
    BUDINGX_BASE_URL: fixture.baseUrl
  })
  assert.equal(result.code, 0, result.err)
  const parsed = JSON.parse(result.out)
  assert.equal(parsed.type, undefined)
  assert.equal(parsed.subtype, 'success')
  assert.equal(parsed.is_error, false)
  assert.equal(parsed.num_turns, 1)
  assert.equal(typeof parsed.session_id, 'string')
})

test('stream-json 输入：多轮按行输入，num_turns 与事件计数一致', async (t) => {
  const fixture = await fixtureServer(t)
  const input =
    '{"type":"user","message":{"role":"user","content":"one"}}\n' +
    '{"type":"user","message":{"role":"user","content":"two"}}\n'
  const result = await run(
    ['--input-format', 'stream-json', '--output-format', 'stream-json'],
    input,
    { BUDINGX_BASE_URL: fixture.baseUrl }
  )
  assert.equal(result.code, 0, result.err)
  const events = result.out.trim().split('\n').map((line) => JSON.parse(line))
  const users = events.filter((event) => event.type === 'user')
  assert.deepEqual(users.map((event) => event.message.content), ['one', 'two'])
  assert.equal(events.at(-1).num_turns, 2)
  assert.equal(fixture.calls.length, 2)
})

test('默认无头运行不写用户数据；失败回合退出码 1', async (t) => {
  const fixture = await fixtureServer(t)
  const ok = await run(['--prompt', 'hi'], '', { BUDINGX_BASE_URL: fixture.baseUrl })
  assert.equal(ok.code, 0, ok.err)
  assert.equal(existsSync(join(isolatedHome, '.budingx', 'sessions')), false)

  const failing = createServer((req, res) => {
    req.resume()
    res.writeHead(500)
    res.end('boom')
  })
  failing.listen(0, '127.0.0.1')
  await once(failing, 'listening')
  t.after(() => { failing.closeAllConnections(); failing.close() })
  const bad = await run(['--prompt', 'hi', '--output-format', 'json'], '', {
    BUDINGX_BASE_URL: 'http://127.0.0.1:' + failing.address().port + '/v1'
  })
  assert.equal(bad.code, 1)
  const parsed = JSON.parse(bad.out)
  assert.equal(parsed.is_error, true)
  assert.equal(parsed.subtype, 'error_during_execution')
  assert.ok(Array.isArray(parsed.errors) && parsed.errors.length >= 1)
})
