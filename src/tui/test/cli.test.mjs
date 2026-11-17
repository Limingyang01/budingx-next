import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../dist/tui/cli.js', import.meta.url))

// The CLI reads ~/.budingx from the real user home; without isolation the
// "missing model" case depends on whatever the local user has configured
// (and could hit a real endpoint). Pin HOME/USERPROFILE to a fresh temp dir.
const isolatedHome = mkdtempSync(join(tmpdir(), 'budingx-cli-test-'))

function run(args = [], input = '', env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: {
        ...process.env,
        BUDINGX_API_KEY: '',
        BUDINGX_MODEL: '',
        BUDINGX_BASE_URL: '',
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        ...env
      },
      windowsHide: true
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (data) => {
      out += data
    })
    child.stderr.on('data', (data) => {
      err += data
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out, err }))
    child.stdin.end(input)
  })
}

test('help 与 version 不依赖配置，未知选项与缺模型明确报错', async () => {
  const help = await run(['--help'])
  assert.match(help.out, /budingx/)
  assert.match(help.out, /Commands:/)
  assert.equal(
    (await run(['--version'])).out.trim(),
    JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ).version
  )
  const bad = await run(['--unknown'])
  assert.equal(bad.code, 1)
  assert.match(bad.err, /Unknown/)
  const noModel = await run(['--prompt', 'hello'])
  assert.equal(noModel.code, 1)
  assert.match(noModel.err, /BUDINGX_MODEL/)
})

test('管道输入按行发送且输出无 ANSI 污染', async (t) => {
  const calls = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const messages = JSON.parse(body).messages
    calls.push(messages)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n'
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const result = await run([], 'first\nsecond\n', {
    BUDINGX_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
    BUDINGX_MODEL: 'fixture'
  })
  assert.equal(result.code, 0, result.err)
  assert.match(result.out, /你好/)
  assert.doesNotMatch(result.out, /\u001b\[/)
  assert.equal(calls.length, 2)
  assert.deepEqual(
    calls[1].map((message) => message.content),
    ['first', '你好', 'second']
  )
})

test('失败的回合不会污染历史，后续回合继续', async (t) => {
  const calls = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const messages = JSON.parse(body).messages
    calls.push(messages)
    if (messages.at(-1).content === 'fail') {
      res.writeHead(500)
      res.end('secret error')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n'
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const result = await run([], 'first\nfail\nsecond\n', {
    BUDINGX_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
    BUDINGX_MODEL: 'fixture'
  })
  assert.equal(result.code, 1)
  assert.match(result.out, /你好/)
  assert.match(result.err, /500/)
  // The failing turn is retried up to the bounded retry limit (5 attempts).
  assert.equal(calls.length, 7)
  assert.deepEqual(
    calls.at(-1).map((message) => message.content),
    ['first', '你好', 'second']
  )
  assert.doesNotMatch(result.out + result.err, /secret error/)
})

test('管道中的命令不会作为提示词发送', async (t) => {
  const calls = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    calls.push(JSON.parse(body).messages)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const result = await run([], '/help\nreal question\n', {
    BUDINGX_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
    BUDINGX_MODEL: 'fixture'
  })
  assert.equal(result.code, 0, result.err)
  assert.match(result.out, /Commands:/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].at(-1).content, 'real question')
})

test('交互模式在非 TTY 下不挂起', async () => {
  const result = await run([], '', {
    BUDINGX_BASE_URL: 'http://127.0.0.1:9/v1',
    BUDINGX_MODEL: 'fixture'
  })
  assert.equal(result.code, 0, result.err)
})
