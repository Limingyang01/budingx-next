// Tool and approval ports owned by Core (SP002 design §3.3, SP003 §4.1 v2).

import type { ChangeRecordSummary } from './events.js'
import type { ToolCapability } from './permissions.js'

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
   * Classification used by the permission policy: read tools never write,
   * write tools mutate the workspace. Defaults to 'read' when absent so
   * SP002 tools keep working.
   */
  capability?(input: unknown): ToolCapability
  /** Target of the call, resolved enough for policy decisions. */
  target?(input: unknown): { path?: string; kind: 'file' | 'directory' | 'search' | 'none' }
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
}

export interface ApprovalGateway {
  cancelAll?(): void
  request(request: ApprovalRequest): Promise<ApprovalDecision>
}
