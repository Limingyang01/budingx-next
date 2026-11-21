import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  connectMcpServers,
  loadMcpConfig,
  mcpToolName,
  McpClient,
  resolveMcpEnv,
  toAgentTools
} from '../dist/tui/mcp/index.js'

const fakeServer = fileURLToPath(new URL('./helpers/fake-mcp-server.mjs', import.meta.url))

function config(extra = {}) {
  return {
    name: 'fake',
    command: process.execPath,
    args: [fakeServer],
    ...extra
  }
}

async function withClient(fn, options = {}) {
  const client = await McpClient.connect(config(), { connectTimeoutMs: 5000, ...options })
  try {
    return await fn(client)
  } finally {
    await client.close()
  }
}

test('SM-05 握手后注册 mcp__<server>__<tool> 工具并保留 schema', async () => {
  await withClient(async (client) => {
    assert.equal(client.protocolVersion, '2024-11-05')
    assert.equal(client.serverInfo.name, 'fake-mcp')
    assert.deepEqual(
      client.tools.map((tool) => tool.name),
      ['echo', 'fail', 'slow', 'crash']
    )
    const tools = toAgentTools(client)
    const echo = tools.find((tool) => tool.name === mcpToolName('fake', 'echo'))
    assert.match(echo.name, /^mcp__fake__echo$/)
    assert.equal(echo.capability(), 'write')
    assert.equal(echo.requiresApproval(), true)
    assert.equal(echo.parameters.type, 'object')
    assert.equal(echo.parameters.properties.text.type, 'string')
    const text = await echo.execute({ text: 'hi' }, {})
    assert.equal(text, 'echo:{"text":"hi"}')
  })
})

test('SM-06 tools/call 错误结果转结构化错误码且回合可继续', async () => {
  await withClient(async (client) => {
    await assert.rejects(
      () => client.callTool('fail', {}),
      (error) => {
        assert.equal(error.code, 'BUDINGX_MCP_TOOL_ERROR')
        assert.match(error.message, /boom/)
        return true
      }
    )
    assert.equal(await client.callTool('echo', { text: 'ok' }).then(() => 'alive'), 'alive')
  })
})

test('SM-08 调用超时使用 BUDINGX_MCP_TIMEOUT 且不杀连接', async () => {
  await withClient(
    async (client) => {
      await assert.rejects(
        () => client.callTool('slow', {}),
        (error) => {
          assert.equal(error.code, 'BUDINGX_MCP_TIMEOUT')
          return true
        }
      )
    },
    { callTimeoutMs: 300 }
  )
})

test('SM-08 服务器崩溃通知 onClose 并标记关闭', async () => {
  let closedError
  const client = await McpClient.connect(config(), {
    connectTimeoutMs: 5000,
    onClose: (error) => {
      closedError = error
    }
  })
  await assert.rejects(
    () => client.callTool('crash', {}),
    (error) => {
      assert.equal(error.code, 'BUDINGX_MCP_SERVER_EXITED')
      return true
    }
  )
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(closedError?.code, 'BUDINGX_MCP_SERVER_EXITED')
  assert.equal(client.isClosed, true)
  await client.close()
})

test('SM-09 配置只接受 env 引用，明文密钥被丢弃且不回显', () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-mcp-home-'))
  try {
    mkdirSync(join(home, '.budingx'), { recursive: true })
    const secret = 'sk-plain-secret-value'
    writeFileSync(
      join(home, '.budingx', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          alpha: {
            command: process.execPath,
            args: [fakeServer],
            env: { TOKEN: '${MCP_FAKE_TOKEN}', LEAK: secret }
          },
          beta: { command: 'node', enabled: false }
        }
      })
    )
    const loaded = loadMcpConfig(home)
    assert.equal(loaded.servers.length, 2)
    assert.deepEqual(loaded.servers[0].env, { TOKEN: '${MCP_FAKE_TOKEN}' })
    const warnings = loaded.warnings.join('\n')
    assert.match(warnings, /LEAK/)
    assert.doesNotMatch(warnings, new RegExp(secret))
    assert.equal(resolveMcpEnv({ TOKEN: '${MCP_FAKE_TOKEN}', RAW: 'nope' }, { MCP_FAKE_TOKEN: 'v' }).TOKEN, 'v')
    assert.deepEqual(resolveMcpEnv({ RAW: 'nope' }, {}), {})
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('SM-08 配置损坏或服务器启动失败只降级自身', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-mcp-bad-'))
  try {
    mkdirSync(join(home, '.budingx'), { recursive: true })
    writeFileSync(join(home, '.budingx', 'mcp.json'), '{ not json')
    const corrupt = loadMcpConfig(home)
    assert.equal(corrupt.corrupt, true)
    assert.equal(corrupt.servers.length, 0)
    assert.match(corrupt.warnings.join('\n'), /不是有效 JSON/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }

  const connected = await connectMcpServers(
    [
      config({ name: 'good' }),
      { name: 'broken', command: 'budingx-definitely-missing-command', args: [] },
      config({ name: 'off', enabled: false })
    ],
    { connectTimeoutMs: 5000 }
  )
  try {
    assert.equal(connected.clients.length, 1)
    assert.equal(connected.tools.filter((tool) => tool.name.startsWith('mcp__good__')).length, 4)
    assert.deepEqual(
      connected.statuses.map((status) => [status.name, status.connected]),
      [
        ['good', true],
        ['broken', false],
        ['off', false]
      ]
    )
    assert.equal(connected.statuses[2].error, 'disabled')
    assert.equal(connected.warnings.length, 1)
    assert.match(connected.warnings[0], /broken/)
  } finally {
    await connected.close()
  }
})
