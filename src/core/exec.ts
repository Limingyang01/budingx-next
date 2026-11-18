// SP004 命令执行 core 端口（设计 §4.1 / §4.3 / §4.4）。
// Core 只持有契约、常量与纯逻辑；真实进程执行由 src/exec 注入。

/** 一次命令调用的规格（模型可提供 command/timeout/run_in_background，其余宿主管有）。 */
export type CommandSpec = {
  /** 命令文本（交给 shell 解释）。 */
  command: string
  /** 工作目录；缺省为工作区根。 */
  cwd?: string
  /** 追加的环境变量；与基线环境合并。 */
  env?: Record<string, string>
  /** 超时毫秒；缺省用 EXEC_DEFAULT_TIMEOUT_MS，> EXEC_MAX_TIMEOUT_MS 被夹紧。 */
  timeoutMs?: number
  /** 是否转为后台执行。 */
  runInBackground?: boolean
}

export const COMMAND_OUTCOMES = [
  'completed',
  'failed',
  'timeout',
  'cancelled',
  'blocked',
  'running'
] as const

export type CommandOutcome = (typeof COMMAND_OUTCOMES)[number]

export type CommandResult = {
  outcome: CommandOutcome
  /** 进程退出码；被信号终止、未启动或仍在后台运行时为 undefined。 */
  exitCode?: number
  stdout: string
  stderr: string
  /** stdout+stderr 合并后的最终文本（已截断并标注）。 */
  output: string
  /** 输出是否因上限被截断。 */
  truncated: boolean
  /** 原始字节数（截断前）。 */
  bytes: number
  durationMs: number
  /** 后台任务的句柄；前台执行时为 undefined。 */
  taskId?: string
  /** 因超过阻塞预算被自动转入后台（参考 F-02）。 */
  autoBackgrounded?: boolean
  /** 用户手动转后台（Ctrl+B；本轮仅数据位，交互属 SP006）。 */
  backgroundedByUser?: boolean
  /** 完整输出落盘路径（后台任务或超大输出，对齐 F-03/F-04）。 */
  persistedOutputPath?: string
  /** 落盘文件的字节数。 */
  persistedOutputSize?: number
  /** 命令是否被中断（对齐参考 interrupted 字段）。 */
  interrupted?: boolean
  /** 命令是否预期无输出（对齐参考 noOutputExpected 字段）。 */
  noOutputExpected?: boolean
  /** 失败/阻断原因（可读）。 */
  reason?: string
}

/** 后台任务句柄（设计 §4.4）。 */
export type BackgroundTask = {
  taskId: string
  command: string
  interpreter: string
  cwd: string
  startedAt: number
  state: 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled'
  exitCode?: number
  stdout: string
  stderr: string
  truncated: boolean
  /** 完整输出的落盘路径（参考 F-03/F-04）。 */
  outputPath?: string
  /** 落盘文件的字节数。 */
  outputSize?: number
  /** 因超过阻塞预算被自动转入后台（参考 F-02）。 */
  autoBackgrounded: boolean
  /** 用户手动转后台（Ctrl+B，SP006 交互；本轮仅数据位）。 */
  backgroundedByUser: boolean
}

/** 核心只持有契约；真实执行由 src/exec 注入。 */
export interface CommandRunner {
  run(spec: CommandSpec, context: { signal: AbortSignal; cwd: string }): Promise<CommandResult>
  /** 查询后台任务状态与输出。 */
  status(taskId: string): CommandResult | undefined
  /** 取消后台任务（终止整棵进程树）；已终态幂等返回 false。 */
  cancel(taskId: string): boolean
  list(): CommandResult[]
  /** 会话结束时终止全部运行中后台任务（design §4.4，Session.dispose 接线）。 */
  dispose?(): void
}

// 超时与输出常量（设计 §4.3，数值对齐参考 F-01/F-02/F-04）。
export const EXEC_DEFAULT_TIMEOUT_MS = 120000
export const EXEC_MAX_TIMEOUT_MS = 600000
export const EXEC_HARD_TIMEOUT_MS = 900000
export const EXEC_BLOCKING_BUDGET_MS = 15000
export const EXEC_OUTPUT_CAP = 32768
export const EXEC_PERSIST_THRESHOLD = 1048576

export type ExecTimeoutConfig = {
  defaultMs: number
  maxMs: number
  hardMs: number
}

/** 解析超时配置；BUDINGX_EXEC_* 环境变量可覆盖默认与上限，硬上限不可覆盖。 */
export function resolveTimeoutConfig(env: Record<string, string | undefined>): ExecTimeoutConfig {
  const defaultMs = parsePositiveInt(env.BUDINGX_EXEC_DEFAULT_TIMEOUT_MS) ?? EXEC_DEFAULT_TIMEOUT_MS
  const maxMs = parsePositiveInt(env.BUDINGX_EXEC_MAX_TIMEOUT_MS) ?? EXEC_MAX_TIMEOUT_MS
  return {
    defaultMs: Math.min(defaultMs, maxMs),
    maxMs,
    hardMs: EXEC_HARD_TIMEOUT_MS
  }
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) return undefined
  return value
}

/** 运行期形状守卫：校验 CommandResult 的必填字段（类型契约的运行时投影）。 */
export function isCommandResult(value: unknown): value is CommandResult {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (!COMMAND_OUTCOMES.includes(record.outcome as CommandOutcome)) return false
  if (typeof record.stdout !== 'string') return false
  if (typeof record.stderr !== 'string') return false
  if (typeof record.output !== 'string') return false
  if (typeof record.truncated !== 'boolean') return false
  if (typeof record.bytes !== 'number' || !Number.isFinite(record.bytes)) return false
  if (typeof record.durationMs !== 'number' || !Number.isFinite(record.durationMs)) return false
  return true
}