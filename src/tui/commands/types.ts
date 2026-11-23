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
  /** SP009：/export 打开会话选择面板（local-jsx）。 */
  openExport?: boolean
  /** Interactive hosts open the diff dialog on this instead of printing. */
  openDiffDialog?: boolean
  /** prompt 型命令：宿主把 text 作为下一次模型输入，progress 作为进度提示（CMD-04）。 */
  prompt?: { text: string; progress?: string }
  /** prompt 型旁路命令：宿主单独提问且不写入会话历史（CMD-06）。 */
  sideQuestion?: string
  /** local-jsx 命令：宿主用模态槽展示只读列表（CMD-03/CMD-09/CMD-10）。 */
  openList?: { title: string; lines: string[] }
  /** SP007 T9：/agents 管理面板（local-jsx，宿主挂 AgentsMenu）。 */
  openAgents?: boolean
  /** SP007 T10：/status /stats /doctor 诊断面板（local-jsx）。 */
  openStatus?: boolean
  openStats?: boolean
  openDoctor?: boolean
  /**
   * SP007 MM-01 补：/image 已准备好的附件。终端无关——VS Code 等宿主会把
   * alt+v 当 chord 前缀吞掉，用户仍可用 /image 附上剪贴板图片。
   */
  attachImage?: {
    mediaType: string
    data: string
    width?: number
    height?: number
    resized?: boolean
  }
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
      /** SP006：恢复后当前生效的会话 id（恢复会切换身份）。 */
      sessionId?: string
    }
    /** SP009：只读读取某个会话的历史，不切换身份、不写盘（/export 选择会话用）。 */
    read?: (sessionId: string) => {
      ok: boolean
      message?: string
      messages?: { role: string; blocks: unknown[] }[]
    }
  }
  /** SP009：技能列表注入点；缺省时从用户/项目目录发现。 */
  skills?: {
    name: string
    description: string
    body: string
    path: string
    scope: 'user' | 'project'
    valid: boolean
    error?: string
  }[]
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
  /** SP006 CMD-08：后台/未完成任务登记表；缺省视为没有任务。 */
  tasks?: {
    list: () => import('../tasks.js').TaskRecord[]
  }
  /** SP007 T9：子代理登记表（/tasks Agents 分组、停止/后台化）。 */
  agents?: {
    list: () => import('../../core/agent-runtime.js').AgentRecord[]
    stop: (agentId: string) => { ok: boolean; state?: string }
    background: (callId: string) => boolean
  }
  /** SP007 T10：诊断面板数据端口（/status /stats /doctor，宿主注入原始事实）。 */
  diagnostics?: {
    statusInput: () => import('../diagnostics/status-report.js').StatusReportInput
    sessionsDir: string
    cachePath: string
    today: string
    doctorInput: () => import('../diagnostics/doctor.js').DoctorInput
    copyToClipboard?: (text: string) => boolean
  }
  /** SP007：/image 的图片来源（默认读剪贴板/本地文件，测试可替换）。 */
  imageSource?: {
    clipboard: () => { data: Buffer; mediaType: string } | undefined
    file: (path: string) => { data: Buffer; mediaType: string }
  }
  /** SP006 CMD-09：MCP 连接状态（由宿主在启动时注入）。 */
  mcp?: {
    statuses: import('../mcp/types.js').McpServerStatus[]
  }
  /** SP006 CMD-07：删除类命令的宿主确认；返回 false 表示用户取消。 */
  confirm?: (request: { summary: string; preview: string[] }) => Promise<boolean>
  /** 当前工作区与数据根；缺省用 process.cwd()/homedir()。 */
  cwd?: string
  home?: string
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
