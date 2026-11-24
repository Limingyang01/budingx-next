import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { connectMcpServers } from '../dist/tui/mcp/index.js'
import { peerReply, remotePeer } from './helpers/sp009-mcp-peer.mjs'

async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return
    await delay(10)
  }
  assert.fail('MCP fixture did not reach expected state')
}

for (const type of ['stdio', 'http', 'sse', 'ws']) {
  test('AC-MCP-01 ' + type + ' handshake, authenticated discovery, tool and resource read', async (t) => {
    const peer = type === 'stdio' ? undefined : await remotePeer(t, type)
    const config = peer
      ? { name: 'one', type, url: peer.url, headers: { Authorization: '${TOKEN}' } }
      : {
          name: 'one',
          command: process.execPath,
          args: [fileURLToPath(new URL('./helpers/sp009-mcp-peer.mjs', import.meta.url))]
        }
    const manager = await connectMcpServers([config], { env: { TOKEN: 'Bearer fixture-only' } })
    t.after(() => manager.close())
    assert.equal(manager.statuses[0].connected, true)
    assert.equal(manager.statuses[0].resources, 1)
    const run = async (suffix, input = {}) => {
      const tool = manager.tools.find((item) => item.name === 'mcp__one__' + suffix)
      assert.equal(tool.requiresApproval(), true)
      return tool.execute(input, {})
    }
    assert.equal(await run('echo'), 'echo')
    assert.match(await run('list_resources'), /fixture:\/\/docs\/readme/)
    assert.match(await run('read_resource', { uri: 'fixture://docs/readme' }), /hello resource/)
    await assert.rejects(() => run('read_resource', { uri: 'fixture://other/source' }))
    if (peer) {
      assert.ok(peer.headers.every((headers) => headers.authorization === 'Bearer fixture-only'))
      assert.doesNotMatch(JSON.stringify(manager.statuses), /private-route|fixture-only/)
    }
  })
}

test('AC-MCP-02 remote failure withdraws tools, retries discovery but never replays an inflight call', async (t) => {
  const peer = await remotePeer(t, 'ws')
  const manager = await connectMcpServers([{ name: 'one', type: 'ws', url: peer.url }], {
    reconnectDelayMs: 20
  })
  t.after(() => manager.close())
  const counts = []
  manager.subscribe(() => counts.push(manager.tools.length))
  peer.dropCall()
  await assert.rejects(() => manager.clients[0].callTool('echo', {}))
  await until(
    () => peer.log.filter((m) => m.method === 'initialize').length === 2 && manager.statuses[0].connected
  )
  assert.ok(counts.includes(0))
  assert.equal(peer.log.filter((m) => m.method === 'tools/call').length, 1)
  await manager.stop('one')
  assert.equal(manager.tools.length, 0)
  await delay(80)
  assert.equal(peer.log.filter((m) => m.method === 'initialize').length, 2)
  await manager.start('one')
  assert.equal(manager.statuses[0].connected, true)
  await manager.reconnect('one')
  assert.equal(peer.log.filter((m) => m.method === 'initialize').length, 4)
})

test('AC-MCP-03 confirmation outcomes, cancellation, timeout and unsupported requests', async (t) => {
  const peer = await remotePeer(t, 'ws')
  const signals = []
  const manager = await connectMcpServers([{ name: 'one', type: 'ws', url: peer.url }], {
    elicitationTimeoutMs: 120,
    onElicitation: async ({ server, message, signal }) => {
      assert.equal(server, 'one')
      signals.push(signal)
      return message === 'wait' ? new Promise(() => {}) : message
    }
  })
  t.after(() => manager.close())
  assert.equal(manager.statuses[0].connected, true)
  assert.deepEqual(peer.log[0].params.capabilities, { elicitation: {} })
  async function ask(id, message, cancel = false, schema = { type: 'object', properties: {} }) {
    peer.send({
      jsonrpc: '2.0',
      id,
      method: 'elicitation/create',
      params: { message, requestedSchema: schema }
    })
    if (cancel) peer.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id } })
    await until(() => peer.log.some((m) => m.id === id && m.result))
    return peer.log.find((m) => m.id === id && m.result).result
  }
  assert.deepEqual(await ask(1, 'accept'), { action: 'accept', content: {} })
  assert.deepEqual(await ask(2, 'decline'), { action: 'decline' })
  assert.deepEqual(await ask(3, 'cancel'), { action: 'cancel' })
  assert.deepEqual(await ask(4, 'wait'), { action: 'cancel' })
  assert.equal(signals.at(-1).aborted, true)
  assert.deepEqual(await ask(5, 'wait', true), { action: 'cancel' })
  assert.equal(signals.at(-1).aborted, true)
  assert.deepEqual(
    await ask(6, 'accept', false, { type: 'object', properties: { name: { type: 'string' } } }),
    { action: 'decline' }
  )
  peer.send({ jsonrpc: '2.0', id: 'sampling', method: 'sampling/createMessage', params: {} })
  await until(() => peer.log.some((m) => m.id === 'sampling' && m.error?.code === -32601))
})

test('AC-MCP-03 SSE announced cross-origin endpoint receives no credentials', async (t) => {
  const other = await remotePeer(t, 'http')
  const peer = await remotePeer(t, 'sse', { endpoint: other.url })
  const manager = await connectMcpServers(
    [{ name: 'one', type: 'sse', url: peer.url, headers: { Authorization: '${TOKEN}' } }],
    { env: { TOKEN: 'private-value' }, connectTimeoutMs: 300 }
  )
  t.after(() => manager.close())
  assert.equal(manager.statuses[0].connected, false)
  assert.equal(other.headers.length, 0)
  assert.doesNotMatch(JSON.stringify(manager.statuses), /private-value|private-route/)
})

test('AC-MCP-02 catalog notifications withdraw removed tools/resources, stale handlers fail closed', async (t) => {
  let available = true
  const peer = await remotePeer(t, 'ws', {
    wsProtocol: true,
    reply: (msg) => {
      if (!available && msg.method === 'tools/list') return { tools: [] }
      if (!available && msg.method === 'resources/list') return { resources: [] }
      return peerReply(msg)
    }
  })
  const manager = await connectMcpServers([{ name: 'A', type: 'ws', url: peer.url }])
  t.after(() => manager.close())
  assert.equal(manager.statuses[0].connected, true)
  const echo = manager.tools.find((tool) => tool.name === 'mcp__A__echo')
  const read = manager.tools.find((tool) => tool.name === 'mcp__A__read_resource')
  const list = manager.tools.find((tool) => tool.name === 'mcp__A__list_resources')
  available = false
  peer.send({ jsonrpc: '2.0', method: 'notifications/resources/list_changed' })
  await until(
    () => !manager.tools.some((tool) => tool.name === echo.name) && manager.statuses[0].resources === 0
  )
  await assert.rejects(() => echo.execute({}, {}))
  await assert.rejects(() => read.execute({ uri: 'fixture://docs/readme' }, {}))
  await manager.stop('A')
  await assert.rejects(() => list.execute({}, {}))
})

test('AC-MCP-02 recovery is bounded at five retries and healthy origins stay usable', async (t) => {
  const bad = await remotePeer(t, 'http', {
    reply: (msg) => (msg.method === 'initialize' ? { protocolVersion: 'unsupported' } : peerReply(msg))
  })
  const healthy = await remotePeer(t, 'ws')
  const manager = await connectMcpServers(
    [
      { name: 'bad', type: 'http', url: bad.url },
      { name: 'ok', type: 'ws', url: healthy.url }
    ],
    { reconnectDelayMs: 4, connectTimeoutMs: 600 }
  )
  t.after(() => manager.close())
  await until(() => bad.log.filter((msg) => msg.method === 'initialize').length === 6)
  await delay(200)
  assert.equal(bad.log.filter((msg) => msg.method === 'initialize').length, 6)
  assert.equal(manager.statuses[0].state, 'disconnected')
  assert.ok(await manager.clients[0].callTool('echo', {}))
})

test('AC-MCP-03 noninteractive client declines confirmation and does not advertise elicitation', async (t) => {
  const peer = await remotePeer(t, 'sse')
  const manager = await connectMcpServers([{ name: 'one', type: 'sse', url: peer.url }])
  t.after(() => manager.close())
  assert.deepEqual(peer.log[0].params.capabilities, {})
  peer.send({
    jsonrpc: '2.0',
    id: 'confirm',
    method: 'elicitation/create',
    params: { message: 'confirm?', requestedSchema: { type: 'object', properties: {} } }
  })
  await until(() => peer.log.find((msg) => msg.id === 'confirm' && msg.result?.action === 'decline'))
})

test('AC-MCP-02 simultaneous reconnect then stop leaves server stopped', async (t) => {
  const peer = await remotePeer(t, 'ws')
  const manager = await connectMcpServers([{ name: 'A', type: 'ws', url: peer.url }])
  t.after(() => manager.close())
  await Promise.all([manager.reconnect('A'), manager.stop('A')])
  assert.equal(manager.statuses[0].state, 'disabled')
  assert.equal(manager.tools.length, 0)
})

test('AC-MCP-03 stdio preserves explicit ordinary env and isolates unrelated secrets and server metadata', async (t) => {
  const config = {
    name: 'one',
    command: process.execPath,
    args: [fileURLToPath(new URL('./helpers/sp009-mcp-peer.mjs', import.meta.url)), '--env-check'],
    env: { MCP_TEST_BINDING: '${MY_KEY}', MCP_TEST_LABEL: '${ORDINARY_LABEL}' }
  }
  const manager = await connectMcpServers([config], {
    env: { MY_KEY: 'synthetic-private', ORDINARY_LABEL: 'ordinary', NOT_FOR_THIS_SERVER: 'other' }
  })
  t.after(() => manager.close())
  assert.equal(manager.statuses[0].connected, true)
  assert.doesNotMatch(JSON.stringify(manager.statuses), /synthetic-private/)
  const result = await manager.clients[0].callTool('echo', {})
  assert.deepEqual(JSON.parse(result.content[0].text), {
    explicit: 'ordinary', leaked: false, echoBinding: '[redacted]'
  })
})

test('AC-MCP-03 normalized tool names never move between source identities as servers stop', async (t) => {
  const a = await remotePeer(t, 'ws'),
    b = await remotePeer(t, 'ws')
  const manager = await connectMcpServers([
    { name: 'a.b', type: 'ws', url: a.url },
    { name: 'a_b', type: 'ws', url: b.url }
  ])
  t.after(() => manager.close())
  assert.equal(manager.tools.length, 0)
  await manager.stop('a.b')
  assert.equal(manager.tools.length, 0)
})
