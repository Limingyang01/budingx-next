import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { run } from './process.mjs'

export async function smokeInstalled(packageDirectory, cwd) {
  const cli = path.join(packageDirectory, 'dist/tui/cli.js')
  const pkg = JSON.parse(
    await readFile(path.join(packageDirectory, 'package.json'), 'utf8')
  )
  const env = {
    ...process.env,
    BUDINGX_API_KEY: '',
    BUDINGX_MODEL: '',
    BUDINGX_BASE_URL: ''
  }
  const version = await run(process.execPath, [cli, '--version'], { cwd, env })
  assert.equal(version.out.trim(), pkg.version)
  let calls = 0
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const request = JSON.parse(body)
    assert.equal(request.model, 'installed-fixture')
    assert.equal(req.url, '/v1/chat/completions')
    assert.equal(request.messages.at(-1).content, 'installation test')
    calls++
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(
      'data: {"choices":[{"delta":{"content":"installed-stream-ok"}}]}\n\ndata: [DONE]\n\n'
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const result = await run(
      process.execPath,
      [cli, '--prompt', 'installation test'],
      {
        cwd,
        env: {
          ...env,
          BUDINGX_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
          BUDINGX_MODEL: 'installed-fixture'
        }
      }
    )
    assert.match(result.out, /installed-stream-ok/)
    assert.equal(calls, 1)
    return {
      version: pkg.version,
      fixtureRequests: calls,
      externalProvider: 'UNVERIFIED'
    }
  } finally {
    server.closeAllConnections()
    server.close()
  }
}
