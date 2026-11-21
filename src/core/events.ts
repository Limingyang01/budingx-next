// Core event contract (SP002 design §3.2, SP003 design §4.2 v2, SP004 design §4.4/§6).
// Host agnostic: no UI types, JSON serializable.
import type { PermissionMode } from './permissions.js'
import type { CommandOutcome } from './exec.js'
import type { Plan, PendingQuestion, PlanModePhase, QuestionAnswers, QuestionAnnotations } from './plan.js'

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
  // SP004 对齐参考终止原因（设计 C-09/F-16；本轮仅契约，产生属后续接线）。
  | 'blocking_limit'
  | 'prompt_too_long'
  | 'image_error'
  | 'stop_hook_blocking'
  | 'stop_hook_prevented'

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
  /** 计划模式提示：进入调研/待批、漂移回待审或恢复原档位（SP004 §6.2）。 */
  | 'plan_mode'
  /** 编码任务提示：完成声明缺少执行证据并被拒绝（SP004 §5.2，CT-07）。 */
  | 'coding_task'
  /** 上下文预算提示：压缩后仍超出预算或压缩熔断（SP005 §4）。 */
  | 'context_overflow'
  /** 持久化提示：转录或记忆写入失败，但本轮业务结果已交付（SP005 §5/§7）。 */
  | 'storage_write_failed'
  /** 恢复提示：存在结果未知的工具步骤，需人工核对而非自动重放（SP005 §5）。 */
  | 'recovery_needs_review'
  /** SP006 §9：hook 的普通输出、执行告警与阻断结果。 */
  | 'hook_output'
  | 'hook_warning'
  | 'hook_blocked'
  /** SP007 §4.7：子代理终态通知、图片降级/拒绝、ToolSearch 发现公告。 */
  | 'agent_notification'
  | 'image_downgraded'
  | 'image_rejected'
  | 'tool_search'

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
  /** vision undefined＝未知（错误驱动降级）；false＝明确拒绝图片（SP007 MM-08）。 */
  capabilities: { tools: boolean; vision?: boolean }
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
  /**
   * Pasted/attached image carried by a user message (SP007 MM-05).
   * data is base64 (single image ≤5MB base64, design D12); id is the
   * per-session paste counter used for the [Image #N] placeholder.
   */
  | { type: 'image'; id: number; mediaType: string; data: string; width?: number; height?: number }

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
  finishedAt: number
  error?: ErrorInfo
  usage?: Usage
  restoreText?: string
  /**
   * 持久化错误（SP005 §5 FR-07）：写入转录失败与模型失败是两回事，
   * 业务结果仍然交付，这里单独记录失败位置供定位。
   */
  persistenceError?: { code: string; message: string }
}

/** 压缩保留项的种类（SP005 §4）：约束 / 计划 / 工具状态。 */
export type PreservedItemKind = 'constraint' | 'plan' | 'tool_state'

/**
 * 上下文压缩事件（SP005 §4 CB-01）。
 * 被替换的历史区间与保留项都被显式记录，便于断言与审计。
 */
export type ContextCompactedEvent = {
  type: 'context_compacted'
  turnId: string
  /** 被替换掉的原始消息索引区间（闭区间）。 */
  replacedRange: { from: number; to: number }
  /** 被替换掉的消息条数。 */
  replacedCount: number
  /** 压缩后仍然保留的关键事实。 */
  preserved: { kind: PreservedItemKind; id: string; text: string; reason: string }[]
  /** 压缩前的估算长度。 */
  estimatedBefore: number
  /** 压缩后的估算长度。 */
  estimatedAfter: number
  /** 压缩后是否回到预算内。 */
  withinBudget: boolean
}

export type SessionEvent =
  | { type: 'conversation_cleared' }
  | { type: 'conversation_rewound'; entries: { kind: 'user' | 'assistant'; text: string }[]; removedCount: number }
  | {
      /**
       * SP006 回归修复：/resume 恢复出来的历史。
       * 历史必须同时进入模型上下文与可见转录，否则用户看不到自己恢复了什么。
       * 契约与 /rewind 同构：宿主据此重建转录，绝不重放任何工具步骤。
       */
      type: 'conversation_restored'
      messages: Message[]
    }
  | { type: 'turn_started'; turnId: string; snapshot: TurnSnapshot; userText: string; startedAt: number }
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
      /** SP004 T11/T15：计划审批的计划身份，TUI 用它渲染计划卡片与编辑正文。 */
      planId?: string
      planVersion?: number
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
      text: string
      boundary: 'intra_turn' | 'inter_turn'
    }
  | { type: 'status'; state: SessionState; note?: string }
  | {
      type: 'command_started'
      turnId: string
      callId: string
      command: string
      interpreter: string
      cwd: string
      taskId?: string
      startedAt: number
    }
  | {
      type: 'command_finished'
      taskId: string
      callId?: string
      turnId?: string
      outcome: CommandOutcome
      exitCode?: number
      outputPath?: string
      finishedAt: number
    }
  | { type: 'plan_updated'; plan: Plan }
  | {
      /**
       * 计划模式单一状态转换（SP004 设计 §6.2）。active=false 表示已离开
       * 计划模式并恢复 originalMode；phase 描述调研/待批子状态。
       */
      type: 'plan_mode_changed'
      active: boolean
      phase?: PlanModePhase
      originalMode?: PermissionMode
    }
  | {
      type: 'question_requested'
      turnId: string
      callId: string
      question: PendingQuestion
    }
  | {
      type: 'question_answered'
      turnId: string
      callId: string
      questionId: string
      answers: QuestionAnswers
      annotations?: QuestionAnnotations
    }
  | {
      type: 'question_cancelled'
      turnId: string
      callId: string
      questionId: string
    }
  | {
      type: 'notice'
      level: 'info' | 'warning' | 'error'
      code: NoticeCode
      text: string
    }
  | ContextCompactedEvent
  | TurnFinalizedEvent
  /** SP007 §4.1：子代理生命周期事件（UI-only；headless 不输出，FB-04）。 */
  | {
      type: 'agent_started'
      turnId: string
      callId: string
      agentId: string
      agentType: string
      description: string
      color?: string
      background: boolean
    }
  | {
      type: 'agent_progress'
      agentId: string
      toolUses: number
      tokens: number
      lastTools: string[]
      state: 'running' | 'backgrounded'
    }
  | {
      type: 'agent_finished'
      agentId: string
      outcome: TurnOutcome
      toolUses: number
      tokens: number
      durationMs: number
      background: boolean
    }
