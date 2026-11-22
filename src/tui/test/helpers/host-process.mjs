// SP008 T11：真实 serve 子进程夹具，供归属、崩溃恢复与三传输一致性用例复用。
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HostClient } from '../../dist/host/client.js'
import { connectWebSocket } from '../../dist/host/transport/ws-client.js'

export const cli = fileURLToPath(new URL('../../dist/tui/cli.js', import.meta.url))

/**
 * Fake OpenAI-compatible SSE endpoint.
 *
 * mode selects the first-turn behaviour:
 *   'text' —— 普通文本回答
 *   'bash' —— 请求 Bash 工具（用于审批往返）
 *   'mcp'  —— 请求 MCP 工具 mcp__sim__echo
 *   'slow' —— 首片段后保持流不结束（用于 interrupt 端到端）
 * options.toolCall 可覆盖工具名/参数/调用 id；options.requests 暴露收到的请求体，
 * 便于断言 additionalContext 是否进入模型上下文。
 */
export async function startFixtureServer(t, mode = 'text', options = {}) {
  const requests = []
  const server = createServer(async (req, res) => {
    const parts = []
    for await (const chunk of req) parts.push(chunk)
    const body = parts.length > 0 ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}
    requests.push(body)
    if (mode === 'slow') {
      // 首片段后保持流不结束：回合停留在 streaming，直到宿主 interrupt。
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
      return
    }
    const hasToolResult = (body.messages ?? []).some((item) => item.role === 'tool')
    const toolCall = options.toolCall
      ? { id: options.toolCall.id ?? 'call-custom', ...options.toolCall }
      : mode === 'bash'
        ? { id: 'call-bash', name: 'Bash', args: { command: 'rm -rf sp008-approval-temp' } }
        : mode === 'mcp'
          ? { id: 'call-mcp', name: 'mcp__sim__echo', args: { text: 'hello' } }
          : undefined
    const choice =
      toolCall && !hasToolResult
        ? {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: toolCall.id,
                  type: 'function',
                  function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args) }
                }
              ]
            },
            finish_reason: 'tool_calls'
          }
        : { delta: { content: 'pong' }, finish_reason: 'stop' }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end('data: ' + JSON.stringify({ choices: [choice] }) + '\n\ndata: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  return {
    baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1',
    get requestCount() {
      return requests.length
    },
    get requests() {
      return requests
    }
  }
}

function stdioTransport(child) {
  let raw = ''
  const lineListeners = new Set()
  const closeListeners = new Set()
  child.stdout.on('data', (data) => {
    raw += data
    const parts = raw.split('\n')
    raw = parts.pop() ?? ''
    for (const part of parts) {
      if (!part.trim()) continue
      for (const listener of lineListeners) listener(part)
    }
  })
  child.on('close', () => {
    for (const listener of closeListeners) listener()
  })
  return {
    write(text) {
      child.stdin.write(text)
    },
    onLine(listener) {
      lineListeners.add(listener)
      return () => lineListeners.delete(listener)
    },
    onClose(listener) {
      closeListeners.add(listener)
      return () => closeListeners.delete(listener)
    },
    close() {
      child.stdin.end()
    }
  }
}

/**
 * Spawn the serve command with a fresh home and return a HostClient plus
 * process handles. Await ready before connect; ws resolves to its url.
 */
export function spawnServe(t, options) {
  const home = options.home ?? mkdtempSync(join(tmpdir(), 'budingx-sp008-'))
  const transportName = options.args[options.args.indexOf('--transport') + 1]
  const forwarded =
    transportName === 'ws' && !options.args.includes('--token')
      ? [...options.args, '--token', 'test-token']
      : options.args
  // MCP 夹具的环境变量必须透传给 serve 进程，再由 mcp.json 的 ${ENV} 引用解析。
  const child = spawn(
    process.execPath,
    [cli, 'serve', ...forwarded, '--home', home],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BUDINGX_API_KEY: 'fixture-key',
        BUDINGX_MODEL: 'fixture',
        BUDINGX_BASE_URL: options.baseUrl,
        HOME: home,
        USERPROFILE: home,
        ...(options.env ?? {})
      },
      windowsHide: true
    }
  )
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill()
  })
  let stderr = ''
  child.stderr.on('data', (data) => {
    stderr += data
  })
  const closed = new Promise((resolveClose) => {
    child.on('close', (code, signal) => resolveClose({ code, signal }))
  })
  const recorded = []
  const mode = options.args[options.args.indexOf('--transport') + 1]
  let transport = mode === 'ws' ? undefined : stdioTransport(child)
  const ready = new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error('serve did not become ready: ' + stderr)), 20_000)
    const check = () => {
      const match = /listening on (ws:\/\/\S+)/.exec(stderr)
      if (match) {
        clearTimeout(timer)
        resolveReady(match[1])
        return
      }
      if (stderr.includes('ready on stdio')) {
        clearTimeout(timer)
        resolveReady('stdio')
      }
    }
    child.stderr.on('data', check)
    check()
  })
  ready.catch(() => {})
  return {
    home,
    child,
    mode,
    closed,
    ready,
    recorded,
    get stderr() {
      return stderr
    },
    async connect(connectOptions = {}) {
      if (mode === 'ws') {
        const url = await ready
        const raw = await connectWebSocket({ url, token: connectOptions.token ?? 'test-token' })
        const rawWrite = raw.write.bind(raw)
        const rawOnLine = raw.onLine.bind(raw)
        const rawOnClose = raw.onClose.bind(raw)
        transport = {
          write: (text) => rawWrite(text),
          onLine: (listener) =>
            rawOnLine((line) => {
              recorded.push(line)
              listener(line)
            }),
          onClose: (listener) => rawOnClose(listener),
          close: (reason) => raw.close(reason)
        }
      } else {
        await ready
        const base = transport
        const baseWrite = base.write.bind(base)
        const baseOnLine = base.onLine.bind(base)
        const baseOnClose = base.onClose.bind(base)
        transport = {
          write: (text) => baseWrite(text),
          onLine: (listener) =>
            baseOnLine((line) => {
              recorded.push(line)
              listener(line)
            }),
          onClose: (listener) => baseOnClose(listener),
          close: (reason) => base.close(reason)
        }
      }
      const client = new HostClient({
        transport,
        requestTimeoutMs: connectOptions.requestTimeoutMs ?? 15_000,
        ...(connectOptions.clientId ? { clientId: connectOptions.clientId } : {})
      })
      const hello = await client.connect()
      return { client, hello, transport }
    }
  }
}
