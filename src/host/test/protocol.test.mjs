// SP008 TB-01/TB-04/TB-06：协议帧的编码、校验与稳定错误码。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  HOST_FRAME_MAX_BYTES,
  HOST_PROTOCOL_VERSION,
  encodeFrame,
  parseClientFrame
} from '../../tui/dist/host/protocol.js'

test('请求帧编码为单行 NDJSON 并可原样解析', () => {
  const line = encodeFrame({ id: 'r1', type: 'hello', version: HOST_PROTOCOL_VERSION, clientId: 'c1' })
  assert.equal(line.endsWith('\n'), true)
  assert.equal(line.trimEnd().includes('\n'), false)
  const parsed = parseClientFrame(line.trimEnd())
  assert.equal(parsed.ok, true)
  assert.equal(parsed.frame.id, 'r1')
  assert.equal(parsed.frame.type, 'hello')
})

test('畸形 JSON 与缺少 id 返回 HOST_PROTOCOL_002', () => {
  assert.equal(parseClientFrame('{oops').error.code, 'HOST_PROTOCOL_002')
  assert.equal(parseClientFrame(JSON.stringify({ type: 'ping' })).error.code, 'HOST_PROTOCOL_002')
  assert.equal(parseClientFrame('   ').error.code, 'HOST_PROTOCOL_002')
})

test('未知请求类型返回 HOST_STATE_006，缺字段返回 HOST_PROTOCOL_002', () => {
  const unknown = parseClientFrame(JSON.stringify({ id: 'x', type: 'drop_database' }))
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'HOST_STATE_006')
  const emptySubmit = parseClientFrame(JSON.stringify({ id: 'x', type: 'submit', text: '  ' }))
  assert.equal(emptySubmit.error.code, 'HOST_PROTOCOL_002')
  const badMode = parseClientFrame(JSON.stringify({ id: 'x', type: 'set_permission_mode', mode: 'god' }))
  assert.equal(badMode.error.code, 'HOST_PROTOCOL_002')
})

test('超过 1 MiB 的帧返回 HOST_PROTOCOL_005', () => {
  const huge = JSON.stringify({ id: 'x', type: 'submit', text: 'a'.repeat(HOST_FRAME_MAX_BYTES) })
  const parsed = parseClientFrame(huge)
  assert.equal(parsed.ok, false)
  assert.equal(parsed.error.code, 'HOST_PROTOCOL_005')
})

test('响应与事件帧编码后字段完整（事件不携带密钥字段）', () => {
  const response = encodeFrame({
    id: 'a',
    ok: true,
    result: { type: 'hello_ok', protocolVersion: HOST_PROTOCOL_VERSION, sessionId: 's', workspaceId: 'w', clientId: 'c', role: 'owner', scope: 'local' }
  })
  assert.equal(JSON.parse(response).result.scope, 'local')
  const event = encodeFrame({ type: 'event', seq: 1, event: { type: 'status', state: 'idle' } })
  assert.equal(JSON.parse(event).event.type, 'status')
})
