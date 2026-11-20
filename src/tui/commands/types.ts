// SP006 §6.1：命令注册表三型契约（独立实现，行为语义对齐参考仓）
import type { DenialRecord } from '../../core/events.js'
import type { PermissionMode } from '../../core/permissions.js'
import type { ReasoningEffort } from '../../core/provider.js'
import type { Session } from '../../core/session.js'
import type { ConfigStore } from '../../storage/config-store.js'
import type { CredentialStore } from '../../storage/credentials.js'
import type { ResolvedConfig } from '../../storage/profiles.js'
import type { PermissionsStore } from '../../storage/permissions.js'
import type { discoverModels, probe } from '../../provider/openai.js'
import type { BudingPermissionPolicy, PermissionRule } from '../../workspace/policy.js'
import type { ChangeRecord, UndoOutcome } from '../../workspace/checkpoint.js'
import type { Workspace } from '../../workspace/paths.js'

export type CommandOutcome = {
  handled: boolean
  exit?: boolean
  message?: string
  error?: string
  openModels?: boolean
  openEffort?: boolean
  openRules?: boolean
  openResume?: boolean
  openRewind?: boolean
  openContext?: boolean
  skillPrompt?: { name: string; body: string }
  /** Interactive hosts open the diff dialog on this instead of printing. */
  openDiffDialog?: boolean
}

export type CommandContext = {
  session: Session
  configStore: ConfigStore
  credentialStore: CredentialStore
  getConfig: () => ResolvedConfig
  setConfig: (config: ResolvedConfig) => void
  exit: () => void
  probe?: typeof probe
  discoverModels?: typeof discoverModels
  interactive?: boolean
  lang?: 'zh' | 'en'
  /** SP003: present once the workspace runtime is wired. */
  permission?: {
    policy: BudingPermissionPolicy
    setMode?: (mode: PermissionMode) => boolean
    store: PermissionsStore
    workspace: Workspace
    checkpointChanges: () => ChangeRecord[]
    undo: (path?: string) => UndoOutcome
    denials: () => DenialRecord[]
    modes: { order: PermissionMode[]; zh: Record<string, string>; en: Record<string, string> }
  }
  /** SP005: present once the session persistence runtime is wired. */
  sessions?: {
    list: () => { sessionId: string; title: string; updatedAt: string; turns: number }[]
    resume: (sessionId: string) => {
      ok: boolean
      message?: string
      messages?: unknown[]
      needsReview?: { name: string; callId: string; detail?: string }[]
      warnings?: string[]
    }
  }
  contextUsage?: {
    usage: () => {
      usedTokens?: number
      maxTokens?: number
      reservedOutputTokens?: number
      triggerTokens?: number
      percentUsed?: number
      source: 'provider' | 'none'
    }
  }
  context?: {
    budget: () => {
      estimatedTokens: number
      maxTokens: number
      reservedOutputTokens: number
      triggerTokens: number
      messages: number
      breakdown: { kind: string; tokens: number }[]
    }
  }
  effort?: {
    current: () => ReasoningEffort
    set: (next: ReasoningEffort) => void
    choices: readonly ReasoningEffort[]
    supported?: boolean
  }
  memory?: {
    read: (scope: 'project' | 'session') => { entries: { title: string; text: string }[]; message?: string }
    write: (scope: 'project' | 'session', title: string, text: string) => { ok: boolean; message?: string }
  }
}

/** SP006 §6.1：命令型 -> 输出语义（本仓统一文本结果）。 */
export type CommandKind = 'local' | 'local-jsx' | 'prompt'

export interface CommandResult {
  kind: 'text'
  value: string
  /**
   * 宿主副作用（面板打开、退出、技能提示）。SP006 扩展字段：
   * 设计 §6.1 的文本结果与既有 CommandOutcome 的桥接，见 design §15 D-11。
   */
  outcome?: CommandOutcome
}

export interface CommandDefinition {
  name: string
  aliases?: string[]
  kind: CommandKind
  summary: string
  immediate?: boolean
  hidden?: boolean
  supportsNonInteractive?: boolean
  progressMessage?: string
  run(args: string, context: CommandContext): Promise<CommandResult>
}

/** SP006 §6.2：统一模态挂载点。 */
export interface ModalSlot {
  id: string
  title: string
  render(props: { onDone: (result?: unknown) => void }): unknown
}
