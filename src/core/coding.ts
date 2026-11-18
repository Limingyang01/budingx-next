// SP004 编码任务目标状态机契约与完成证据判定（设计 §5.2）。
// Core 只持有契约与纯逻辑；回合接线在 Session（T13）。
import type { CommandOutcome, CommandResult } from './exec.js'

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
  outcome: CommandOutcome
  at: number
}

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
  /** 迭代计数。 */
  iterations: number
}

export interface CodingTaskTracker {
  get(): CodingTaskState | undefined
  start(goal: string): CodingTaskState
  /** 用户补充：纳入当前目标，不替换。 */
  supplement(text: string): void
  /** 用户转向：替换目标（CT-04）。 */
  redirect(goal: string): void
  /** 记录一次命令执行证据（命令文本 + 结果；Ruling T1：结果本身不含命令文本）。 */
  observeCommand(command: string, result: CommandResult): void
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