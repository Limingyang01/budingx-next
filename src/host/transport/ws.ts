// SP008 T10：WebSocket 宿主传输（RFC 6455 最小实现）。
// 仅监听回环地址，Bearer 令牌在升级前校验；协议帧与 stdio 完全一致（NDJSON）。
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { HOST_FRAME_MAX_BYTES, encodeFrame, type HostErrorCode } from '../protocol.js'
import type { HostConnection } from '../server.js'
import { WS_OPCODE, WsProtocolError, decodeWsFrame, encodeWsFrame, wsAccept } from './ws-frames.js'

export type WsHostOptions = {
  host: string
  port: number
  token: string
  onConnection: (connection: HostConnection) => void
}

export type WsHost = {
  /** Bound port (resolved when the caller asked for port 0). */
  port: number
  url: string
  close(): Promise<void>
}

export class WsBindingError extends Error {}

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
}

function authorized(header: string | undefined, token: string): boolean {
  if (!header) return false
  const match = /^Bearer +(.+)$/i.exec(header.trim())
  if (!match) return false
  const provided = Buffer.from(match[1], 'utf8')
  const expected = Buffer.from(token, 'utf8')
  if (provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  const body = reason + '\n'
  socket.end(
    'HTTP/1.1 ' +
      status +
      ' ' +
      reason +
      '\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ' +
      Buffer.byteLength(body) +
      '\r\n\r\n' +
      body
  )
}

function fatalFrame(code: HostErrorCode, message: string): string {
  return encodeFrame({ type: 'fatal', code, message })
}

export async function startWsHost(options: WsHostOptions): Promise<WsHost> {
  if (!isLoopbackHost(options.host)) {
    throw new WsBindingError(
      'WebSocket host must bind a loopback address (127.0.0.1, localhost or ::1); remote access is out of scope'
    )
  }
  if (options.token.length === 0) {
    throw new WsBindingError('WebSocket host requires a non-empty token')
  }
  const sockets = new Set<Socket>()
  const httpServer = createServer((request, response) => {
    response.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' })
    response.end('WebSocket upgrade required\n')
  })
  httpServer.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  httpServer.on('upgrade', (request, socket, head) => {
    if (!authorized(request.headers.authorization, options.token)) {
      rejectUpgrade(socket, 401, 'Unauthorized')
      return
    }
    const key = request.headers['sec-websocket-key']
    const upgrade = String(request.headers.upgrade ?? '').toLowerCase()
    const version = request.headers['sec-websocket-version']
    if (
      request.method !== 'GET' ||
      upgrade !== 'websocket' ||
      version !== '13' ||
      typeof key !== 'string' ||
      Buffer.from(key, 'base64').length !== 16
    ) {
      rejectUpgrade(socket, 400, 'Bad Request')
      return
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' +
        wsAccept(key) +
        '\r\n\r\n'
    )
    attachSocket(socket, head, options.onConnection)
  })
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error)
    httpServer.once('error', onError)
    httpServer.listen(options.port, options.host, () => {
      httpServer.off('error', onError)
      resolve()
    })
  })
  const address = httpServer.address()
  const port = typeof address === 'object' && address !== null ? address.port : options.port
  return {
    port,
    url: 'ws://' + (options.host === '::1' || options.host === '[::1]' ? '[::1]' : options.host) + ':' + port,
    close: async () => {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
        for (const socket of sockets) socket.destroy()
        sockets.clear()
      })
    }
  }
}

function attachSocket(
  socket: Duplex,
  head: Buffer,
  onConnection: (connection: HostConnection) => void
): void {
  let buffer: Buffer = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0)
  let textBuffer = ''
  let fragments: Buffer[] = []
  let fragmentedOpcode: number | undefined
  let fragmentBytes = 0
  let closed = false
  let closeSent = false
  const lineHandlers: ((line: string) => void)[] = []
  const closeHandlers: (() => void)[] = []

  const finish = (): void => {
    if (closed) return
    closed = true
    for (const handler of closeHandlers) handler()
  }

  const sendFrame = (opcode: number, payload: Buffer): void => {
    if (socket.destroyed) return
    socket.write(encodeWsFrame(opcode, payload, { mask: false }))
  }

  const sendClose = (code: number, reason: string): void => {
    if (closeSent) return
    closeSent = true
    const body = Buffer.allocUnsafe(2 + Buffer.byteLength(reason))
    body.writeUInt16BE(code, 0)
    body.write(reason, 2)
    sendFrame(WS_OPCODE.close, body)
    socket.end()
  }

  const fail = (code: number, reason: string): void => {
    sendFrame(WS_OPCODE.text, Buffer.from(fatalFrame('HOST_PROTOCOL_005', reason)))
    sendClose(code, reason)
  }

  const emitLine = (line: string): void => {
    for (const handler of lineHandlers) handler(line)
  }

  const deliver = (payload: Buffer): void => {
    if (payload.length > HOST_FRAME_MAX_BYTES) {
      fail(1009, 'frame exceeds ' + HOST_FRAME_MAX_BYTES + ' bytes')
      return
    }
    textBuffer += payload.toString('utf8')
    let index = textBuffer.indexOf('\n')
    while (index >= 0) {
      const line = textBuffer.slice(0, index)
      textBuffer = textBuffer.slice(index + 1)
      emitLine(line.endsWith('\r') ? line.slice(0, -1) : line)
      if (closed) return
      index = textBuffer.indexOf('\n')
    }
    if (Buffer.byteLength(textBuffer, 'utf8') > HOST_FRAME_MAX_BYTES) {
      fail(1009, 'frame exceeds ' + HOST_FRAME_MAX_BYTES + ' bytes')
    }
  }

  const handleFrame = (fin: boolean, opcode: number, payload: Buffer): void => {
    if (opcode === WS_OPCODE.text || opcode === WS_OPCODE.binary) {
      if (fragmentedOpcode !== undefined) {
        fail(1002, 'new message before fragmented message finished')
        return
      }
      if (opcode === WS_OPCODE.binary) {
        fail(1003, 'binary frames are not supported; send NDJSON text frames')
        return
      }
      if (fin) {
        deliver(payload)
      } else {
        fragmentedOpcode = opcode
        fragments = [payload]
        fragmentBytes = payload.length
      }
      return
    }
    if (opcode === WS_OPCODE.continuation) {
      if (fragmentedOpcode === undefined) {
        fail(1002, 'continuation frame without start')
        return
      }
      fragments.push(payload)
      fragmentBytes += payload.length
      if (fragmentBytes > HOST_FRAME_MAX_BYTES) {
        fail(1009, 'frame exceeds ' + HOST_FRAME_MAX_BYTES + ' bytes')
        return
      }
      if (fin) {
        const message = Buffer.concat(fragments)
        fragments = []
        fragmentedOpcode = undefined
        fragmentBytes = 0
        deliver(message)
      }
      return
    }
    if (opcode === WS_OPCODE.ping) {
      sendFrame(WS_OPCODE.pong, payload)
      return
    }
    if (opcode === WS_OPCODE.pong) return
    if (opcode === WS_OPCODE.close) {
      sendClose(1000, '')
      finish()
      return
    }
    fail(1002, 'unsupported opcode ' + opcode)
  }

  const pump = (): void => {
    for (;;) {
      let decoded: ReturnType<typeof decodeWsFrame>
      try {
        decoded = decodeWsFrame(buffer, { requireMask: true, maxPayload: HOST_FRAME_MAX_BYTES })
      } catch (error) {
        if (error instanceof WsProtocolError) {
          fail(error.closeCode, error.message)
          return
        }
        throw error
      }
      if (!decoded) return
      buffer = buffer.subarray(decoded.consumed)
      handleFrame(decoded.frame.fin, decoded.frame.opcode, decoded.frame.payload)
      if (closed || closeSent) return
    }
  }

  const connection: HostConnection = {
    send(text: string): void {
      sendFrame(WS_OPCODE.text, Buffer.from(text, 'utf8'))
    },
    close(code = 1000, reason = ''): void {
      sendClose(code, reason)
    },
    onLine(handler: (line: string) => void): void {
      lineHandlers.push(handler)
    },
    onClose(handler: () => void): void {
      closeHandlers.push(handler)
    }
  }

  socket.on('data', (chunk: Buffer) => {
    if (closed) return
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])
    pump()
  })
  socket.on('close', () => {
    finish()
  })
  socket.on('error', () => {
    socket.destroy()
    finish()
  })
  if ('setNoDelay' in socket) (socket as Socket).setNoDelay(true)
  if (!closed) onConnection(connection)
  if (buffer.length > 0 && !closed && !closeSent) pump()
}