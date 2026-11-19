// SP004 编码任务目标状态机契约与完成证据判定（设计 §5.2）。
// Core 只持有契约与纯逻辑；回合接线在 Session（T13）。
import type { CommandOutcome, CommandResult } from './exec.js'
import type { ToolHandler } from './tools.js'

export const TASK_PHASES = [
  'orienting',
  'editing',
  'testing',
  'fixing',
  'awaiting_user',
  'done',
  'failed'
] as const

export type TaskPhase = (typeof TASK_PHASES)[number]

/** 一次命令执行证据。 */
export type CommandEvidence = {
  command: string
  exitCode?: number
  errorCode?: string
  outcome: CommandOutcome
  at: number
}

type CommandEvidenceResult = Pick<CommandResult, 'outcome' | 'exitCode' | 'errorCode'>

export type CodingTaskState = {
  taskId: string
  goal: string
  phase: TaskPhase
  /** 用户是否明确否定/替换了当前目标（CT-04）。 */
  goalReplacedAt?: number
  /** 最近一次命令执行证据。 */
  lastTest?: CommandEvidence
  /** 最近一次成功的测试类命令证据（落实「至少一次测试成功」判定行）。 */
  testEvidence?: CommandEvidence
  /** 用户补充的要求（CT-03）：纳入当前目标，不替换 goal。 */
  supplements: string[]
  /** 迭代计数。 */
  iterations: number
}

export interface CodingTaskTracker {
  reset?(): void
  get(): CodingTaskState | undefined
  start(goal: string): CodingTaskState
  /** 用户补充：纳入当前目标，不替换。 */
  supplement(text: string): void
  /** 用户转向：替换目标（CT-04）。 */
  redirect(goal: string): void
  /** 文件工具写入、撤销或宿主切换工作区后，之前的命令不能证明当前内容。 */
  invalidateWorkspace(): void
  /** 将运行中的命令绑定到启动时的工作区版本，返回仅供会话跟踪的令牌。 */
  beginCommand(mayWrite: boolean): number
  /** 记录一次命令执行证据（命令文本 + 结果；Ruling T1：结果本身不含命令文本）。 */
  observeCommand(command: string, result: CommandEvidenceResult, token?: number): void
  /** 完成声明是否成立（CT-07）。 */
  canClaimDone(): { ok: boolean; reason?: string }
}

// 测试类命令启发式（设计 §5.2；在工具 summary 中说明为启发式判定）。
const TEST_COMMAND_PATTERN =
  /\b(?:test|spec|jest|vitest|mocha|pytest|unittest|tox)\b|(?:go|cargo)\s+test|npm\s+(?:run\s+)?(?:test|check)|pnpm\s+test|make\s+test/i

/** 命令文本是否属于测试类（启发式）。 */
export function isTestCommand(command: string): boolean {
  return TEST_COMMAND_PATTERN.test(command)
}

/** 完成声明判定表（设计 §5.2，纯函数）。 */
export function canClaimDone(state: CodingTaskState | undefined): { ok: boolean; reason?: string } {
  if (!state || !state.lastTest) {
    return { ok: false, reason: '未执行过任何命令，无法证明任务完成' }
  }
  const last = state.lastTest
  if (last.outcome !== 'completed') {
    return {
      ok: false,
      reason: `最近一次命令未成功（exit=${last.exitCode ?? '无'}），需继续修复`
    }
  }
  if (!state.testEvidence) {
    return { ok: false, reason: '未运行测试' }
  }
  return { ok: true }
}

export type CodingTaskTrackerOptions = {
  /** 时钟注入（测试用）。 */
  now?: () => number
  /** 任务 ID 生成（测试用）；缺省 task-<n>。 */
  taskId?: (sequence: number) => string
}

function requireText(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new Error(`${label}不能为空`)
  return text
}

/** 编码任务目标状态机（设计 §5.2）：目标、阶段与命令证据的单一事实源。 */
export function createCodingTaskTracker(options: CodingTaskTrackerOptions = {}): CodingTaskTracker {
  const now = options.now ?? Date.now
  let state: CodingTaskState | undefined
  let sequence = 0
  let generation = 0
  let commandSequence = 0
  let latestCommand = 0
  let latestPassingTest = 0
  const running = new Map<number, { generation: number; mayWrite: boolean; overlappingWriter: boolean }>()

  const requireTask = (): CodingTaskState => {
    if (!state) throw new Error('当前没有进行中的编码任务')
    return state
  }

  function invalidateWorkspace(): void {
    generation += 1
    if (!state) return
    state.lastTest = undefined
    state.testEvidence = undefined
    state.phase = 'editing'
  }

  function beginCommand(mayWrite: boolean): number {
    const overlappingWriter = [...running.values()].some((command) => command.mayWrite)
    // A workspace-capable command may change files outside the file-tool checkpoint.
    if (mayWrite) invalidateWorkspace()
    commandSequence += 1
    running.set(commandSequence, { generation, mayWrite, overlappingWriter })
    return commandSequence
  }

  return {
    get: () => state,
    reset() {
      invalidateWorkspace()
      state = undefined
    },
    start(goal) {
      const trimmed = requireText(goal, '编码任务目标')
      invalidateWorkspace()
      sequence += 1
      state = {
        taskId: options.taskId?.(sequence) ?? `task-${sequence}`,
        goal: trimmed,
        phase: 'orienting',
        supplements: [],
        iterations: 0
      }
      return state
    },
    supplement(text) {
      const task = requireTask()
      task.supplements.push(requireText(text, '补充内容'))
    },
    redirect(goal) {
      const task = requireTask()
      task.goal = requireText(goal, '新的编码任务目标')
      invalidateWorkspace()
      task.phase = 'orienting'
      task.goalReplacedAt = now()
    },
    invalidateWorkspace,
    beginCommand,
    observeCommand(command, result, token) {
      if (result.outcome === 'running') return
      const id = token ?? beginCommand(false)
      const started = running.get(id)
      running.delete(id)
      if (!state || started?.generation !== generation) return
      const evidence: CommandEvidence = {
        command,
        outcome: result.outcome,
        at: now(),
        ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
        ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {})
      }
      state.iterations += 1
      const tested = result.outcome === 'completed' && result.exitCode === 0 &&
        isTestCommand(command) && !started.overlappingWriter
      if (tested && id > latestPassingTest) {
        latestPassingTest = id
        state.testEvidence = evidence
      }
      // A slow older command cannot replace a newer command outcome.
      if (id <= latestCommand) return
      latestCommand = id
      state.lastTest = evidence
      if (tested) state.phase = 'testing'
      else if (result.outcome === 'completed' && state.phase === 'orienting') state.phase = 'editing'
      else if (
        result.outcome === 'failed' ||
        result.outcome === 'timeout' ||
        result.outcome === 'blocked'
      ) {
        state.phase = 'fixing'
      }
    },
    canClaimDone() {
      if (state && [...running.values()].some((command) => command.generation === generation || command.mayWrite)) {
        return { ok: false, reason: '仍有命令在运行，等待终态后再核对完成证据' }
      }
      return canClaimDone(state)
    }
  }
}

const REDIRECT_PARAMETERS = {
  type: 'object',
  properties: {
    goal: { type: 'string', description: '替换后的任务目标（旧目标不再驱动后续动作）' },
    reason: { type: 'string', description: '转向原因，仅用于说明' }
  },
  required: ['goal'],
  additionalProperties: false
} as const

/**
 * 用户转向（CT-04）：显式工具而非文本启发式，调用即替换目标并重置阶段。
 * 纯控制指令，不产生副作用，故能力归为 read 且不走审批通道。
 */
export function createTaskRedirectTool(tracker: CodingTaskTracker): ToolHandler {
  return {
    name: 'TaskRedirect',
    summary:
      'Replace the current coding task goal when the user explicitly changes direction (the old goal stops driving work)',
    parameters: REDIRECT_PARAMETERS as unknown as Record<string, unknown>,
    describe(input) {
      const goal = (input as { goal?: unknown } | null)?.goal
      return typeof goal === 'string' && goal.trim() ? `切换任务目标：${goal.trim()}` : '切换任务目标'
    },
    capability: () => 'read',
    target: () => ({ kind: 'none' as const }),
    async execute(input) {
      const goal = requireText((input as { goal?: unknown } | null)?.goal, '新的编码任务目标')
      const reason = (input as { reason?: unknown } | null)?.reason
      tracker.redirect(goal)
      return typeof reason === 'string' && reason.trim()
        ? `已切换任务目标：${goal}（原因：${reason.trim()}）`
        : `已切换任务目标：${goal}`
    }
  }
}
