import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ConfigStore } from '../dist/storage/config-store.js'
import { startSession } from '../dist/storage/session-store.js'
import { createAgentRuntime } from '../dist/tui/runtime.js'

test('continuing in a different workspace cannot load old project messages', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-resume-workspaces-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const requests = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  const oldProject = join(home, 'first', 'repo')
  const newProject = join(home, 'second', 'repo')
  for (const cwd of [oldProject, newProject]) mkdirSync(cwd, { recursive: true })
  const configStore = new ConfigStore(join(home, 'config.json'))
  const open = (cwd, sessionId) => {
    const runtime = createAgentRuntime({
      cwd, home, sessionId, persistence: true, configStore,
      getConfig: () => ({ baseUrl, model: 'fixture', apiKey: '', timeoutMs: 3000, source: 'env' }),
      approval: { request: async () => ({ outcome: 'deny', via: 'policy' }) }
    })
    t.after(() => runtime.session.dispose())
    return runtime
  }
  const send = (runtime, prompt) => new Promise((resolve) => {
    const off = runtime.session.on((event) => {
      if (event.type === 'turn_finalized') {
        off()
        resolve(event.outcome)
      }
    })
    runtime.session.submit(prompt)
  })
  const old = open(oldProject, 'old-project')
  assert.equal(await send(old, 'Only in the old repository: refactor OldProjectMarker'), 'completed')
  const newRuntime = open(newProject, 'new-project')
  startSession({ sessionId: 'legacy-session', home, title: 'No saved workspace' })

  assert.ok(!newRuntime.sessions.list().some((entry) => entry.sessionId === 'old-project'))
  assert.ok(!newRuntime.sessions.list().some((entry) => entry.sessionId === 'legacy-session'))
  assert.match(newRuntime.sessions.resume('old-project').message, /workspace/i)
  assert.match(newRuntime.sessions.resume('legacy-session').message, /workspace/i)
  assert.equal(newRuntime.session.history.length, 0)
  assert.equal(await send(newRuntime, '继续'), 'completed')
  assert.match(JSON.stringify(requests[1].messages), /继续/)
  assert.doesNotMatch(JSON.stringify(requests[1].messages), /OldProjectMarker/)

  const sameProject = open(oldProject, 'same-project')
  assert.ok(sameProject.sessions.list().some((entry) => entry.sessionId === 'old-project'))
  assert.equal(sameProject.sessions.resume('old-project').ok, true)
  assert.equal(await send(sameProject, '继续'), 'completed')
  assert.match(JSON.stringify(requests[2].messages), /OldProjectMarker/)
})
