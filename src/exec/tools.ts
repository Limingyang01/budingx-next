// SP004 T5 · Bash / PowerShell 工具适配器（design §4.5–§4.9）。
// 模型只提供 command/timeout/description/run_in_background；cwd、env、隔离和策略由宿主管有。
// 权限判定统一交给 SP003 策略：已校验只读命令归为 read（免审批），其余归为 execute。
import { ERROR_CODES } from '../core/constants.js'
import type { CommandResult, CommandRunner } from '../core/exec.js'
import type { ToolCapability } from '../core/permissions.js'
import type { ToolContext, ToolHandler } from '../core/tools.js'
import { destructiveWarningText, detectDestructiveCommand } from './destructive.js'
import { selectInterpreter } from './interpreter.js'
import { isBlockingWaitCommand, isInteractiveCommand, isReadOnlyCommand } from './readonly-commands.js'
import type { SandboxPolicy } from './sandbox-policy.js'

export type ExecToolName = 'Bash' | 'PowerShell'

export type ExecToolsOptions = {
  runner: CommandRunner
  /** 工作区根：命令的缺省工作目录（宿主管有，模型不可指定）。 */
  defaultCwd: string
  /** 平台注入（测试用）；缺省 process.platform。 */
  platform?: NodeJS.Platform
  /** 已验收的隔离后端标识，仅用于审批预览展示。 */
  sandboxBackendId?: string
  /** 与执行器共用的隔离策略，在审批前检查命令是否可启动。 */
  sandboxPolicy?: SandboxPolicy
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

function inputError(message: string, code: string = ERROR_CODES.coreToolFailed): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = code
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

function formatResult(result: CommandResult): string {
  const lines: string[] = []
  if (result.outcome === 'running') {
    lines.push('exit_code: <pending>')
    if (result.taskId !== undefined) lines.push(`background_task_id: ${result.taskId}`)
    lines.push(`auto_backgrounded: ${result.autoBackgrounded === true}`)
  } else if (result.exitCode !== undefined) {
    lines.push(`exit_code: ${result.exitCode}`)
  }
  if (result.stdout !== '') lines.push('--- stdout ---', result.stdout.replace(/\n$/, ''))
  if (result.stderr !== '') lines.push('--- stderr ---', result.stderr.replace(/\n$/, ''))
  if (result.persistedOutputPath !== undefined) {
    lines.push(
      `persisted_output_path: ${result.persistedOutputPath}`,
      `persisted_output_size: ${result.persistedOutputSize ?? 0}`
    )
  }
  if (result.reason !== undefined && result.reason !== '') {
    lines.push('--- note ---', result.reason)
  } else if (result.outcome === 'running') {
    // 显式后台：回执说明如何查询进度与取消（design §4.4）。
    lines.push('--- note ---', '命令已在后台执行；可用任务 ID 查询进度或取消。')
  }
  if (lines.length === 0) lines.push('exit_code: 0')
  return lines.join('\n')
}

export function createExecTools(options: ExecToolsOptions): ToolHandler[] {
  const platform = options.platform ?? process.platform

  function makeHandler(name: ExecToolName): ToolHandler {
    const interpreter = selectInterpreter(name, platform)
    const interpreterLabel = 'error' in interpreter ? name : interpreter.label

    function checkAvailability(args: Args): void {
      if ('error' in interpreter) {
        throw inputError(interpreter.error, ERROR_CODES.execInterpreterUnavailable)
      }
      const decision = options.sandboxPolicy?.decide({ tool: name, command: args.command })
      if (decision?.action === 'deny') {
        throw inputError(decision.reason, decision.code)
      }
    }

    function previewOf(args: Args) {
      const destructive = detectDestructiveCommand(args.command)
      const backendId = options.sandboxPolicy?.backend()?.id ?? options.sandboxBackendId
      const lines = [
        `命令：${args.command}`,
        `解释器：${interpreterLabel}`,
        `工作目录：${options.defaultCwd}`,
        `超时：${args.timeoutMs ?? 120000}ms`,
        `执行方式：${args.runInBackground === true ? '后台' : '前台（超 15s 自动转后台）'}`,
        backendId !== undefined
          ? `隔离后端：${backendId}`
          : '执行方式：宿主信任执行（无 OS 隔离，按权限档位审批）'
      ]
      if (args.description !== undefined && args.description !== '') {
        lines.push(`说明：${args.description}`)
      }
      if (isInteractiveCommand(args.command)) {
        lines.push('⚠ 该命令需要交互式输入，本产品不提供 TTY，预期会失败')
      }
      if (args.runInBackground !== true && isBlockingWaitCommand(args.command)) {
        lines.push('⚠ 该命令属于阻塞等待族，建议改用 run_in_background')
      }
      if (destructive.destructive) {
        lines.push(destructiveWarningText(destructive.reason ?? '该命令可能删除数据'))
      }
      return { preview: lines }
    }

    async function runCommand(args: Args, context: ToolContext): Promise<string> {
      // 0.5.4：Git 命令不再被「只读白名单」硬拦；是否执行由权限档位审批决定
      // （仅可查看拒绝、工作区内修改逐次确认、完全权限自动），与其它命令一致。
      checkAvailability(args)
      const startedAt = Date.now()
      const emitStarted = (taskId?: string) => {
        context.emit?.({
          type: 'command_started',
          turnId: context.turnId ?? '',
          callId: context.callId ?? '',
          command: args.command,
          interpreter: interpreterLabel,
          cwd: options.defaultCwd,
          ...(taskId !== undefined ? { taskId } : {}),
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
        { signal: context.signal, cwd: options.defaultCwd, onStarted: (info) => emitStarted(info.taskId) }
      )
      // 前台终态结果作为完成证据上报（SP004 T13，CT-07）；后台任务完成另由 command_finished 事件承载。
      if (result.outcome !== 'running') context.onCommandResult?.(args.command, result)
      return formatResult(result)
    }

    return {
      name,
      parameters: TOOL_PARAMETERS as unknown as Record<string, unknown>,
      summary: 'error' in interpreter
        ? interpreter.error
        : name === 'Bash'
          ? '在工作区运行 Bash 命令（前台/后台），按权限档位审批；配置隔离后端时在隔离中执行。'
          : '在 Windows 工作区运行 PowerShell 命令（前台/后台），按权限档位审批；配置隔离后端时在隔离中执行。',
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
        if (name === 'Bash' && args.runInBackground !== true && isReadOnlyCommand(args.command)) {
          return 'read'
        }
        return 'execute'
      },
      target() {
        return { kind: 'none' as const }
      },
      prepareApproval(input: unknown) {
        const args = readArgs(input)
        checkAvailability(args)
        return {
          ...previewOf(args),
          execute: (context: ToolContext) => runCommand(args, context)
        }
      },
      async execute(input: unknown, context: ToolContext): Promise<string> {
        return await runCommand(readArgs(input), context)
      }
    }
  }

  return [makeHandler('Bash'), makeHandler('PowerShell')]
}
