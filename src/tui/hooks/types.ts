import type { SessionHookEvent } from '../../core/hooks.js'

export type HookEventName = SessionHookEvent

export const HOOK_EVENTS: readonly HookEventName[] = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'StopFailure',
  'Notification'
]

export interface HookResponse {
  continue?: boolean
  suppressOutput?: boolean
  stopReason?: string
  decision?: 'approve' | 'block'
  reason?: string
  systemMessage?: string
  hookSpecificOutput?: {
    hookEventName?: HookEventName
    permissionDecision?: 'allow' | 'deny' | 'ask'
    permissionDecisionReason?: string
    updatedInput?: unknown
    additionalContext?: string
  }
}

export interface HookCommandHandler {
  type: 'command'
  command: string
  /** 秒，默认 30。 */
  timeout?: number
}

/** 本轮把 prompt 处理器的固定文本作为上下文注入（不做额外模型调用，OPEN）。 */
export interface HookPromptHandler {
  type: 'prompt'
  prompt: string
  timeout?: number
}

export type HookHandler = HookCommandHandler | HookPromptHandler

export interface HookMatcher {
  /** 正则或字面量；空 / * 匹配全部。工具事件匹配 tool_name。 */
  matcher?: string
  enabled?: boolean
  hooks: HookHandler[]
}

export type HookConfig = Partial<Record<HookEventName, HookMatcher[] | false>>

export interface LoadedHooks {
  config: HookConfig
  warnings: string[]
  /** 配置存在但无法解析时为 true。 */
  corrupt?: boolean
  /** 损坏文件已备份到的路径。 */
  backupPath?: string
}

export interface HookExecution {
  event: HookEventName
  handler: 'command' | 'prompt'
  durationMs: number
  exitCode?: number | null
  blocked?: boolean
}
