#!/usr/bin/env node
// SP008 复测：自模拟 MCP 服务器（stdio JSON-RPC 2.0，按行分隔）。
// 与 SP006 的 fake-mcp-server 独立：额外记录 pid 与 tools/call，便于断言
// serve 关闭后子进程确实退出、以及工具是否真的被调用。
//
// 可配置行为（全部通过环境变量，保持配置里只有 ${ENV} 引用）：
//   SIM_MCP_PID_FILE   —— 落盘 pid，验证子进程生命周期
//   SIM_MCP_CALL_LOG   —— 追加每次 tools/call 的 {name,args}
//   SIM_MCP_NAME       —— serverInfo.name（默认 sim-mcp）
//   SIM_MCP_TOOLS      —— 工具名列表，逗号分隔（默认 echo）
//   SIM_MCP_FAIL_TOOL  —— 该工具名调用时返回 isError 结果
//   SIM_MCP_FAIL_MODE  —— error | crash（crash 表示调用后进程退出）
//   SIM_MCP_DELAY_MS   —— tools/call 延迟毫秒数
import { appendFileSync, writeFileSync } from 'node:fs'

const pidFile = process.env.SIM_MCP_PID_FILE
const callLog = process.env.SIM_MCP_CALL_LOG
const serverName = process.env.SIM_MCP_NAME ?? 'sim-mcp'
const toolNames = (process.env.SIM_MCP_TOOLS ?? 'echo').split(',').map((n) => n.trim()).filter(Boolean)
const failTool = process.env.SIM_MCP_FAIL_TOOL ?? ''
const failMode = process.env.SIM_MCP_FAIL_MODE ?? 'error'
const delayMs = Number(process.env.SIM_MCP_DELAY_MS ?? '0')
if (pidFile) writeFileSync(pidFile, String(process.pid) + '\n', 'utf8')

const tools = toolNames.map((name) => ({
  name,
  description: '模拟外部动作 ' + name,
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } }
}))

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
    const name = message.params?.name
    const args = message.params?.arguments ?? {}
    if (callLog) {
      appendFileSync(callLog, JSON.stringify({ name, args }) + '\n', 'utf8')
    }
    const respond = () => {
      if (failTool && name === failTool) {
        if (failMode === 'crash') {
          process.exit(7)
          return
        }
        write({
          jsonrpc: '2.0',
          id: message.id,
          result: { isError: true, content: [{ type: 'text', text: 'simulated tool failure' }] }
        })
        return
      }
      write({
        jsonrpc: '2.0',
        id: message.id,
        result: { content: [{ type: 'text', text: 'sim-echo:' + JSON.stringify(args) }] }
      })
    }
    if (delayMs > 0) setTimeout(respond, delayMs)
    else respond()
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
