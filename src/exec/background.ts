// SP004 T4 · 后台任务表（design §4.4）。
// 内存任务表 + 状态快照 + 进程树取消；真实进程由 runner 注入，core 只持有契约。
import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { ERROR_CODES } from '../core/constants.js'
import {
  EXEC_OUTPUT_CAP,
  type BackgroundTask,
  type CommandResult,
  type TestEvidence
} from '../core/exec.js'
import { OutputCollector, capMergedText, formatStream } from './output.js'
import { buildCommandFinishedEvent, type PersistedOutput } from './persist.js'

interface BackgroundRecord {
  task: BackgroundTask
  child: ChildProcess
  stdout: OutputCollector
  stderr: OutputCollector
  signal: AbortSignal
  onAbort: () => void
  timer: NodeJS.Timeout
  settled: boolean
  finishedAt?: number
  forced?: { outcome: 'timeout' | 'cancelled'; reason: string }
  reason?: string
  callId?: string
  turnId?: string
  finishOutput?: (keep: boolean) => Promise<PersistedOutput | undefined>
  verifyResult?: () => TestEvidence
  testEvidence?: TestEvidence
  /** 终止重试计时器（T4 稳定性：首次终止未生效时重发，进程退出即清理）。 */
  killRetry?: NodeJS.Timeout
}

/** 终止重发间隔与总时限：Windows 高并发下 taskkill 可能未命中，需重试直到进程退出。 */
const KILL_RETRY_INTERVAL_MS = 1000
const KILL_RETRY_MAX_MS = 10000

export interface BackgroundTableOptions {
  /** 由启动该任务的隔离后端终止进程树。 */
  kill: (child: ChildProcess) => void
  /** 后台任务完成事件（T18；command_finished）。 */
  onFinished?: (event: ReturnType<typeof buildCommandFinishedEvent>) => void
}

export interface BackgroundRegistration {
  taskId?: string
  command: string
  interpreter: string
  cwd: string
  timeoutMs: number
  startedAt?: number
  callId?: string
  turnId?: string
  finishOutput?: (keep: boolean) => Promise<PersistedOutput | undefined>
  verifyResult?: () => TestEvidence
  autoBackgrounded: boolean
  backgroundedByUser: boolean
}

export interface BackgroundTable {
  register(
    meta: BackgroundRegistration,
    child: ChildProcess,
    stdout: OutputCollector,
    stderr: OutputCollector,
    signal: AbortSignal
  ): string
  status(taskId: string): CommandResult | undefined
  cancel(taskId: string): boolean
  list(): CommandResult[]
  /** 会话结束时终止全部运行中后台任务（Session.dispose 接线）。 */
  dispose(): void
}

export function createBackgroundTable(options: BackgroundTableOptions): BackgroundTable {
  const records = new Map<string, BackgroundRecord | CommandResult>()

  function snapshot(record: BackgroundRecord | CommandResult): CommandResult {
    if ('outcome' in record) return { ...record }
    const stdoutSnap = record.stdout.snapshot(EXEC_OUTPUT_CAP)
    const stderrSnap = record.stderr.snapshot(EXEC_OUTPUT_CAP)
    const mergedBytes = stdoutSnap.bytes + stderrSnap.bytes
    const endedAt = record.finishedAt ?? Date.now()
    return {
      outcome: record.task.state,
      exitCode: record.task.exitCode,
      stdout: formatStream(stdoutSnap),
      stderr: formatStream(stderrSnap),
      output: capMergedText(stdoutSnap.text + stderrSnap.text, mergedBytes, EXEC_OUTPUT_CAP),
      truncated: stdoutSnap.truncated || stderrSnap.truncated || mergedBytes > EXEC_OUTPUT_CAP,
      bytes: mergedBytes,
      durationMs: endedAt - record.task.startedAt,
      taskId: record.task.taskId,
      interrupted: record.forced !== undefined || undefined,
      reason: record.forced?.reason ?? record.reason,
      errorCode: record.forced?.outcome === 'timeout'
        ? ERROR_CODES.execTimeout
        : record.forced?.outcome === 'cancelled' ? ERROR_CODES.execCancelled : undefined,
      autoBackgrounded: record.task.autoBackgrounded || undefined,
      backgroundedByUser: record.task.backgroundedByUser || undefined,
      persistedOutputPath: record.task.outputPath,
      persistedOutputSize: record.task.outputSize,
      ...(record.testEvidence !== undefined ? { testEvidence: record.testEvidence } : {})
    }
  }

  function force(record: BackgroundRecord, outcome: 'timeout' | 'cancelled', reason: string): void {
    if (record.settled || record.forced) return
    record.forced = { outcome, reason }
    options.kill(record.child)
    if (record.settled) return
    // 首次终止可能未命中（Windows 高并发下 taskkill 偶发失败）：周期性重发，
    // 直到进程退出触发 finalize 或到达总时限；不改变已确定的终态语义。
    const deadline = Date.now() + KILL_RETRY_MAX_MS
    record.killRetry = setInterval(() => {
      if (record.settled || Date.now() > deadline) {
        clearInterval(record.killRetry)
        record.killRetry = undefined
        return
      }
      options.kill(record.child)
    }, KILL_RETRY_INTERVAL_MS)
    record.killRetry.unref()
  }

  async function finalize(record: BackgroundRecord, exitCode: number | undefined, errorReason?: string): Promise<void> {
    if (record.settled) return
    record.settled = true
    const finishedAt = Date.now()
    clearTimeout(record.timer)
    if (record.killRetry !== undefined) {
      clearInterval(record.killRetry)
      record.killRetry = undefined
    }
    record.signal.removeEventListener('abort', record.onAbort)
    const state = record.forced
      ? record.forced.outcome
      : errorReason !== undefined
        ? 'failed'
        : exitCode === 0
          ? 'completed'
          : 'failed'
    // 被信号终止/强制结束时不伪造退出码。
    const finalExitCode = record.forced || errorReason !== undefined ? undefined : exitCode
    const persisted = await record.finishOutput?.(true)
    // 终态字段原子发布：落盘完成前 status 仍报 running，避免读到缺输出路径的半终态。
    record.finishedAt = finishedAt
    record.task.state = state
    record.task.exitCode = finalExitCode
    record.task.outputPath = persisted?.path
    record.task.outputSize = persisted?.size
    if (errorReason !== undefined) record.reason = errorReason
    record.testEvidence = state === 'completed' ? record.verifyResult?.() : undefined
    // The table retains only the bounded terminal result, not the child or collectors.
    records.set(record.task.taskId, snapshot(record))
    options.onFinished?.(
      buildCommandFinishedEvent({
        taskId: record.task.taskId,
        callId: record.callId,
        turnId: record.turnId,
        outcome: state,
        exitCode: finalExitCode,
        outputPath: persisted?.path,
        finishedAt,
        ...(record.testEvidence !== undefined ? { testEvidence: record.testEvidence } : {})
      })
    )
  }

  function register(
    meta: BackgroundRegistration,
    child: ChildProcess,
    stdout: OutputCollector,
    stderr: OutputCollector,
    signal: AbortSignal
  ): string {
    const taskId = meta.taskId ?? `task-${randomUUID()}`
    const task: BackgroundTask = {
      taskId,
      command: meta.command,
      interpreter: meta.interpreter,
      cwd: meta.cwd,
      startedAt: meta.startedAt ?? Date.now(),
      state: 'running',
      stdout: '',
      stderr: '',
      truncated: false,
      autoBackgrounded: meta.autoBackgrounded,
      backgroundedByUser: meta.backgroundedByUser
    }
    const record: BackgroundRecord = {
      task,
      child,
      stdout,
      stderr,
      signal,
      callId: meta.callId,
      turnId: meta.turnId,
      finishOutput: meta.finishOutput,
      verifyResult: meta.verifyResult,
      onAbort: () => force(record, 'cancelled', '命令已取消'),
      timer: setTimeout(
        () => force(record, 'timeout', `命令执行超过 ${meta.timeoutMs}ms 超时限制，已终止进程树`),
        Math.max(0, meta.timeoutMs - (Date.now() - task.startedAt))
      ),
      settled: false
    }
    child.on('error', (error) => void finalize(record, undefined, `进程启动失败：${error.message}`))
    // 子进程已退出但孙进程可能仍持有 stdout/stderr 管道（taskkill 只命中直接子进程时）：
    // 取消/超时等强制路径以 exit 立即收敛终态，不等待管道关闭。
    child.on('exit', () => {
      if (record.forced !== undefined && !record.settled) void finalize(record, undefined)
    })
    child.on('close', (code) => void finalize(record, code ?? undefined))
    records.set(taskId, record)
    if (signal.aborted) record.onAbort()
    else signal.addEventListener('abort', record.onAbort, { once: true })
    return taskId
  }

  function cancel(taskId: string): boolean {
    const record = records.get(taskId)
    if (!record || 'outcome' in record || record.settled || record.forced) return false
    force(record, 'cancelled', '命令已取消')
    return true
  }

  function dispose(): void {
    for (const record of records.values()) {
      if (!('outcome' in record)) force(record, 'cancelled', '会话已结束，后台任务被终止')
    }
  }

  return {
    register,
    status: (taskId) => {
      const record = records.get(taskId)
      return record ? snapshot(record) : undefined
    },
    cancel,
    list: () => [...records.values()].map(snapshot),
    dispose
  }
}
