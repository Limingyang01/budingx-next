#!/usr/bin/env node
// SP008 复测：自模拟 MCP 服务器（stdio JSON-RPC 2.0，按行分隔）。
// 与 SP006 的 fake-mcp-server 独立：额外记录 pid 与 tools/call，便于断言
// serve 关闭后子进程确实退出、以及工具是否真的被调用。
import { appendFileSync, writeFileSync } from 'node:fs'

const pidFile = process.env.SIM_MCP_PID_FILE
const callLog = process.env.SIM_MCP_CALL_LOG
const serverName = process.env.SIM_MCP_NAME ?? 'sim-mcp'
if (pidFile) writeFileSync(pidFile, String(process.pid) + '\n', 'utf8')

const tools = [
  {
    name: 'echo',
    description: '回显参数（模拟外部动作）',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } }
  }
]

function write(payload) {
  process.stdout.write(JSON.stringify(payload) + '\n')
}

function handle(message) {
  if (message.method === 'initialize') {
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: serverName, version: '0.0.1' }
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
    const args = message.params?.arguments ?? {}
    if (callLog) {
      appendFileSync(callLog, JSON.stringify({ name: message.params?.name, args }) + '\n', 'utf8')
    }
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: { content: [{ type: 'text', text: 'sim-echo:' + JSON.stringify(args) }] }
    })
    return
  }
  if (message.id !== undefined) {
    write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unknown method' } })
  }
}

let buffer = ''
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
      /* 坏行不影响协议 */
    }
  }
})
process.stdin.on('end', () => process.exit(0))
