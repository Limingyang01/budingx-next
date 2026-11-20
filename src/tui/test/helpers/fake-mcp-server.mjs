#!/usr/bin/env node
// SP006 测试用假 MCP 服务器：stdio JSON-RPC 2.0，按行分隔。
import { appendFileSync } from 'node:fs'

const log = process.env.MCP_FAKE_LOG
let buffer = ''
const tools = [
  { name: 'echo', description: '回显参数', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
  { name: 'fail', description: '返回错误结果', inputSchema: { type: 'object', properties: {} } },
  { name: 'slow', description: '延迟响应', inputSchema: { type: 'object', properties: {} } },
  { name: 'crash', description: '让服务器退出', inputSchema: { type: 'object', properties: {} } }
]

function record(message) {
  if (!log) return
  try {
    appendFileSync(log, JSON.stringify(message) + '\n')
  } catch {
    /* 测试日志失败不影响协议 */
  }
}

function write(payload) {
  process.stdout.write(JSON.stringify(payload) + '\n')
}

function handle(message) {
  record(message)
  if (message.method === 'initialize') {
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-mcp', version: '1.2.3' }
      }
    })
    return
  }
  if (message.method === 'notifications/initialized') return
  if (message.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: message.id, result: { tools } })
    return
  }
  if (message.method === 'tools/call') {
    const name = message.params?.name
    const args = message.params?.arguments ?? {}
    if (name === 'echo') {
      write({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'echo:' + JSON.stringify(args) }] } })
      return
    }
    if (name === 'fail') {
      write({ jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: 'boom' }] } })
      return
    }
    if (name === 'slow') {
      setTimeout(() => {
        write({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'late' }] } })
      }, 5000)
      return
    }
    if (name === 'crash') {
      process.exit(1)
    }
    write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unknown tool: ' + name } })
    return
  }
  if (typeof message.id === 'number') {
    write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unknown method' } })
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  for (;;) {
    const index = buffer.indexOf('\n')
    if (index === -1) break
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    try {
      handle(JSON.parse(line))
    } catch {
      /* 忽略坏行 */
    }
  }
})
process.stdin.on('end', () => process.exit(0))
