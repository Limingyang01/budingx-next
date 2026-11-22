// SP008 T17：WebSocket 客户端连接失败路径与帧处理（真实 TCP + 手工服务端）。
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { test } from 'node:test'
import { connectWebSocket, WsConnectError } from '../../../tui/dist/host/transport/ws-client.js'
import { WS_OPCODE, decodeWsFrame, encodeWsFrame, wsAccept } from '../../../tui/dist/host/transport/ws-frames.js'

async function rawServer(t, onUpgrade) {
  const sockets = []
  const server = createServer((socket) => {
    sockets.push(socket)
    socket.on('error', () => {})
    let buffer = Buffer.alloc(0)
    const onData = (data) => {
      buffer = Buffer.concat([buffer, data])
      const end = buffer.indexOf('\r\n\r\n')
      if (end < 0) return
      socket.off('data', onData)
      const head = buffer.subarray(0, end).toString('utf8')
      const rest = buffer.subarray(end + 4)
      const key = /sec-websocket-key:\s*(.+)/i.exec(head)?.[1]?.trim()
      onUpgrade({ socket, head, key, rest })
    }
    socket.on('data', onData)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    for (const socket of sockets) socket.destroy()
    server.close()
  })
  return 'ws://127.0.0.1:' + server.address().port
}

function acceptHead(key) {
  return (
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n'
  )
}

function serverFrameReader(socket, initial) {
  let buffer = Buffer.from(initial)
  const frames = []
  const pump = () => {
    for (;;) {
      let decoded
      try {
        decoded = decodeWsFrame(buffer, { requireMask: true, maxPayload: 16 * 1024 * 1024 })
      } catch {
        return
      }
      if (!decoded) return
      frames.push(decoded.frame)
      buffer = buffer.subarray(decoded.consumed)
    }
  }
  socket.on('data', (data) => {
    buffer = Buffer.concat([buffer, data])
    pump()
  })
  pump()
  return {
    frames,
    async waitFor(predicate, label, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const found = frames.find(predicate)
        if (found) return found
        await new Promise((resolveSleep) => setTimeout(resolveSleep, 10))
      }
      throw new Error('server did not receive frame: ' + label)
    }
  }
}

async function waitForValue(read, predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (predicate(value)) return value
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 10))
  }
  throw new Error('condition not met: ' + label)
}

test('非法 URL 与非 ws:// 协议被拒绝', async () => {
  await assert.rejects(
    connectWebSocket({ url: 'not a url', token: 'x' }),
    (error) => error instanceof WsConnectError && error.message === 'invalid WebSocket url'
  )
  await assert.rejects(
    connectWebSocket({ url: 'wss://127.0.0.1:9', token: 'x' }),
    (error) => error instanceof WsConnectError && error.message === 'only ws:// urls are supported'
  )
  await assert.rejects(
    connectWebSocket({ url: 'http://127.0.0.1:9', token: 'x' }),
    (error) => error instanceof WsConnectError && error.message === 'only ws:// urls are supported'
  )
})

test('非 101 响应携带状态码拒绝', async (t) => {
  const url = await rawServer(t, ({ socket }) => {
    socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
  })
  await assert.rejects(connectWebSocket({ url, token: 'x' }), (error) => {
    assert.ok(error instanceof WsConnectError)
    assert.equal(error.message, 'handshake rejected with status 403')
    assert.equal(error.statusCode, 403)
    return true
  })
})

test('Sec-WebSocket-Accept 不匹配被拒绝', async (t) => {
  const url = await rawServer(t, ({ socket }) => {
    socket.end(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: wrong-value\r\n\r\n'
    )
  })
  await assert.rejects(
    connectWebSocket({ url, token: 'x' }),
    (error) => error instanceof WsConnectError && error.message === 'handshake accept mismatch'
  )
})

test('握手超时被拒绝', async (t) => {
  const url = await rawServer(t, () => {
    // 接受连接但永不回应握手
  })
  await assert.rejects(
    connectWebSocket({ url, token: 'x', timeoutMs: 150 }),
    (error) => error instanceof WsConnectError && error.message === 'handshake timed out'
  )
})

test('连接被拒绝时返回 connection failed', async (t) => {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise((resolveClose) => server.close(resolveClose))
  await assert.rejects(
    connectWebSocket({ url: 'ws://127.0.0.1:' + port, token: 'x', timeoutMs: 2000 }),
    (error) => error instanceof WsConnectError && /^connection failed: /.test(error.message)
  )
})

test('超过 16 KiB 的握手头被拒绝', async (t) => {
  const url = await rawServer(t, ({ socket }) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nX-Pad: ' + 'a'.repeat(20 * 1024) + '\r\n')
  })
  await assert.rejects(
    connectWebSocket({ url, token: 'x', timeoutMs: 2000 }),
    (error) => error instanceof WsConnectError && error.message === 'handshake header too large'
  )
})

test('成功连接：客户端帧带掩码、分片重组、自动 pong、close 回调', async (t) => {
  let reader
  let serverSocket
  const url = await rawServer(t, ({ socket, key, rest }) => {
    serverSocket = socket
    socket.write(acceptHead(key))
    const line = '{"type":"event","seq":1,"event":{"type":"status","state":"idle"}}\n'
    const split = 12
    socket.write(encodeWsFrame(WS_OPCODE.text, Buffer.from(line.slice(0, split)), { mask: false, fin: false }))
    socket.write(encodeWsFrame(WS_OPCODE.continuation, Buffer.from(line.slice(split)), { mask: false, fin: true }))
    socket.write(encodeWsFrame(WS_OPCODE.ping, Buffer.from('srv-ping'), { mask: false }))
    reader = serverFrameReader(socket, rest)
  })
  const transport = await connectWebSocket({ url, token: 'test-token' })
  const lines = []
  const closes = []
  transport.onLine((line) => lines.push(line))
  transport.onClose(() => closes.push(true))
  await waitForValue(() => lines, (value) => value.length >= 1, 'fragmented line delivered')
  assert.deepEqual(lines, ['{"type":"event","seq":1,"event":{"type":"status","state":"idle"}}'])
  const pong = await reader.waitFor(
    (frame) => frame.opcode === WS_OPCODE.pong && frame.payload.toString('utf8') === 'srv-ping',
    'automatic pong'
  )
  assert.equal(pong.payload.toString('utf8'), 'srv-ping')
  transport.write('{"id":"c1","type":"ping"}\n')
  const text = await reader.waitFor((frame) => frame.opcode === WS_OPCODE.text, 'masked client text')
  assert.equal(text.payload.toString('utf8'), '{"id":"c1","type":"ping"}\n')
  const closeBody = Buffer.alloc(2)
  closeBody.writeUInt16BE(1000, 0)
  serverSocket.write(encodeWsFrame(WS_OPCODE.close, closeBody, { mask: false }))
  await waitForValue(() => closes, (value) => value.length === 1, 'close listener fired')
})

test('服务端 binary 帧触发客户端 close 1003 并断开', async (t) => {
  let reader
  const url = await rawServer(t, ({ socket, key, rest }) => {
    socket.write(acceptHead(key))
    socket.write(encodeWsFrame(WS_OPCODE.binary, Buffer.from('nope'), { mask: false }))
    reader = serverFrameReader(socket, rest)
  })
  const transport = await connectWebSocket({ url, token: 'x' })
  const closes = []
  transport.onClose(() => closes.push(true))
  const close = await reader.waitFor((frame) => frame.opcode === WS_OPCODE.close, 'client close 1003')
  assert.equal(close.payload.readUInt16BE(0), 1003)
  await waitForValue(() => closes, (value) => value.length === 1, 'close listener fired')
})

test('服务端发送掩码帧触发客户端 close 1002', async (t) => {
  let reader
  const url = await rawServer(t, ({ socket, key, rest }) => {
    socket.write(acceptHead(key))
    socket.write(encodeWsFrame(WS_OPCODE.text, Buffer.from('masked server frame\n'), { mask: true }))
    reader = serverFrameReader(socket, rest)
  })
  const transport = await connectWebSocket({ url, token: 'x' })
  const closes = []
  transport.onClose(() => closes.push(true))
  const close = await reader.waitFor((frame) => frame.opcode === WS_OPCODE.close, 'client close 1002')
  assert.equal(close.payload.readUInt16BE(0), 1002)
  await waitForValue(() => closes, (value) => value.length === 1, 'close listener fired')
})

test('客户端 close 发送 1000 帧并触发本地关闭回调', async (t) => {
  let reader
  const url = await rawServer(t, ({ socket, key, rest }) => {
    socket.write(acceptHead(key))
    reader = serverFrameReader(socket, rest)
  })
  const transport = await connectWebSocket({ url, token: 'x' })
  const closes = []
  transport.onClose(() => closes.push(true))
  transport.close('bye')
  const close = await reader.waitFor((frame) => frame.opcode === WS_OPCODE.close, 'client close 1000')
  assert.equal(close.payload.readUInt16BE(0), 1000)
  assert.equal(close.payload.subarray(2).toString('utf8'), 'bye')
  assert.equal(closes.length, 1)
})
