import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { connectMcpServers, loadMcpConfig } from '../dist/tui/mcp/index.js'
import { createAgentRuntime } from '../dist/tui/runtime.js'
import { ConfigStore } from '../dist/storage/config-store.js'
import { createProfile } from '../dist/storage/profiles.js'

const fakeServer = fileURLToPath(new URL('./helpers/fake-mcp-server.mjs', import.meta.url))

test('SM-07 MCP 调用走审批通道；拒绝时不触达服务端且回合继续', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'budingx-mcp-approve-'))
  const home = join(root, 'home')
  const cwd = join(root, 'workspace')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  const logPath = join(root, 'mcp.log')
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push(JSON.parse(body))
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (requests.length === 1) {
      res.end(
        'data: ' +
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-mcp',
                      type: 'function',
                      function: { name: 'mcp__fake__echo', arguments: '{"text":"hi"}' }
                    }
                  ]
                },
                finish_reason: 'tool_calls'
              }
            ]
          }) +
          '\n\ndata: [DONE]\n\n'
      )
      return
    }
    res.end('data: {"choices":[{"delta":{"content":"after-denial"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
  })
  const requests = []
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1'

  const previous = process.env.MCP_FAKE_LOG
  process.env.MCP_FAKE_LOG = logPath
  const connected = await connectMcpServers([
    { name: 'fake', command: process.execPath, args: [fakeServer] }
  ])
  if (previous === undefined) delete process.env.MCP_FAKE_LOG
  else process.env.MCP_FAKE_LOG = previous
  t.after(() => connected.close())
  assert.equal(connected.clients.length, 1)

  const profile = createProfile({ label: 'mcp', baseUrl, model: 'fixture', tools: true })
  const configStore = new ConfigStore(join(home, 'config.json'))
  configStore.save({ version: 1, models: [profile], defaultModelId: profile.id })
  const approvalCalls = []
  const runtime = createAgentRuntime({
    cwd,
    home,
    configStore,
    mode: 'workspace_edit',
    mcp: { tools: connected.tools, statuses: connected.statuses },
    getConfig: () => ({
      profileId: profile.id,
      baseUrl,
      model: 'fixture',
      apiKey: '',
      timeoutMs: 5000,
      source: 'file'
    }),
    approval: {
      request: async (request) => {
        approvalCalls.push(request)
        return { outcome: 'deny', via: 'user' }
      }
    }
  })
  t.after(() => runtime.session.dispose())
  assert.ok(runtime.toolNames.includes('mcp__fake__echo'))

  const denials = []
  const done = new Promise((resolve) => {
    const off = runtime.session.on((event) => {
      if (event.type === 'denial_recorded') denials.push(event.denial)
      if (event.type === 'turn_finalized') {
        off()
        resolve(event)
      }
    })
  })
  runtime.session.submit('调用 MCP 工具')
  const finalized = await done

  assert.equal(finalized.outcome, 'completed')
  assert.equal(denials.length, 1)
  assert.match(denials[0].tool, /mcp__fake__echo/)
  assert.equal(approvalCalls.length, 1)
  assert.ok(requests[1].messages.some((message) => message.role === 'tool'))
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
  assert.doesNotMatch(log, /"tools\/call"/)
  assert.doesNotMatch(log, /"echo"/)
})

test('SM-08 配置启用 MCP 时 runtime 声明工具与状态；关闭后工具消失', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-mcp-runtime-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, '.budingx'), { recursive: true })
  const loaded = loadMcpConfig(home)
  assert.deepEqual(loaded.servers, [])
  const connected = await connectMcpServers(
    [{ name: 'fake', command: process.execPath, args: [fakeServer] }],
    { callTimeoutMs: 1000 }
  )
  t.after(() => connected.close())
  assert.deepEqual(
    connected.tools.map((tool) => tool.name),
    ['mcp__fake__echo', 'mcp__fake__fail', 'mcp__fake__slow', 'mcp__fake__crash']
  )
  assert.equal(connected.statuses[0].serverName, 'fake-mcp')
  assert.equal(connected.statuses[0].tools, 4)
})
