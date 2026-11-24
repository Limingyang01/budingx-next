import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { McpError, type McpServerConfig } from './types.js'

export type RpcMessage = {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: any
  result?: any
  error?: { code: number; message: string }
}

type Receiver = { receive(message: RpcMessage): void; disconnected(): void }
type Transport = {
  send(message: RpcMessage, signal: AbortSignal): Promise<void>
  initialized?(version: string): void
  close(): void
}

export function resolveMcpEnv(
  env: Record<string, string> | undefined,
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const entries: [string, string][] = []
  for (const [key, value] of Object.entries(env ?? {})) {
    const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value.trim())
    const resolved = match && source[match[1]!]
    if (resolved != null) entries.push([key, resolved])
  }
  return Object.fromEntries(entries)
}

export function remoteUrl(raw: string, ws: boolean): URL {
  const url = new URL(raw)
  if (
    !(ws ? ['ws:', 'wss:'] : ['http:', 'https:']).includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error('Invalid MCP endpoint')
  }
  return url
}

// CRLF, LF and CR are all SSE line endings. Buffer only the current event.
async function readEvents(response: Response, event: (name: string, data: string) => void): Promise<void> {
  if (
    !response.ok ||
    response.headers.get('content-type')?.split(';')[0]?.trim() !== 'text/event-stream' ||
    !response.body
  )
    throw new Error('Invalid MCP event stream')
  const decoder = new TextDecoder()
  let pending = '',
    name = '',
    data: string[] = [],
    size = 0,
    previousCR = false
  const limit = 8 * 1024 * 1024
  const line = (value: string) => {
    if (!value) {
      if (data.length) event(name || 'message', data.join('\n'))
      name = ''
      data = []
      size = 0
      return
    }
    const colon = value.indexOf(':')
    const field = colon < 0 ? value : value.slice(0, colon)
    const content = colon < 0 ? '' : value.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') name = content
    if (field === 'data') {
      size += content.length + 1
      if (size > limit) throw new Error('MCP event too large')
      data.push(content)
    }
  }
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    let text = decoder.decode(chunk, { stream: true })
    if (!text) continue
    if (previousCR && text.startsWith('\n')) text = text.slice(1)
    previousCR = text.endsWith('\r')
    const lines = text.split(/\r\n|\r|\n/)
    pending += lines[0]
    if (pending.length > limit) throw new Error('MCP event too large')
    if (lines.length === 1) continue
    line(pending)
    for (let i = 1; i < lines.length - 1; i++) line(lines[i]!)
    pending = lines.at(-1)!
  }
}

export async function openTransport(
  config: McpServerConfig,
  source: NodeJS.ProcessEnv,
  receiver: Receiver,
  signal: AbortSignal
): Promise<Transport> {
  signal.throwIfAborted()
  if ('command' in config) {
    const defaults = Object.entries(source).filter(([name]) =>
      /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|HOME|USERPROFILE|TMP|TEMP|TMPDIR|LANG|LC_.*|APPDATA|LOCALAPPDATA)$/i.test(
        name
      )
    )
    const child = spawn(config.command, config.args ?? [], {
      env: { ...Object.fromEntries(defaults), ...resolveMcpEnv(config.env, source) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    child.stderr.resume()
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      try {
        receiver.receive(JSON.parse(line))
      } catch {
        /* ignore non-RPC lines */
      }
    })
    child.on('error', receiver.disconnected)
    child.on('exit', receiver.disconnected)
    child.stdin.on('error', receiver.disconnected)
    return {
      send: async (message) => {
        await new Promise<void>((resolve, reject) =>
          child.stdin.write(JSON.stringify(message) + '\n', (error) => (error ? reject(error) : resolve()))
        )
      },
      close() {
        lines.close()
        child.stdin.end()
        child.kill()
      }
    }
  }
  const url = remoteUrl(config.url, config.type === 'ws')
  const headers = resolveMcpEnv(config.headers, source)
  if (Object.keys(headers).length !== Object.keys(config.headers ?? {}).length)
    throw new Error('Missing MCP header reference')
  if (config.type === 'ws') {
    // Node's built-in WebSocket supports WebSocketInit.headers in the second argument.
    const Ws = WebSocket as unknown as new (
      url: string,
      options: { headers: Record<string, string>; protocols: string[] }
    ) => WebSocket
    const ws = new Ws(url.href, { headers, protocols: ['mcp'] })
    ws.addEventListener('message', (e) => {
      try {
        receiver.receive(JSON.parse(String(e.data)))
      } catch {
        receiver.disconnected()
      }
    })
    ws.addEventListener('close', receiver.disconnected)
    ws.addEventListener('error', receiver.disconnected)
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        ws.close()
        reject(new Error('Connection cancelled'))
      }
      const done = (e: Event) => {
        ws.removeEventListener('open', done)
        ws.removeEventListener('error', done)
        ws.removeEventListener('close', done)
        signal.removeEventListener('abort', abort)
        if (e.type === 'open') resolve()
        else reject(new Error('WebSocket unavailable'))
      }
      ws.addEventListener('open', done)
      ws.addEventListener('error', done)
      ws.addEventListener('close', done)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
    return { send: async (msg) => ws.send(JSON.stringify(msg)), close: () => ws.close() }
  }

  const controller = new AbortController()
  const legacy = config.type === 'sse'
  let session: string | undefined
  let version: string | undefined
  let endpoint = url
  function fetchMcp(method: string, target: URL, active: AbortSignal, message?: RpcMessage) {
    return fetch(target, {
      method,
      redirect: 'error',
      signal: active,
      headers: {
        ...headers,
        Accept: method === 'GET' ? 'text/event-stream' : 'application/json, text/event-stream',
        ...(message ? { 'Content-Type': 'application/json' } : {}),
        ...(!legacy && version ? { 'MCP-Protocol-Version': version } : {}),
        ...(!legacy && session ? { 'Mcp-Session-Id': session } : {})
      },
      ...(message ? { body: JSON.stringify(message) } : {})
    })
  }
  const eventMessage = (name: string, data: string) => {
    if (name === 'message') receiver.receive(JSON.parse(data))
  }
  if (legacy) {
    // The endpoint event is part of the handshake; let its deadline also cover silent streams.
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    try {
      const response = await fetchMcp('GET', url, controller.signal)
      await new Promise<void>((resolve, reject) => {
        void readEvents(response, (name, data) => {
          if (name === 'endpoint') {
            const next = new URL(data, url)
            if (next.origin !== url.origin || next.username || next.password || next.hash)
              throw new Error('Invalid MCP endpoint origin')
            endpoint = next
            resolve()
          } else eventMessage(name, data)
        }).then(
          () => {
            reject(new Error('MCP stream closed'))
            receiver.disconnected()
          },
          () => {
            reject(new Error('Invalid MCP stream'))
            receiver.disconnected()
          }
        )
      })
    } catch (error) {
      controller.abort()
      throw error
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }
  async function listen() {
    const response = await fetchMcp('GET', url, controller.signal)
    if (response.status === 405) {
      await response.body?.cancel()
      return
    }
    await readEvents(response, eventMessage)
    receiver.disconnected()
  }
  return {
    initialized(negotiated) {
      version = negotiated
    },
    async send(message, requestSignal) {
      const active = AbortSignal.any([controller.signal, requestSignal])
      const response = await fetchMcp('POST', endpoint, active, message)
      if (!response.ok) {
        await response.body?.cancel()
        throw new McpError(
          response.status === 404 ? 'BUDINGX_MCP_SERVER_EXITED' : 'BUDINGX_MCP_PROTOCOL',
          'MCP HTTP ' + response.status
        )
      }
      if (!legacy && message.method === 'initialize')
        session = response.headers.get('mcp-session-id') ?? undefined
      if (legacy || !message.method || message.id === undefined) {
        await response.body?.cancel()
        if (!legacy && message.method === 'notifications/initialized') {
          void listen().catch(() => {
            if (!controller.signal.aborted) receiver.disconnected()
          })
        }
        return
      }
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim()
      if (contentType === 'application/json') {
        const reply = (await response.json()) as RpcMessage
        if (reply.id !== message.id || reply.method) throw new Error('Invalid MCP response')
        receiver.receive(reply)
      } else if (contentType === 'text/event-stream') {
        let answered = false
        await readEvents(response, (name, data) => {
          if (name !== 'message') return
          const reply = JSON.parse(data)
          if (!reply.method && reply.id === message.id) answered = true
          receiver.receive(reply)
        })
        if (!answered) throw new Error('Incomplete MCP response stream')
      } else {
        await response.body?.cancel()
        throw new Error('Invalid MCP response type')
      }
    },
    close() {
      controller.abort()
      if (!legacy && session)
        void fetchMcp('DELETE', url, AbortSignal.timeout(1000))
          .then((res) => res.body?.cancel())
          .catch(() => {})
    }
  }
}
