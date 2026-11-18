// Core event contract (SP002 design §3.2, SP003 design §4.2 v2).
// Host agnostic: no UI types, JSON serializable.
import type { PermissionMode } from './permissions.js'

export type SessionState =
  | 'idle'
  | 'requesting'
  | 'streaming'
  | 'awaiting_approval'
  | 'tool_running'
  | 'cancelling'

export type TurnOutcome =
  | 'completed'
  | 'error'
  | 'cancelled'
  | 'length_capped'
  | 'max_turns'
  | 'unknown'

export type NoticeCode =
  | 'api_retry'
  | 'stream_fallback'
  | 'late_event_dropped'
  | 'queue_recycled'
  | 'approval_dismissed'
  | 'config_migrated'
  | 'orphan_keys_found'
  | 'model_limit_reached'
  | 'file_context'

export type ErrorClass =
  | 'auth'
  | 'not_found'
  | 'rate_limited'
  | 'overloaded'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'invalid_stream'
  | 'context_overflow'
  | 'tool_unsupported'
  | 'bad_request'
  | 'unknown'

export type ErrorInfo = {
  class: ErrorClass
  code: string
  message: string
  retryable: boolean
  status?: number
}

export type Usage = {
  inputTokens?: number
  outputTokens?: number
}

export type TurnSnapshot = {
  modelId: string
  model: string
  baseUrlHost: string
  capabilities: { tools: boolean }
}

export type MessageBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; callId: string; content: string; isError: boolean }
  | { type: 'interrupt_mark'; reason: 'user' }
  /**
   * File reference brought in with @ (SP003 AC FC-04). Stored with the
   * user message and rendered as a separated block by normalizeForApi so
   * file content never masquerades as user instruction.
   */
  | { type: 'context'; source: string; content: string }

/** Summary of one recorded workspace write (SP003 design §4.2). */
export type ChangeRecordSummary = {
  id: string
  path: string
  operation: 'create' | 'update'
  additions: number
  removals: number
  turnId?: string
  at: string
}

export type DenialRecord = {
  tool: string
  path?: string
  reason: string
  at: string
}

export type Message = {
  id: string
  role: 'user' | 'assistant' | 'tool'
  blocks: MessageBlock[]
}

export type TurnFinalizedEvent = {
  type: 'turn_finalized'
  turnId: string
  outcome: TurnOutcome
  error?: ErrorInfo
  usage?: Usage
  restoreText?: string
}

export type SessionEvent =
  | { type: 'conversation_cleared' }
  | { type: 'turn_started'; turnId: string; snapshot: TurnSnapshot }
  | { type: 'text_delta'; turnId: string; messageId: string; text: string }
  | { type: 'thinking_delta'; turnId: string; messageId: string; text: string }
  | {
      type: 'message_completed'
      turnId: string
      messageId: string
      usage?: Usage
    }
  | {
      type: 'tool_call_completed'
      turnId: string
      callId: string
      name: string
      input: unknown
    }
  | {
      type: 'approval_requested'
      turnId: string
      requestId: string
      callId: string
      name: string
      summary: string
      preview?: readonly string[]
    }
  | {
      type: 'approval_resolved'
      turnId: string
      requestId: string
      outcome: 'allow' | 'allow_session' | 'deny' | 'cancelled'
      via: 'user' | 'policy'
    }
  | {
      type: 'tool_result'
      turnId: string
      callId: string
      content: string
      isError: boolean
    }
  | { type: 'change_set'; changes: ChangeRecordSummary[] }
  | { type: 'denial_recorded'; denial: DenialRecord }
  | { type: 'permission_changed'; mode: PermissionMode }
  | { type: 'input_queued'; queueId: string; preview: string }
  | {
      type: 'input_injected'
      turnId: string
      queueId: string
      boundary: 'intra_turn' | 'inter_turn'
    }
  | { type: 'status'; state: SessionState; note?: string }
  | {
      type: 'notice'
      level: 'info' | 'warning' | 'error'
      code: NoticeCode
      text: string
    }
  | TurnFinalizedEvent
