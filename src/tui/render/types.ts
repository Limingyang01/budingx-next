import type {
  ChangeRecordSummary,
  DenialRecord,
  NoticeCode,
  SessionState
} from '../../core/events.js'
import type { PermissionMode } from '../../core/permissions.js'
import type { PlanStepStatus } from '../../core/plan.js'
import type {
  Question,
  QuestionAnnotations,
  QuestionAnswers
} from '../../core/plan.js'

export type QueueItem = { id: string; preview: string }

export type ApprovalCard = {
  requestId: string
  name: string
  summary: string
  preview?: readonly string[]
  /** SP004 T11/T15：计划审批携带的计划身份，用于 e 编辑正文与漂移展示。 */
  planId?: string
  planVersion?: number
}

export type NoticeItem = {
  level: 'info' | 'warning' | 'error'
  code: NoticeCode | string
  text: string
}

export type ToolTranscriptEntry = {
  kind: 'tool'
  text: string
  turnId: string
  callId: string
  status: 'pending' | 'success' | 'error' | 'interrupted'
  result?: string
  elapsedMs?: number
}

export type TranscriptEntry =
  | { kind: 'user' | 'assistant' | 'meta' | 'plain'; text: string }
  | ToolTranscriptEntry

/** 命令卡片：一次命令调用的可视状态（SP004 T15 / VIS-01）。 */
export type CommandCard = {
  callId: string
  command: string
  interpreter: string
  cwd?: string
  description?: string
  taskId?: string
  state: 'running' | 'background' | 'completed' | 'failed' | 'cancelled'
  startedAt: number
  finishedAt?: number
  exitCode?: number
  outputPath?: string
  /** 工具结果原文（用于展开输出）；超过阈值时由渲染层截断。 */
  result?: string
}

/** 计划卡片：调研期/待批期的计划与步骤（SP004 T15 / VIS-02）。 */
export type PlanCard = {
  planId: string
  goal: string
  steps: readonly {
    id: string
    title: string
    status: PlanStepStatus
    blockedBy?: readonly string[]
    note?: string
  }[]
  approval: 'none' | 'pending' | 'approved' | 'rejected'
  mode: 'research' | 'pending' | 'approved' | 'idle'
  updatedAt: number
}

/** 待办卡片：由计划步骤派生，带完成项 TTL（SP004 T15 / VIS-03）。 */
export type TodoItemCard = {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'blocked'
  blockedBy?: readonly string[]
}

export type TodoCard = {
  items: readonly TodoItemCard[]
  updatedAt: number
  /** 每条待办进入 completed 的时间（TTL 用）。 */
  completedAt: Readonly<Record<string, number>>
}

/** 追问卡片：单题/多题、单选/多选与自由输入（SP004 T15 / VIS-04）。 */
export type QuestionCard = {
  questionId: string
  callId: string
  turnId: string
  questions: readonly Question[]
  allowFreeText: boolean
  state: 'pending' | 'answered' | 'cancelled'
  answers?: QuestionAnswers
  annotations?: QuestionAnnotations
  createdAt: number
}

export type Frame = {
  /** Logical transcript entries, retained for both narrower and wider resize. */
  transcript: TranscriptEntry[]
  startedAt?: number
  lastQuestion?: string
  lastAnswer?: string
  suggestFollowUp?: boolean
  /** Finished transcript lines, already written to the terminal scrollback. */
  staticLines: string[]
  /** Raw text of the running assistant message (never re-wrapped in place). */
  liveText: string
  thinking: boolean
  /** The live area of the running turn. */
  liveLines: string[]
  status: { state: SessionState; note?: string }
  queue: QueueItem[]
  approval?: ApprovalCard
  /** SP004 T15 四类卡片。 */
  command?: CommandCard
  plan?: PlanCard
  todos?: TodoCard
  question?: QuestionCard
  notices: NoticeItem[]
  error?: string
  /** Current permission mode (SP003 design §3.8). */
  permissionMode: PermissionMode
  /** Changes written by this session, newest last (SP003 AC CP-06). */
  changes: ChangeRecordSummary[]
  /** Recent refusals, newest last (SP003 AC PC-10). */
  denials: DenialRecord[]
}

export function initialFrame(mode: PermissionMode = 'read_only'): Frame {
  return {
    transcript: [],
    staticLines: [],
    liveText: '',
    thinking: false,
    liveLines: [],
    status: { state: 'idle' },
    queue: [],
    notices: [],
    error: undefined,
    permissionMode: mode,
    changes: [],
    denials: []
  }
}
