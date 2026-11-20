// 0.5.2 真实进程端到端：真实 CLI + 本地流式 HTTP 服务。
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('0.5.2 真实 CLI 流式往返：内容完整、effort 下发、退出码 0', async () => {
  const root = mkdtempSync(join(tmpdir(), 'budingx-e2e-'))
  let requests = 0
  let sawEffort = null
  const server = http.createServer((req, res) => {
    if (req.url !== '/v1/chat/completions') {
      res.writeHead(404)
      res.end()
      return
    }
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      requests += 1
      try {
        const parsed = JSON.parse(body)
        if (parsed.reasoning_effort) sawEffort = parsed.reasoning_effort
      } catch {
        // A malformed probe body is not what this test asserts.
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (let i = 0; i < 40; i++) {
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'chunk' + i + ' ' } }] }) + '\n\n')
      }
      res.write('data: ' + JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4321, completion_tokens: 40 }
      }) + '\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const child = spawn(process.execPath, [
    'src/tui/dist/tui/cli.js',
    '--base-url', 'http://127.0.0.1:' + port + '/v1',
    '--model', 'e2e-model',
    '--timeout', '30000',
    '--prompt', 'say hi'
  ], {
    env: { ...process.env, BUDINGX_API_KEY: 'sk-e2e', BUDINGX_REASONING_EFFORT: 'high', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let out = ''
  let err = ''
  child.stdout.on('data', (chunk) => { out += chunk })
  child.stderr.on('data', (chunk) => { err += chunk })
  child.on('error', (error) => { err += error.message })
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill(); resolve('timeout') }, 45000)
    child.on('close', (value) => { clearTimeout(timer); resolve(value) })
  })
  server.close()
  assert.equal(code, 0, 'the real CLI must exit 0; stderr: ' + err.slice(-400))
  assert.equal(requests, 1)
  assert.match(out, /chunk0/)
  assert.match(out, /chunk39/, 'every streamed chunk must reach the terminal')
  assert.equal(sawEffort, 'high', 'the configured reasoning effort must be sent')
})
