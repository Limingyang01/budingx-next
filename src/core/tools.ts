// Tool and approval ports owned by Core (SP002 design §3.3, SP003 §4.1 v2).

import type { ChangeRecordSummary, SessionEvent } from './events.js'
import type { CommandResult } from './exec.js'
import type { ToolCapability } from './permissions.js'

export function sliceToolOutput(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength).replace(/[\uD800-\uDBFF]$/, '')
}

export type ToolContext = {
  signal: AbortSignal
  onUpdate?(text: string): void
  /**
   * Lets file tools report the changes they wrote so the Session can
   * emit change_set events (SP003 §4.2). Optional for older hosts.
   */
  changes?(records: ChangeRecordSummary[]): void
  /** Id of the running turn, for per-turn change grouping (SP003 T18). */
  turnId?: string
  /** Id of the model tool call this execution belongs to (SP004 T5). */
  callId?: string
  /** Lets adapters publish out-of-band events such as command_started (SP004 T5). */
  emit?(event: SessionEvent): void
  /**
   * Lets command adapters report a finished CommandResult so the host can
   * record evidence for coding-task completion claims (SP004 T13, CT-07).
   */
  onCommandResult?(command: string, result: CommandResult): void
  /**
   * 宿主单次授权标记：本次调用经审批通道允许后为 true（SP004 T25）。
   * 用于「删除等不可逆操作必须由宿主授权、模型参数无授权效力」的场景。
   */
  approved?: boolean
}

export type PreparedTool = {
  preview: readonly string[]
  execute(context: ToolContext): Promise<string>
}

export type ToolHandler = {
  name: string
  parameters?: Record<string, unknown>
  /** Short static description used for the provider tool specification. */
  summary?: string
  describe(input: unknown): string
  requiresApproval?(input: unknown): boolean
  /**
   * 不可逆操作（如删除 worktree）的硬性审批钩子：即使当前档位是「完全权限」、
   * 或已有会话记忆允许，也必须经过宿主审批通道（SP004 T25，设计 §7.3）。
   */
  mandatoryApproval?(input: unknown): boolean
  /**
   * Classification used by the permission policy: read tools never write,
   * write tools mutate the workspace. Defaults to 'read' when absent so
   * SP002 tools keep working.
   */
  capability?(input: unknown): ToolCapability
  /** Target of the call, resolved enough for policy decisions. */
  target?(input: unknown): { path?: string; kind: 'file' | 'directory' | 'search' | 'none' | 'plan-draft' }
  /**
   * SP007 SA-05: consecutive calls of handlers marked concurrencySafe may
   * run in parallel inside one dispatch group (Agent tool). Everything
   * else keeps the sequential order.
   */
  concurrencySafe?: boolean
  prepareApproval?(input: unknown): PreparedTool
  execute(input: unknown, context: ToolContext): Promise<string>
}

export type ApprovalRequest = {
  requestId: string
  turnId: string
  callId: string
  name: string
  summary: string
  preview?: readonly string[]
  /** 计划模式待批时携带计划标识与版本（SP004 设计 §6.3）。 */
  planId?: string
  planVersion?: number
}

export type ApprovalDecision = {
  /**
   * allow_session remembers the target for the rest of the session
   * (SP003 AC PC-06). Unknown outcomes are treated as deny.
   */
  outcome: 'allow' | 'allow_session' | 'deny' | 'cancelled'
  via: 'user' | 'policy'
  remember?: { tool: string; path?: string }
  /**
   * Optional user feedback captured on reject (SP003 T18c, aligned with
   * the reference's "tell the agent what to do differently" path). When
   * present it is appended to the tool result so the model can act on it.
   */
  feedback?: string
  /**
   * 计划批准时宿主可携带用户编辑后的正文；指纹按编辑后正文重算
   * （SP004 设计 §6.2/§6.3）。
   */
  editedText?: string
}

export interface ApprovalGateway {
  cancelAll?(): void
  request(request: ApprovalRequest): Promise<ApprovalDecision>
}
