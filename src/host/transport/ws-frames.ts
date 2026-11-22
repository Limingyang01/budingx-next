// SP008 T10：最小 RFC 6455 帧编解码。只支持文本消息、分片、ping/pong 与 close。
import { createHash, randomBytes } from 'node:crypto'

export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
export const WS_OPCODE = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa
} as const

export type WsFrame = { fin: boolean; opcode: number; payload: Buffer }

export class WsProtocolError extends Error {
  constructor(
    message: string,
    readonly closeCode: number
  ) {
    super(message)
  }
}

/** Server frames are never masked; client frames must be masked. */
export function encodeWsFrame(
  opcode: number,
  payload: Buffer,
  options: { mask: boolean; fin?: boolean }
): Buffer {
  const fin = options.fin ?? true
  const length = payload.length
  const headerLength = length < 126 ? 2 : length <= 0xffff ? 4 : 10
  const maskLength = options.mask ? 4 : 0
  const frame = Buffer.allocUnsafe(headerLength + maskLength + length)
  frame[0] = (fin ? 0x80 : 0) | (opcode & 0x0f)
  frame[1] = (options.mask ? 0x80 : 0) | (length < 126 ? length : length <= 0xffff ? 126 : 127)
  let offset = 2
  if (length >= 126 && length <= 0xffff) {
    frame.writeUInt16BE(length, offset)
    offset += 2
  } else if (length > 0xffff) {
    frame.writeBigUInt64BE(BigInt(length), offset)
    offset += 8
  }
  if (options.mask) {
    const mask = randomBytes(4)
    mask.copy(frame, offset)
    offset += 4
    for (let index = 0; index < length; index += 1) {
      frame[offset + index] = payload[index] ^ mask[index % 4]
    }
  } else {
    payload.copy(frame, offset)
  }
  return frame
}

export function decodeWsFrame(
  buffer: Buffer,
  options: { requireMask: boolean; maxPayload: number }
): { frame: WsFrame; consumed: number } | null {
  if (buffer.length < 2) return null
  const first = buffer[0]
  const second = buffer[1]
  const fin = (first & 0x80) !== 0
  const opcode = first & 0x0f
  const masked = (second & 0x80) !== 0
  let length = second & 0x7f
  let offset = 2
  if (length === 126) {
    if (buffer.length < 4) return null
    length = buffer.readUInt16BE(2)
    offset = 4
  } else if (length === 127) {
    if (buffer.length < 10) return null
    const large = buffer.readBigUInt64BE(2)
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new WsProtocolError('frame too large', 1009)
    }
    length = Number(large)
    offset = 10
  }
  if (opcode >= 0x8) {
    if (!fin) throw new WsProtocolError('control frame must not be fragmented', 1002)
    if (length > 125) throw new WsProtocolError('control frame too large', 1002)
  }
  if (length > options.maxPayload) throw new WsProtocolError('frame exceeds limit', 1009)
  if (masked !== options.requireMask) {
    throw new WsProtocolError(
      options.requireMask ? 'client frame must be masked' : 'server frame must not be masked',
      1002
    )
  }
  const maskLength = masked ? 4 : 0
  if (buffer.length < offset + maskLength + length) return null
  let payload: Buffer
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4)
    offset += 4
    payload = Buffer.allocUnsafe(length)
    for (let index = 0; index < length; index += 1) {
      payload[index] = buffer[offset + index] ^ mask[index % 4]
    }
  } else {
    payload = Buffer.from(buffer.subarray(offset, offset + length))
  }
  return { frame: { fin, opcode, payload }, consumed: offset + length }
}

export function wsAccept(key: string): string {
  return createHash('sha1').update(key + WS_GUID).digest('base64')
}
