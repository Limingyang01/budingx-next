// SP008 T17：WebSocket 服务端帧级协议分支（真实 TCP + 手工 RFC 6455 客户端）。
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import { get as httpGet } from 'node:http'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { startWsHost, WsBindingError } from '../../../tui/dist/host/transport/ws.js'
import { WS_OPCODE, decodeWsFrame, encodeWsFrame, wsAccept } from '../../../tui/dist/host/transport/ws-frames.js'

async function startHost(t) {
  const connections = []
  const lines = []
  const closes = []
  const host = await startWsHost({
    host: '127.0.0.1',
    port: 0,
    token: 'test-token',
    onConnection: (connection) => {
      connections.push(connection)
      connection.onLine((line) => lines.push(line))
      connection.onClose(() => closes.push(connection))
    }
  })
  t.after(() => host.close())
  return { host, connections, lines, closes }
}

function rawUpgrade(url, options = {}) {
  const { token = 'test-token', omitKey = false, version = '13' } = options
  return new Promise((resolvePromise, rejectPromise) => {
    const target = new URL(url)
    const key = randomBytes(16).toString('base64')
    const socket = connect({ host: target.hostname, port: Number(target.port) }, () => {
      const headers = [
        'GET / HTTP/1.1',
        'Host: ' + target.host,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Version: ' + version,
        'Authorization: Bearer ' + token
      ]
      if (!omitKey) headers.splice(4, 0, 'Sec-WebSocket-Key: ' + key)
      socket.write(headers.join('\r\n') + '\r\n\r\n')
    })
    let buffer = Buffer.alloc(0)
    const timer = setTimeout(() => rejectPromise(new Error('handshake timeout')), 5000)
    timer.unref()
    const onData = (data) => {
      buffer = Buffer.concat([buffer, data])
      const index = buffer.indexOf('\r\n\r\n')
      if (index < 0) return
      clearTimeout(timer)
      socket.off('data', onData)
      const head = buffer.subarray(0, index).toString('utf8')
      const rest = buffer.subarray(index + 4)
      const [statusLine, ...headerLines] = head.split('\r\n')
      const status = Number(statusLine.split(' ')[1])
      const headers = {}
      for (const line of headerLines) {
        const sep = line.indexOf(':')
        headers[line.slice(0, sep).trim().toLowerCase()] = line.slice(sep + 1).trim()
      }
      resolvePromise({ socket, status, headers, rest, key })
    }
    socket.on('data', onData)
    socket.on('error', (error) => {
      clearTimeout(timer)
      rejectPromise(error)
    })
  })
}

function frameClient(socket, rest) {
  let buffer = Buffer.from(rest)
  const frames = []
  let ended = false
  const pump = () => {
    for (;;) {
      let decoded
      try {
        decoded = decodeWsFrame(buffer, { requireMask: false, maxPayload: 16 * 1024 * 1024 })
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
  socket.on('end', () => {
    ended = true
  })
  socket.on('error', () => {})
  pump()
  return {
    frames,
    send(opcode, payload, options = {}) {
      socket.write(encodeWsFrame(opcode, Buffer.from(payload), { mask: true, ...options }))
    },
    sendRaw(frame) {
      socket.write(frame)
    },
    async waitFor(predicate, label, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const found = frames.find(predicate)
        if (found) return found
        await new Promise((resolveSleep) => setTimeout(resolveSleep, 10))
      }
      throw new Error('frame not received: ' + label + '; got ' + JSON.stringify(frames.map((f) => ({ opcode: f.opcode, payload: f.payload.toString('utf8').slice(0, 120) }))))
    },
    async waitEnd(timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs
      while (!ended && Date.now() < deadline) {
        await new Promise((resolveSleep) => setTimeout(resolveSleep, 10))
      }
      assert.equal(ended, true, 'socket did not end')
    },
    destroy() {
      socket.destroy()
    }
  }
}

const isText = (frame) => frame.opcode === WS_OPCODE.text
const isClose = (frame) => frame.opcode === WS_OPCODE.close
const fatalWith = (message) => (frame) => {
  if (!isText(frame)) return false
  try {
    const parsed = JSON.parse(frame.payload.toString('utf8'))
    return parsed.type === 'fatal' && parsed.code === 'HOST_PROTOCOL_005' && parsed.message === message
  } catch {
    return false
  }
}
const closeCode = (frame) => frame.payload.readUInt16BE(0)

async function expectFatalAndClose(client, message, code) {
  await client.waitFor(fatalWith(message), 'fatal ' + message)
  const close = await client.waitFor(isClose, 'close ' + code)
  assert.equal(closeCode(close), code)
  await client.waitEnd()
}

test('非 upgrade 的 HTTP 请求返回 426', async (t) => {
  const { host } = await startHost(t)
  const response = await new Promise((resolvePromise, rejectPromise) => {
    httpGet(host.url.replace('ws://', 'http://'), resolvePromise).on('error', rejectPromise)
  })
  assert.equal(response.statusCode, 426)
  const chunks = []
  for await (const chunk of response) chunks.push(chunk)
  assert.equal(Buffer.concat(chunks).toString('utf8'), 'WebSocket upgrade required\n')
})

test('错误令牌在升级前被拒绝 401', async (t) => {
  const { host, connections } = await startHost(t)
  const { socket, status } = await rawUpgrade(host.url, { token: 'wrong-token' })
  assert.equal(status, 401)
  assert.equal(connections.length, 0)
  socket.destroy()
})

test('缺少 Sec-WebSocket-Key 或版本不是 13 返回 400', async (t) => {
  const { host } = await startHost(t)
  const missingKey = await rawUpgrade(host.url, { omitKey: true })
  assert.equal(missingKey.status, 400)
  missingKey.socket.destroy()
  const badVersion = await rawUpgrade(host.url, { version: '12' })
  assert.equal(badVersion.status, 400)
  badVersion.socket.destroy()
})

test('合法升级返回 101 与正确 accept，文本帧按 NDJSON 行投递并可回写', async (t) => {
  const { host, connections, lines } = await startHost(t)
  const upgrade = await rawUpgrade(host.url)
  assert.equal(upgrade.status, 101)
  assert.equal(upgrade.headers['sec-websocket-accept'], wsAccept(upgrade.key))
  const client = frameClient(upgrade.socket, upgrade.rest)
  t.after(() => client.destroy())
  const line = '{"id":"r1","type":"ping"}'
  client.send(WS_OPCODE.text, line + '\n')
  const deadline = Date.now() + 5000
  while (lines.length === 0 && Date.now() < deadline) {
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 10))
  }
  assert.deepEqual(lines, [line])
  assert.equal(connections.length, 1)
  connections[0].send('{"type":"pong","id":"r1"}\n')
  const frame = await client.waitFor(isText, 'server text frame')
  assert.equal(frame.payload.toString('utf8'), '{"type":"pong","id":"r1"}\n')
})

test('分片文本消息被重组为完整行', async (t) => {
  const { host, lines } = await startHost(t)
  const upgrade = await rawUpgrade(host.url)
  const client = frameClient(upgrade.socket, upgrade.rest)
  t.after(() => client.destroy())
  const line = '{"id":"frag","type":"ping"}'
  const withNewline = line + '\n'
  const split = Math.floor(withNewline.length / 2)
  client.send(WS_OPCODE.text, withNewline.slice(0, split), { fin: false })
  client.send(WS_OPCODE.continuation, withNewline.slice(split), { fin: true })
  const deadline = Date.now() + 5000
  while (lines.length === 0 && Date.now() < deadline) {
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 10))
  }
  assert.deepEqual(lines, [line])
})

test('分片未完成时发送新消息：fatal + close 1002', async (t) => {
  const { host } = await startHost(t)
  const upgrade = await rawUpgrade(host.url)
  const client = frameClient(upgrade.socket, upgrade.rest)
  client.send(WS_OPCODE.text, 'partial', { fin: false })
  client.send(WS_OPCODE.text, 'other\n')
  await expectFatalAndClose(client, 'new message before fragmented message finished', 1002)
})

test('没有起点的 continuation：fatal + close 1002', async (t) => {
  const { host } = await startHost(t)
  const upgrade = await rawUpgrade(host.url)
  const client = frameClient(upgrade.socket, upgrade.rest)
  client.send(WS_OPCODE.continuation, 'orphan')
  await expectFatalAndClose(client, 'continuation frame without start', 1002)
})

test('binary 帧被拒绝：fatal + close 1003', async (t) => {
  const { host } = await startHost(t)
  const upgrade = await rawUpgrade(host.url)
  const client = frameClient(upgrade.socket, upgrade.rest)
  client.send(WS_OPCODE.binary, 'not ndjson')
  await expectFatalAndClose(client, 'binary frames are not supported; send NDJSON text frames', 1003)
})

test('未知 opcode：fatal + close 1002', async (t) => {
  const { host } = await startHost(t)
  const upgrade = await rawUpgrade(host.url)
  const client = frameClient(upgrade.socket, upgrade.rest)
  client.send(0x3, 'reserved')
  await expectFatalAndClose(client, 'unsupported opcode 3', 1002)
})

test('未掩码的客户端帧：fatal + close 1002', async (t) => {
  const { host } = await startHost(t)
  const upgrade = await rawUpgrade(host.url)
  const client = frameClient(upgrade.socket, upgrade.rest)
  client.sendRaw(encodeWsFrame(WS_OPCODE.text, Buffer.from('{"id":"x","type":"ping"}\n'), { mask: false }))
  await expectFatalAndClose(client, 'client frame must be masked', 1002)
})

test('分片累计超过 1 MiB：fatal + close 1009', async (t) => {
  const { host } = await startHost(t)
  const upgrade = await rawUpgrade(host.url)
  const client = frameClient(upgrade.socket, upgrade.rest)
  const chunk = 'a'.repeat(600 * 1024)
  client.send(WS_OPCODE.text, chunk, { fin: false })
  client.send(WS_OPCODE.continuation, chunk, { fin: false })
  await expectFatalAndClose(client, 'frame exceeds 1048576 bytes', 1009)
})

test('ping 得到同载荷 pong；主动 pong 被忽略且连接保持可用', async (t) => {
  const { host } = await startHost(t)
  const upgrade = await rawUpgrade(host.url)
  const client = frameClient(upgrade.socket, upgrade.rest)
  t.after(() => client.destroy())
  client.send(WS_OPCODE.ping, 'hb-1')
  const pong1 = await client.waitFor((frame) => frame.opcode === WS_OPCODE.pong, 'pong hb-1')
  assert.equal(pong1.payload.toString('utf8'), 'hb-1')
  client.send(WS_OPCODE.pong, 'unsolicited')
  client.send(WS_OPCODE.ping, 'hb-2')
  const pong2 = await client.waitFor(
    (frame) => frame.opcode === WS_OPCODE.pong && frame.payload.toString('utf8') === 'hb-2',
    'pong hb-2'
  )
  assert.equal(pong2.payload.toString('utf8'), 'hb-2')
})

test('客户端 close 帧得到 1000 回应并触发连接关闭回调', async (t) => {
  const { host, closes } = await startHost(t)
  const upgrade = await rawUpgrade(host.url)
  const client = frameClient(upgrade.socket, upgrade.rest)
  const body = Buffer.alloc(2)
  body.writeUInt16BE(1000, 0)
  client.send(WS_OPCODE.close, body)
  const close = await client.waitFor(isClose, 'server close')
  assert.equal(closeCode(close), 1000)
  await client.waitEnd()
  const deadline = Date.now() + 5000
  while (closes.length === 0 && Date.now() < deadline) {
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 10))
  }
  assert.equal(closes.length, 1)
})

test('分片的控制帧被拒绝：fatal + close 1002', async (t) => {
  const { host } = await startHost(t)
  const upgrade = await rawUpgrade(host.url)
  const client = frameClient(upgrade.socket, upgrade.rest)
  client.send(WS_OPCODE.ping, 'split-control', { fin: false })
  await expectFatalAndClose(client, 'control frame must not be fragmented', 1002)
})

test('非回环绑定与空令牌在启动时被拒绝', async () => {
  await assert.rejects(
    startWsHost({ host: '0.0.0.0', port: 0, token: 'x', onConnection: () => {} }),
    (error) => error instanceof WsBindingError && /loopback/.test(error.message)
  )
  await assert.rejects(
    startWsHost({ host: '127.0.0.1', port: 0, token: '', onConnection: () => {} }),
    (error) => error instanceof WsBindingError && /non-empty token/.test(error.message)
  )
})
