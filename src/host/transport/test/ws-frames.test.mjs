// SP008 T10：WebSocket 帧编解码单元测试。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  WS_OPCODE,
  WsProtocolError,
  decodeWsFrame,
  encodeWsFrame,
  wsAccept
} from '../../../tui/dist/host/transport/ws-frames.js'

test('wsAccept 匹配 RFC 6455 示例向量', () => {
  assert.equal(wsAccept('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
})

test('掩码与明文帧往返、分帧读取', () => {
  const payload = Buffer.from('hello 宿主')
  const masked = encodeWsFrame(WS_OPCODE.text, payload, { mask: true })
  const decoded = decodeWsFrame(masked, { requireMask: true, maxPayload: 1024 })
  assert.ok(decoded)
  assert.equal(decoded.consumed, masked.length)
  assert.equal(decoded.frame.opcode, WS_OPCODE.text)
  assert.equal(decoded.frame.fin, true)
  assert.equal(decoded.frame.payload.toString('utf8'), 'hello 宿主')

  const plain = encodeWsFrame(WS_OPCODE.text, payload, { mask: false })
  assert.equal(decodeWsFrame(plain, { requireMask: false, maxPayload: 1024 })?.frame.payload.toString(), 'hello 宿主')
  assert.equal(decodeWsFrame(plain.subarray(0, 3), { requireMask: false, maxPayload: 1024 }), null)
})

test('协议错误：掩码不符、控制帧超长、载荷超限', () => {
  const unmasked = encodeWsFrame(WS_OPCODE.text, Buffer.from('x'), { mask: false })
  assert.throws(() => decodeWsFrame(unmasked, { requireMask: true, maxPayload: 1024 }), (error) => {
    assert.ok(error instanceof WsProtocolError)
    assert.equal(error.closeCode, 1002)
    return true
  })
  const bigPing = encodeWsFrame(WS_OPCODE.ping, Buffer.alloc(126), { mask: true })
  assert.throws(() => decodeWsFrame(bigPing, { requireMask: true, maxPayload: 1024 }), (error) => {
    assert.equal(error.closeCode, 1002)
    return true
  })
  const big = encodeWsFrame(WS_OPCODE.text, Buffer.alloc(2048), { mask: true })
  assert.throws(() => decodeWsFrame(big, { requireMask: true, maxPayload: 1024 }), (error) => {
    assert.equal(error.closeCode, 1009)
    return true
  })
})