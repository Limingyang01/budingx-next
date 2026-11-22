// SP008 T10：WebSocket 客户端传输（net + 手动握手 + 掩码帧）。
import { randomBytes } from 'node:crypto'
import { connect } from 'node:net'
import { HOST_FRAME_MAX_BYTES } from '../protocol.js'
import type { HostTransport } from './transport.js'
import { WS_OPCODE, WsProtocolError, decodeWsFrame, encodeWsFrame, wsAccept } from './ws-frames.js'

export class WsConnectError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number
  ) {
    super(message)
  }
}

export type WsClientOptions = {
  url: string
  token: string
  timeoutMs?: number
}

const HEADER_LIMIT = 16 * 1024

export function connectWebSocket(options: WsClientOptions): Promise<HostTransport> {
  return new Promise((resolve, reject) => {
    let url: URL
    try {
      url = new URL(options.url)
    } catch {
      reject(new WsConnectError('invalid WebSocket url'))
      return
    }
    if (url.protocol !== 'ws:') {
      reject(new WsConnectError('only ws:// urls are supported'))
      return
    }
    const host = url.hostname.replace(/^\[|\]$/g, '')
    const port = url.port ? Number(url.port) : 80
    const key = randomBytes(16).toString('base64')
    const socket = connect({ host, port })
    const timeoutMs = options.timeoutMs ?? 5000
    let settled = false
    let handshakeBuffer = Buffer.alloc(0)
    let upgraded = false

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(error)
    }

    const timer = setTimeout(() => fail(new WsConnectError('handshake timed out')), timeoutMs)
    timer.unref?.()

    socket.once('error', (error) => fail(new WsConnectError('connection failed: ' + error.message)))

    socket.on('connect', () => {
      socket.write(
        'GET ' +
          (url.pathname || '/') +
          (url.search || '') +
          ' HTTP/1.1\r\n' +
          'Host: ' +
          url.host +
          '\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Key: ' +
          key +
          '\r\n' +
          'Sec-WebSocket-Version: 13\r\n' +
          'Authorization: Bearer ' +
          options.token +
          '\r\n\r\n'
      )
    })

    const onHandshakeData = (chunk: Buffer): void => {
      handshakeBuffer = Buffer.concat([handshakeBuffer, chunk])
      if (handshakeBuffer.length > HEADER_LIMIT && handshakeBuffer.indexOf('\r\n\r\n') < 0) {
        fail(new WsConnectError('handshake header too large'))
        return
      }
      const end = handshakeBuffer.indexOf('\r\n\r\n')
      if (end < 0) return
      socket.off('data', onHandshakeData)
      const headerText = handshakeBuffer.subarray(0, end).toString('utf8')
      const rest = handshakeBuffer.subarray(end + 4)
      const lines = headerText.split('\r\n')
      const status = /^HTTP\/1\.1 (\d{3})/.exec(lines[0] ?? '')
      if (!status || status[1] !== '101') {
        fail(
          new WsConnectError(
            'handshake rejected with status ' + (status ? status[1] : 'unknown'),
            status ? Number(status[1]) : undefined
          )
        )
        return
      }
      const headers = new Map<string, string>()
      for (const line of lines.slice(1)) {
        const index = line.indexOf(':')
        if (index < 0) continue
        headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim())
      }
      if (headers.get('sec-websocket-accept') !== wsAccept(key)) {
        fail(new WsConnectError('handshake accept mismatch'))
        return
      }
      upgraded = true
      settled = true
      clearTimeout(timer)
      const transport = createTransport(socket, rest)
      resolve(transport)
    }

    socket.on('data', onHandshakeData)
  })
}

function createTransport(socket: ReturnType<typeof connect>, initial: Buffer): HostTransport {
  let buffer: Buffer = initial.length > 0 ? Buffer.from(initial) : Buffer.alloc(0)
  let textBuffer = ''
  let fragments: Buffer[] = []
  let fragmented = false
  let fragmentBytes = 0
  let closed = false
  const lineListeners = new Set<(line: string) => void>()
  const closeListeners = new Set<(reason?: string) => void>()

  const finish = (): void => {
    if (closed) return
    closed = true
    for (const listener of closeListeners) listener()
    closeListeners.clear()
  }

  const send = (opcode: number, payload: Buffer): void => {
    if (socket.destroyed) return
    socket.write(encodeWsFrame(opcode, payload, { mask: true }))
  }

  const emitLine = (line: string): void => {
    for (const listener of lineListeners) listener(line)
  }

  const deliver = (payload: Buffer): void => {
    textBuffer += payload.toString('utf8')
    let index = textBuffer.indexOf('\n')
    while (index >= 0) {
      const line = textBuffer.slice(0, index)
      textBuffer = textBuffer.slice(index + 1)
      emitLine(line.endsWith('\r') ? line.slice(0, -1) : line)
      index = textBuffer.indexOf('\n')
    }
  }

  const protocolFailure = (code: number, reason: string): void => {
    const body = Buffer.allocUnsafe(2 + Buffer.byteLength(reason))
    body.writeUInt16BE(code, 0)
    body.write(reason, 2)
    send(WS_OPCODE.close, body)
    socket.destroy()
    finish()
  }

  const handleFrame = (fin: boolean, opcode: number, payload: Buffer): void => {
    if (opcode === WS_OPCODE.text || opcode === WS_OPCODE.binary) {
      if (fragmented) return protocolFailure(1002, 'unexpected new message')
      if (opcode === WS_OPCODE.binary) return protocolFailure(1003, 'binary frames are not supported')
      if (fin) return deliver(payload)
      fragmented = true
      fragments = [payload]
      fragmentBytes = payload.length
      return
    }
    if (opcode === WS_OPCODE.continuation) {
      if (!fragmented) return protocolFailure(1002, 'unexpected continuation')
      fragments.push(payload)
      fragmentBytes += payload.length
      if (fragmentBytes > HOST_FRAME_MAX_BYTES) return protocolFailure(1009, 'message too large')
      if (fin) {
        const message = Buffer.concat(fragments)
        fragments = []
        fragmented = false
        fragmentBytes = 0
        deliver(message)
      }
      return
    }
    if (opcode === WS_OPCODE.ping) return send(WS_OPCODE.pong, payload)
    if (opcode === WS_OPCODE.pong) return
    if (opcode === WS_OPCODE.close) {
      finish()
      socket.end()
      return
    }
    protocolFailure(1002, 'unsupported opcode ' + opcode)
  }

  const pump = (): void => {
    for (;;) {
      let decoded: ReturnType<typeof decodeWsFrame>
      try {
        decoded = decodeWsFrame(buffer, { requireMask: false, maxPayload: HOST_FRAME_MAX_BYTES })
      } catch (error) {
        if (error instanceof WsProtocolError) return protocolFailure(error.closeCode, error.message)
        throw error
      }
      if (!decoded) return
      buffer = buffer.subarray(decoded.consumed)
      handleFrame(decoded.frame.fin, decoded.frame.opcode, decoded.frame.payload)
      if (closed) return
    }
  }

  socket.on('data', (chunk: Buffer) => {
    if (closed) return
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])
    pump()
  })
  socket.on('close', finish)
  socket.on('error', () => {
    socket.destroy()
    finish()
  })
  // 握手响应与首批帧可能在同一个 TCP 块里到达；同步 pump 会在调用方
  // await 之后注册 onLine/onClose 之前投递，导致帧丢失。推迟到宏任务，
  // 让紧随 await 的同步监听器注册先完成。
  if (buffer.length > 0) setTimeout(pump, 0)

  return {
    write(text: string): void {
      send(WS_OPCODE.text, Buffer.from(text, 'utf8'))
    },
    onLine(listener: (line: string) => void): () => void {
      lineListeners.add(listener)
      return () => lineListeners.delete(listener)
    },
    onClose(listener: (reason?: string) => void): () => void {
      closeListeners.add(listener)
      return () => closeListeners.delete(listener)
    },
    close(reason?: string): void {
      if (closed) return
      const body = Buffer.allocUnsafe(2 + Buffer.byteLength(reason ?? ''))
      body.writeUInt16BE(1000, 0)
      body.write(reason ?? '', 2)
      send(WS_OPCODE.close, body)
      socket.end()
      finish()
    }
  }
}