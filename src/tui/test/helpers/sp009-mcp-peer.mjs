import { createServer } from 'node:http'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { decodeWsFrame, encodeWsFrame, wsAccept } from '../../dist/host/transport/ws-frames.js'

const uri = 'fixture://docs/readme'
export function peerReply(msg) {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: msg.params.protocolVersion,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'fixture', version: '1' }
      }
    case 'tools/list':
      return { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
    case 'tools/call':
      return { content: [{ type: 'text', text: 'echo' }] }
    case 'resources/list':
      return { resources: [{ uri, name: 'readme' }] }
    case 'resources/read':
      return { contents: [{ uri, text: 'hello resource' }] }
    default:
      return undefined
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  createInterface({ input: process.stdin }).on('line', (line) => {
    const msg = JSON.parse(line)
    const result = peerReply(msg)
    if (process.argv.includes('--env-check') && result) {
      if (msg.method === 'initialize') result.serverInfo.name = process.env.MCP_TEST_BINDING
      if (msg.method === 'tools/call')
        result.content[0].text = JSON.stringify({
          explicit: process.env.MCP_TEST_LABEL,
          leaked: process.env.NOT_FOR_THIS_SERVER !== undefined,
          echoBinding: process.env.MCP_TEST_BINDING
        })
    }
    if (result) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n')
  })
}

export async function remotePeer(
  t,
  type,
  { endpoint = '/messages', reply = peerReply, wsProtocol = false } = {}
) {
  let push, disconnect
  const log = [],
    headers = []
  const sockets = new Set()
  let drop = false
  function receive(msg, send, fail) {
    log.push(msg)
    if (drop && msg.method === 'tools/call') {
      drop = false
      fail()
      return
    }
    const result = reply(msg)
    if (result) send({ jsonrpc: '2.0', id: msg.id, result })
  }
  const server = createServer(async (req, res) => {
    headers.push(req.headers)
    const event = (name, payload) => res.write('event: ' + name + '\r\ndata: ' + payload + '\r\n\r\n')
    if (req.method === 'GET') {
      if (type === 'http' && !log.some((msg) => msg.method === 'notifications/initialized')) {
        res.writeHead(409).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.flushHeaders()
      if (type === 'sse') event('endpoint', endpoint)
      push = (msg) => event('message', JSON.stringify(msg))
      disconnect = () => res.destroy()
      return
    }
    if (req.method === 'DELETE') {
      res.writeHead(204).end()
      return
    }
    let body = ''
    for await (const chunk of req) body += chunk
    const msg = JSON.parse(body)
    if (type === 'sse') {
      if (req.url !== endpoint) {
        res.writeHead(404).end()
        return
      }
      receive(msg, push, disconnect)
      res.writeHead(202).end()
      return
    }
    if (
      msg.method !== 'initialize' &&
      (req.headers['mcp-session-id'] !== 's1' || !req.headers['mcp-protocol-version'])
    ) {
      res.writeHead(400).end()
      return
    }
    if (msg.method === 'initialize') res.setHeader('Mcp-Session-Id', 's1')
    if (!msg.method || msg.id === undefined) {
      log.push(msg)
      res.writeHead(202).end()
      return
    }
    receive(
      msg,
      (data) => {
        if (msg.method === 'tools/call') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          event('message', JSON.stringify(data))
          res.end()
        } else res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data))
      },
      () => res.destroy()
    )
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  server.on('upgrade', (req, socket, head) => {
    headers.push(req.headers)
    if (wsProtocol && req.headers['sec-websocket-protocol'] !== 'mcp') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      return
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
        wsAccept(req.headers['sec-websocket-key']) +
        (req.headers['sec-websocket-protocol'] === 'mcp' ? '\r\nSec-WebSocket-Protocol: mcp' : '') +
        '\r\n\r\n'
    )
    push = (msg) => socket.write(encodeWsFrame(1, Buffer.from(JSON.stringify(msg)), { mask: false }))
    disconnect = () => socket.destroy()
    let buffer = head
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        const frame = decodeWsFrame(buffer, { requireMask: true, maxPayload: 65536 })
        if (!frame) break
        buffer = buffer.subarray(frame.consumed)
        if (frame.frame.opcode === 8) {
          socket.end(encodeWsFrame(8, frame.frame.payload, { mask: false }))
          return
        }
        receive(JSON.parse(frame.frame.payload.toString()), push, disconnect)
      }
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    const closed = new Promise((resolve) => server.close(resolve))
    for (const socket of sockets) socket.destroy()
    await closed
  })
  return {
    url: (type === 'ws' ? 'ws' : 'http') + '://127.0.0.1:' + server.address().port + '/private-route',
    log,
    headers,
    send: (msg) => push(msg),
    disconnect: () => disconnect(),
    dropCall: () => {
      drop = true
    }
  }
}
