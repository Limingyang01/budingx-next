import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))

function run(args = [], input = '', env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: {
        ...process.env,
        BUDINGX_API_KEY: '',
        BUDINGX_MODEL: '',
        BUDINGX_BASE_URL: '',
        ...env
      },
      windowsHide: true
    })
    let out = '',
      err = ''
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
test('help/version work without configuration, invalid options and missing model fail usefully', async () => {
  assert.match((await run(['--help'])).out, /Chat only/)
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
test('interactive commands hide secrets and endpoint change drops credentials', async () => {
  const result = await run(
    [],
    '/config\n/model local-model\n/endpoint http://localhost:1234/v1\n/config\n/clear\n/nope\n/exit\n',
    { BUDINGX_API_KEY: 'DO-NOT-PRINT-THIS' }
  )
  assert.equal(result.code, 0)
  assert.doesNotMatch(result.out + result.err, /DO-NOT-PRINT-THIS/)
  assert.match(result.out, /Model: local-model/)
  assert.match(result.out, /API key: not set/)
  assert.match(result.out, /Conversation cleared/)
  assert.match(result.err, /Unknown command/)
})
test('real CLI sends only successful turns in history and can continue after a failed request', async (t) => {
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
  const result = await run([], 'first\nfail\nsecond\n/exit\n', {
    BUDINGX_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
    BUDINGX_MODEL: 'fixture'
  })
  assert.equal(result.code, 0, result.err)
  assert.match(result.out, /你好/)
  assert.match(result.err, /500/)
  assert.equal(calls.length, 3)
  assert.deepEqual(
    calls[2].map((message) => message.content),
    ['first', '你好', 'second']
  )
})

test('piped EOF during an asynchronous reply completes the turn and exits normally', async (t) => {
  let calls = 0
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) {
      /* consume request before delayed response */
    }
    calls++
    await new Promise((resolve) => setTimeout(resolve, 30))
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(
      'data: {"choices":[{"delta":{"content":"finished after EOF"}}]}\n\ndata: [DONE]\n\n'
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const result = await run([], 'single message\n', {
    BUDINGX_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
    BUDINGX_MODEL: 'fixture'
  })
  assert.equal(result.code, 0, result.err)
  assert.match(result.out, /finished after EOF/)
  assert.doesNotMatch(result.err, /readline was closed/)
  assert.equal(calls, 1)
})
