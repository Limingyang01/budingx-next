// Host protocol (SP008 design §3, AC TB-01/02/04/06).
//
// One newline-delimited JSON frame per line over stdio or WebSocket text
// frames. Requests carry a caller-chosen id; every request gets exactly one
// response with the same id. Server-initiated frames (event, role_changed,
// fatal, pong) have no request id of their own and never expect a response.
//
// The host layer owns no session content: frames only carry ids, roles,
// shapes and SessionEvent values produced by src/core.
import type { SessionEvent } from '../core/events.js'
import type { PermissionMode } from '../core/permissions.js'

/** Protocol revision understood by this build. */
export const HOST_PROTOCOL_VERSION = 1

/** Hard cap for one NDJSON frame (decoded text), 1 MiB. */
export const HOST_FRAME_MAX_BYTES = 1024 * 1024

/** Host entries are same-machine only; this is not cross-device sync. */
export const HOST_SCOPE = 'local' as const

export type HostScope = typeof HOST_SCOPE

export type HostRole = 'owner' | 'observer'

export type HostErrorCode =
  | 'HOST_PROTOCOL_001'
  | 'HOST_PROTOCOL_002'
  | 'HOST_PROTOCOL_005'
  | 'HOST_SESSION_003'
  | 'HOST_AUTH_004'
  | 'HOST_STATE_006'

export type HostError = { code: HostErrorCode; message: string }

export type HostRequestType =
  | 'hello'
  | 'describe'
  | 'history'
  | 'submit'
  | 'interrupt'
  | 'approval'
  | 'set_permission_mode'
  | 'takeover'
  | 'shutdown'
  | 'ping'

export type HostRequestFrame =
  | { id: string; type: 'hello'; version: number; clientId?: string }
  | { id: string; type: 'describe' }
  | { id: string; type: 'history'; limit?: number }
  | { id: string; type: 'submit'; text: string }
  | { id: string; type: 'interrupt' }
  | { id: string; type: 'approval'; requestId: string; outcome: 'allow' | 'deny' }
  | { id: string; type: 'set_permission_mode'; mode: PermissionMode }
  | { id: string; type: 'takeover' }
  | { id: string; type: 'shutdown' }
  | { id: string; type: 'ping' }

export type HelloResult = {
  type: 'hello_ok'
  protocolVersion: number
  sessionId: string
  workspaceId: string
  clientId: string
  role: HostRole
  scope: HostScope
}

export type DescribeResult = {
  sessionId: string
  workspaceId: string
  title?: string
  state: string
  planMode: boolean
  permissionMode: PermissionMode
  role: HostRole
  scope: HostScope
}

export type HistoryResult = {
  messages: unknown[]
  /** True when older messages were dropped by the requested limit. */
  truncated: boolean
}

export type HostResult =
  | HelloResult
  | DescribeResult
  | HistoryResult
  | { accepted: boolean }
  | { interrupted: boolean }
  | { mode: PermissionMode }
  | { role: HostRole }
  | { stopping: boolean }
  | { pong: true }

export type HostResponseFrame =
  | { id: string; ok: true; result: HostResult }
  | { id: string; ok: false; error: HostError }

export type HostEventFrame = { type: 'event'; seq: number; event: SessionEvent }
export type HostRoleChangedFrame = { type: 'role_changed'; role: HostRole }
export type HostFatalFrame = { type: 'fatal'; code: HostErrorCode; message: string }
export type HostPongFrame = { type: 'pong'; id: string }

export type HostServerFrame =
  | HostResponseFrame
  | HostEventFrame
  | HostRoleChangedFrame
  | HostFatalFrame
  | HostPongFrame

export type HostFrame = HostRequestFrame | HostServerFrame

export type ParseFrameResult =
  | { ok: true; frame: HostRequestFrame }
  | { ok: false; error: HostError }

const REQUEST_TYPES: ReadonlySet<string> = new Set<HostRequestType>([
  'hello',
  'describe',
  'history',
  'submit',
  'interrupt',
  'approval',
  'set_permission_mode',
  'takeover',
  'shutdown',
  'ping'
])

const PERMISSION_MODES: ReadonlySet<string> = new Set<PermissionMode>([
  'read_only',
  'workspace_edit',
  'full_access'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function error(code: HostErrorCode, message: string): { ok: false; error: HostError } {
  return { ok: false, error: { code, message } }
}

/** Encode one frame as an NDJSON line (includes the trailing newline). */
export function encodeFrame(frame: HostFrame): string {
  return JSON.stringify(frame) + '\n'
}

/**
 * Parse one line received from a client. Oversized, malformed and non-request
 * frames are rejected with a stable code; the caller decides whether to close.
 */
export function parseClientFrame(line: string): ParseFrameResult {
  const text = line.endsWith('\r') ? line.slice(0, -1) : line
  if (Buffer.byteLength(text, 'utf8') > HOST_FRAME_MAX_BYTES) {
    return error('HOST_PROTOCOL_005', `frame exceeds ${HOST_FRAME_MAX_BYTES} bytes`)
  }
  if (text.trim().length === 0) {
    return error('HOST_PROTOCOL_002', 'empty frame')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return error('HOST_PROTOCOL_002', 'frame is not valid JSON')
  }
  if (!isRecord(parsed) || typeof parsed.id !== 'string' || parsed.id.length === 0) {
    return error('HOST_PROTOCOL_002', 'frame is missing a request id')
  }
  if (typeof parsed.type !== 'string') {
    return error('HOST_PROTOCOL_002', 'frame is missing a request type')
  }
  if (!REQUEST_TYPES.has(parsed.type)) {
    return error('HOST_STATE_006', `unknown request type: ${parsed.type}`)
  }
  return validateRequest(parsed as unknown as HostRequestFrame)
}

function validateRequest(frame: HostRequestFrame): ParseFrameResult {
  switch (frame.type) {
    case 'hello':
      if (typeof frame.version !== 'number' || !Number.isInteger(frame.version)) {
        return error('HOST_PROTOCOL_002', 'hello.version must be an integer')
      }
      if (frame.clientId !== undefined && typeof frame.clientId !== 'string') {
        return error('HOST_PROTOCOL_002', 'hello.clientId must be a string')
      }
      return { ok: true, frame }
    case 'describe':
    case 'interrupt':
    case 'takeover':
    case 'shutdown':
    case 'ping':
      return { ok: true, frame }
    case 'history':
      if (frame.limit !== undefined && (!Number.isInteger(frame.limit) || frame.limit < 0)) {
        return error('HOST_PROTOCOL_002', 'history.limit must be a non-negative integer')
      }
      return { ok: true, frame }
    case 'submit':
      if (typeof frame.text !== 'string' || frame.text.trim().length === 0) {
        return error('HOST_PROTOCOL_002', 'submit.text must be a non-empty string')
      }
      return { ok: true, frame }
    case 'approval':
      if (typeof frame.requestId !== 'string' || frame.requestId.length === 0) {
        return error('HOST_PROTOCOL_002', 'approval.requestId must be a non-empty string')
      }
      if (frame.outcome !== 'allow' && frame.outcome !== 'deny') {
        return error('HOST_PROTOCOL_002', 'approval.outcome must be allow or deny')
      }
      return { ok: true, frame }
    case 'set_permission_mode':
      if (!PERMISSION_MODES.has(frame.mode)) {
        return error('HOST_PROTOCOL_002', 'set_permission_mode.mode is not a known mode')
      }
      return { ok: true, frame }
  }
}
