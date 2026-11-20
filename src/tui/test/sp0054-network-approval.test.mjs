// 0.5.4：完全权限下 WebSearch 不再弹审批；非完全权限下仍需审批。
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { once } from 'node:events'
import { ConfigStore } from '../dist/storage/config-store.js'
import { createProfile } from '../dist/storage/profiles.js'
import { createAgentRuntime } from '../dist/tui/runtime.js'

async function runSearch(mode) {
  const dir = mkdtempSync(join(tmpdir(), 'budingx-net-e2e-'))
  const requests = []
  const approvals = []
  const server = createServer(async (req, res) => {
    const parts = []
    for await (const chunk of req) parts.push(chunk)
    const body = JSON.parse(Buffer.concat(parts).toString())
    requests.push(body)
    const shouldSearch = body.tools?.some((item) => item.function.name === 'WebSearch') &&
      !body.messages.some((item) => item.role === 'tool')
    const choice = shouldSearch
      ? {
          delta: {
            tool_calls: [{
              index: 0, id: 'call-search', type: 'function',
              function: { name: 'WebSearch', arguments: JSON.stringify({ query: 'today news' }) }
            }]
          },
          finish_reason: 'tool_calls'
        }
      : { delta: { content: 'Done' }, finish_reason: 'stop' }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end('data: ' + JSON.stringify({ choices: [choice] }) + '\n\ndata: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1'
  const profile = createProfile({ label: 'fixture', baseUrl, model: 'fixture', tools: true })
  const configStore = new ConfigStore(join(dir, 'config.json'))
  configStore.save({ version: 1, models: [profile] })
  const saved = process.env.BUDINGX_TAVILY_API_KEY
  process.env.BUDINGX_TAVILY_API_KEY = 'search-key'
  try {
    const runtime = createAgentRuntime({
      cwd: dir, home: dir, configStore, mode,
      getConfig: () => ({ profileId: profile.id, baseUrl, model: 'fixture', apiKey: '', timeoutMs: 3000, source: 'file' }),
      approval: {
        request: async (request) => {
          approvals.push(request)
          return { outcome: 'allow', via: 'user' }
        }
      }
    })
    const done = new Promise((resolve) => {
      const off = runtime.session.on((event) => {
        if (event.type === 'turn_finalized') { off(); resolve(event.outcome) }
      })
    })
    runtime.session.submit('search today news')
    const outcome = await done
    runtime.session.dispose()
    return { outcome, approvals }
  } finally {
    if (saved === undefined) delete process.env.BUDINGX_TAVILY_API_KEY
    else process.env.BUDINGX_TAVILY_API_KEY = saved
    server.closeAllConnections()
    server.close()
  }
}

test('0.5.4 完全权限档位：联网搜索不弹审批也能完成', async () => {
  const { outcome, approvals } = await runSearch('full_access')
  assert.equal(outcome, 'completed')
  assert.equal(approvals.length, 0, 'full access must not ask for WebSearch approval')
})

test('0.5.4 工作区修改档位：联网搜索仍需一次审批', async () => {
  const { outcome, approvals } = await runSearch('workspace_edit')
  assert.equal(outcome, 'completed')
  assert.equal(approvals.length, 1)
  assert.equal(approvals[0].name, 'WebSearch')
})
