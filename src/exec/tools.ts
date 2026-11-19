// SP004 T5 · Bash / PowerShell 工具适配器（design §4.5–§4.9）。
// 模型只提供 command/timeout/description/run_in_background；cwd、env、隔离和策略由宿主管有。
// 权限判定统一交给 SP003 策略：已校验只读命令归为 read（免审批），其余归为 execute。
import { ERROR_CODES, TOOL_OUTPUT_CAP } from '../core/constants.js'
import type { CommandResult, CommandRunner, CommandRunContext } from '../core/exec.js'
import type { ToolCapability } from '../core/permissions.js'
import type { ToolContext, ToolHandler } from '../core/tools.js'
import { destructiveWarningText, detectDestructiveCommand } from './destructive.js'
import { selectInterpreter } from './interpreter.js'
import { isBlockingWaitCommand, isInteractiveCommand, isReadOnlyCommand } from './readonly-commands.js'

export type ExecToolName = 'Bash' | 'PowerShell'

export type ExecToolsOptions = {
  runner: CommandRunner
  /** 工作区根：命令的缺省工作目录（宿主管有，模型不可指定）。 */
  defaultCwd: string
  /** 当前工作目录由宿主更新，例如进入或退出专用 worktree。 */
  getCwd?: () => string
  /** 平台注入（测试用）；缺省 process.platform。 */
  platform?: NodeJS.Platform
  /** 已验收的隔离后端标识，仅用于审批预览展示。 */
  sandboxBackendId?: string
  sandboxInterpreter?: import('./sandbox-policy.js').SandboxBackend['resolveInterpreter']
}

const ALLOWED_FIELDS = ['command', 'timeout', 'description', 'run_in_background'] as const

const TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description: '要执行的命令文本（交给所选 shell 解释）。'
    },
    timeout: {
      type: 'number',
      description: '超时时间（毫秒）；缺省 120000，超过 600000 会被夹紧。'
    },
    description: {
      type: 'string',
      description: '这条命令做什么的一句话说明，用于界面展示。'
    },
    run_in_background: {
      type: 'boolean',
      description: '是否立即转入后台执行；长时间运行的命令应设为 true。'
    }
  },
  required: ['command'],
  additionalProperties: false
} as const

type Args = {
  command: string
  timeoutMs?: number
  description?: string
  runInBackground?: boolean
}

function inputError(message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = ERROR_CODES.coreToolFailed
  return error
}

function readArgs(input: unknown): Args {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw inputError('命令参数必须是对象')
  }
  const record = input as Record<string, unknown>
  const unknown = Object.keys(record).filter(
    (key) => !(ALLOWED_FIELDS as readonly string[]).includes(key)
  )
  if (unknown.length > 0) {
    // cwd/env/隔离后端等宿主私有字段只能由宿主提供，模型提供即拒绝（design §4.9）。
    throw inputError(
      `未知参数：${unknown.join('、')}；仅支持 ${ALLOWED_FIELDS.join('/')}，工作目录与环境由宿主决定`
    )
  }
  const command = record.command
  if (typeof command !== 'string' || command.trim() === '') {
    throw inputError('command 必须是非空字符串')
  }
  let timeoutMs: number | undefined
  if (record.timeout !== undefined) {
    if (typeof record.timeout !== 'number' || !Number.isFinite(record.timeout) || record.timeout <= 0) {
      throw inputError('timeout 必须是正数毫秒')
    }
    timeoutMs = Math.floor(record.timeout)
  }
  let description: string | undefined
  if (record.description !== undefined) {
    if (typeof record.description !== 'string') throw inputError('description 必须是字符串')
    description = record.description
  }
  let runInBackground: boolean | undefined
  if (record.run_in_background !== undefined) {
    if (typeof record.run_in_background !== 'boolean') {
      throw inputError('run_in_background 必须是布尔值')
    }
    runInBackground = record.run_in_background
  }
  return {
    command,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(runInBackground !== undefined ? { runInBackground } : {})
  }
}

/** Git 写操作必须走 §7 受控入口；通用命令入口只放行只读白名单内的 git 调用。 */
function gitGuidance(command: string): string | undefined {
  if (!/^\s*git(\s|$)/i.test(command)) return undefined
  if (isReadOnlyCommand(command)) return undefined
  return '该 Git 命令不在只读白名单内，不能用通用命令入口执行；写操作请使用受控 Git 入口（未经授权不会改动仓库）'
}

function fitOutputPreview(text: string, limit: number): string {
  if (text.length <= limit) return text
  const marker = '\n… [输出已截断]\n'
  if (limit <= marker.length) return text.slice(0, limit)
  const available = limit - marker.length
  const head = Math.ceil(available / 2)
  return text.slice(0, head) + marker + text.slice(text.length - (available - head))
}

function formatResult(result: CommandResult): string {
  const lines: string[] = []
  if (result.outcome === 'running') {
    lines.push('exit_code: <pending>')
    if (result.taskId !== undefined) lines.push(`background_task_id: ${result.taskId}`)
    lines.push(`auto_backgrounded: ${result.autoBackgrounded === true}`)
  } else if (result.exitCode !== undefined) {
    lines.push(`exit_code: ${result.exitCode}`)
  }
  lines.push(`outcome: ${result.outcome}`)
  if (result.errorCode !== undefined) lines.push(`error_code: ${result.errorCode}`)
  if (result.testEvidence !== undefined) {
    lines.push(`test_evidence: ${result.testEvidence.status}`)
    if (result.testEvidence.status === 'verified') lines.push(`tests_executed: ${result.testEvidence.executedTests}`)
  }
  if (result.persistedOutputPath !== undefined) {
    lines.push(
      `persisted_output_path: ${result.persistedOutputPath}`,
      `persisted_output_size: ${result.persistedOutputSize ?? 0}`
    )
  }
  if (result.outputWarning !== undefined) lines.push(`output_warning: ${result.outputWarning}`)
  if (result.reason !== undefined && result.reason !== '') {
    lines.push('--- note ---', result.reason)
  } else if (result.outcome === 'running') {
    // 显式后台：回执说明如何查询进度与取消（design §4.4）。
    lines.push('--- note ---', '命令已在后台执行；可用任务 ID 查询进度或取消。')
  }
  const stdout = result.stdout.replace(/\n$/, '')
  const stderr = result.stderr.replace(/\n$/, '')
  const stdoutHeader = '\n--- stdout ---\n'
  const stderrHeader = '\n--- stderr ---\n'
  const metadata = lines.join('\n')
  // Reserve the receipt before previewing either stream, so Session never drops a
  // valid artifact link or changes a successful exit into a tool truncation error.
  const previewBudget = Math.max(0, TOOL_OUTPUT_CAP - metadata.length -
    (stdout ? stdoutHeader.length : 0) - (stderr ? stderrHeader.length : 0))
  const stdoutBudget = Math.min(stdout.length,
    Math.max(Math.floor(previewBudget / 2), previewBudget - stderr.length))
  if (stdout && stdoutBudget > 0) lines.push('--- stdout ---', fitOutputPreview(stdout, stdoutBudget))
  const stderrBudget = previewBudget - stdoutBudget
  if (stderr && stderrBudget > 0) lines.push('--- stderr ---', fitOutputPreview(stderr, stderrBudget))
  return lines.join('\n')
}

export function createExecTools(options: ExecToolsOptions): ToolHandler[] {
  const platform = options.platform ?? process.platform
  const currentCwd = options.getCwd ?? (() => options.defaultCwd)

  function makeHandler(name: ExecToolName): ToolHandler {
    const interpreter = options.sandboxInterpreter?.(name) ?? selectInterpreter(name, platform)
    const interpreterLabel = 'error' in interpreter ? name : interpreter.label

    function previewOf(args: Args, cwd: string) {
      const destructive = detectDestructiveCommand(args.command)
      const lines = [
        `命令：${args.command}`,
        `解释器：${interpreterLabel}`,
        `工作目录：${cwd}`,
        `超时：${args.timeoutMs ?? 120000}ms`,
        `执行方式：${args.runInBackground === true ? '后台' : '前台（超 15s 自动转后台）'}`,
        `隔离后端：${options.sandboxBackendId ?? '未启用（仅宿主托管操作）'}`
      ]
      if (args.description !== undefined && args.description !== '') {
        lines.push(`说明：${args.description}`)
      }
      if ('error' in interpreter) lines.push(`⚠ 解释器不可用：${interpreter.error}`)
      if (isInteractiveCommand(args.command)) {
        lines.push('⚠ 该命令需要交互式输入，本产品不提供 TTY，预期会失败')
      }
      if (isBlockingWaitCommand(args.command)) {
        lines.push('⚠ 该命令属于阻塞等待族，建议改用 run_in_background')
      }
      if (destructive.destructive) {
        lines.push(destructiveWarningText(destructive.reason ?? '该命令可能删除数据'))
      }
      return { preview: lines }
    }

    const readOnly = (args: Args) =>
      name === 'Bash' && args.runInBackground !== true && isReadOnlyCommand(args.command)

    async function runCommand(args: Args, cwd: string, context: ToolContext): Promise<string> {
      if (cwd !== currentCwd()) throw inputError('工作目录在审批期间发生变化，请重新申请执行')
      const guidance = gitGuidance(args.command)
      if (guidance !== undefined) throw inputError(guidance)
      if ('error' in interpreter) throw inputError(interpreter.error)
      const emitStarted: NonNullable<CommandRunContext['onStarted']> = ({ taskId, startedAt, readOnlyWorkspace }) => {
        context.emit?.({
          type: 'command_started',
          turnId: context.turnId ?? '',
          callId: context.callId ?? '',
          command: args.command,
          interpreter: interpreterLabel,
          cwd,
          ...(taskId !== undefined ? { taskId } : {}),
          ...(readOnlyWorkspace === true ? { readOnlyWorkspace } : {}),
          startedAt
        })
      }
      const result = await options.runner.run(
        {
          command: args.command,
          interpreter: name,
          ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
          ...(args.runInBackground !== undefined ? { runInBackground: args.runInBackground } : {})
        },
        {
          signal: context.signal,
          cwd,
          turnId: context.turnId,
          callId: context.callId,
          mode: readOnly(args) ? 'read_only' : 'workspace',
          onStarted: emitStarted
        }
      )
      // A running handoff binds the task ID. The background terminal event records the result.
      context.onCommandResult?.(args.command, result)
      return formatResult(result)
    }

    return {
      name,
      parameters: TOOL_PARAMETERS as unknown as Record<string, unknown>,
      summary:
        name === 'Bash'
          ? '在工作区执行 shell 命令（前台/后台）；用于运行测试、构建和只读探查。'
          : '在 Windows PowerShell 中执行命令（前台/后台）；用于 Windows 专属脚本。',
      describe(input: unknown): string {
        const args = (() => {
          try {
            return readArgs(input)
          } catch {
            return undefined
          }
        })()
        if (args === undefined) return `${name}（参数无法解析）`
        const label = args.description ?? args.command.split('\n')[0]
        return `${name}: ${label}`.slice(0, 120)
      },
      capability(input: unknown): ToolCapability {
        // 只有严格白名单内、可证明无副作用的命令才获得只读豁免（AC CE-09）。
        const args = (() => {
          try {
            return readArgs(input)
          } catch {
            return undefined
          }
        })()
        if (args === undefined) return 'execute'
        if (readOnly(args)) {
          return 'read'
        }
        return 'execute'
      },
      target() {
        return { kind: 'none' as const }
      },
      prepareApproval(input: unknown) {
        const args = readArgs(input)
        const cwd = currentCwd()
        return {
          ...previewOf(args, cwd),
          execute: (context: ToolContext) => runCommand(args, cwd, context)
        }
      },
      async execute(input: unknown, context: ToolContext): Promise<string> {
        return await runCommand(readArgs(input), currentCwd(), context)
      }
    }
  }

  return [makeHandler('Bash'), makeHandler('PowerShell')]
}

export function createBackgroundTaskTools(runner: CommandRunner): ToolHandler[] {
  const parameters = {
    type: 'object',
    properties: { task_id: { type: 'string' } },
    required: ['task_id'],
    additionalProperties: false
  }
  return (['TaskStatus', 'TaskCancel'] as const).map((name) => ({
    name,
    parameters,
    summary: name === 'TaskStatus' ? '查询本会话后台命令的状态与输出。' : '取消本会话仍在运行的后台命令。',
    describe: () => name,
    // Both operations address a session-owned handle and do not write to the workspace.
    capability: () => 'read',
    async execute(input: unknown) {
      const values = input as { task_id?: unknown } | null
      const id = values?.task_id
      if (typeof id !== 'string' || id.trim() === '' || Object.keys(values ?? {}).length !== 1) {
        throw inputError('需要提供本会话的后台 task_id')
      }
      const result = runner.status(id)
      if (result === undefined) throw inputError('本会话没有该后台任务')
      if (name === 'TaskStatus') return formatResult(result)
      return runner.cancel(id) ? '已请求取消后台任务。' : '后台任务已结束。'
    }
  }))
}
