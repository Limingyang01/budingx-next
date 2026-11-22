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

test('解析层错误文案稳定：空帧、非法 JSON、缺 id、缺 type、未知类型、超限', () => {
  const cases = [
    ['   ', 'HOST_PROTOCOL_002', 'empty frame'],
    ['{oops', 'HOST_PROTOCOL_002', 'frame is not valid JSON'],
    [JSON.stringify({ type: 'ping' }), 'HOST_PROTOCOL_002', 'frame is missing a request id'],
    [JSON.stringify({ id: 'x' }), 'HOST_PROTOCOL_002', 'frame is missing a request type'],
    [JSON.stringify({ id: 'x', type: 'drop_database' }), 'HOST_STATE_006', 'unknown request type: drop_database']
  ]
  for (const [line, code, message] of cases) {
    const parsed = parseClientFrame(line)
    assert.equal(parsed.ok, false, line)
    assert.equal(parsed.error.code, code, line)
    assert.equal(parsed.error.message, message, line)
  }
  const huge = JSON.stringify({ id: 'x', type: 'submit', text: 'a'.repeat(HOST_FRAME_MAX_BYTES) })
  const oversized = parseClientFrame(huge)
  assert.equal(oversized.error.code, 'HOST_PROTOCOL_005')
  assert.equal(oversized.error.message, 'frame exceeds ' + HOST_FRAME_MAX_BYTES + ' bytes')
})

test('字段校验错误文案稳定：hello/history/submit/approval/set_permission_mode', () => {
  const cases = [
    [{ id: 'x', type: 'hello', version: '1' }, 'hello.version must be an integer'],
    [{ id: 'x', type: 'hello', version: 1.5 }, 'hello.version must be an integer'],
    [{ id: 'x', type: 'hello', version: 1, clientId: 42 }, 'hello.clientId must be a string'],
    [{ id: 'x', type: 'history', limit: -1 }, 'history.limit must be a non-negative integer'],
    [{ id: 'x', type: 'history', limit: 1.5 }, 'history.limit must be a non-negative integer'],
    [{ id: 'x', type: 'history', limit: '2' }, 'history.limit must be a non-negative integer'],
    [{ id: 'x', type: 'submit', text: '  ' }, 'submit.text must be a non-empty string'],
    [{ id: 'x', type: 'submit' }, 'submit.text must be a non-empty string'],
    [{ id: 'x', type: 'approval', requestId: '', outcome: 'allow' }, 'approval.requestId must be a non-empty string'],
    [{ id: 'x', type: 'approval', outcome: 'allow' }, 'approval.requestId must be a non-empty string'],
    [{ id: 'x', type: 'approval', requestId: 'r1', outcome: 'maybe' }, 'approval.outcome must be allow or deny'],
    [{ id: 'x', type: 'approval', requestId: 'r1' }, 'approval.outcome must be allow or deny'],
    [{ id: 'x', type: 'set_permission_mode', mode: 'god' }, 'set_permission_mode.mode is not a known mode'],
    [{ id: 'x', type: 'set_permission_mode' }, 'set_permission_mode.mode is not a known mode']
  ]
  for (const [frame, message] of cases) {
    const parsed = parseClientFrame(JSON.stringify(frame))
    assert.equal(parsed.ok, false, JSON.stringify(frame))
    assert.equal(parsed.error.code, 'HOST_PROTOCOL_002', JSON.stringify(frame))
    assert.equal(parsed.error.message, message, JSON.stringify(frame))
  }
})

test('合法边界值通过校验：history.limit 0、approval deny、三种权限档位', () => {
  const okFrames = [
    { id: 'x', type: 'history', limit: 0 },
    { id: 'x', type: 'history' },
    { id: 'x', type: 'approval', requestId: 'r1', outcome: 'deny' },
    { id: 'x', type: 'approval', requestId: 'r1', outcome: 'allow' },
    { id: 'x', type: 'set_permission_mode', mode: 'read_only' },
    { id: 'x', type: 'set_permission_mode', mode: 'workspace_edit' },
    { id: 'x', type: 'set_permission_mode', mode: 'full_access' },
    { id: 'x', type: 'hello', version: 1 },
    { id: 'x', type: 'hello', version: 1, clientId: 'c1' }
  ]
  for (const frame of okFrames) {
    const parsed = parseClientFrame(JSON.stringify(frame))
    assert.equal(parsed.ok, true, JSON.stringify(frame))
  }
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
