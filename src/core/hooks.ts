/** SP006 §9：Session 与 hooks 宿主之间的最小端口（core 不依赖 tui）。 */

export type SessionHookEvent =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Stop'
  | 'StopFailure'
  | 'Notification'

export interface HookRunResult {
  /** 退出码 2 / decision:block / continue:false —— 阻断当前动作。 */
  blocked: boolean
  reason?: string
  suppressOutput?: boolean
  systemMessages?: string[]
  additionalContext?: string[]
  permissionDecision?: 'allow' | 'deny' | 'ask'
  permissionDecisionReason?: string
  updatedInput?: unknown
  warnings?: string[]
}

export interface SessionHooks {
  run(event: SessionHookEvent, input: Record<string, unknown>): Promise<HookRunResult>
}
