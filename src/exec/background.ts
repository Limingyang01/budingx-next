// SP004 T4 · 后台任务表（design §4.4）。
// 内存任务表 + 状态快照 + 进程树取消；真实进程由 runner 注入，core 只持有契约。
import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import {
  EXEC_OUTPUT_CAP,
  type BackgroundTask,
  type CommandResult
} from '../core/exec.js'
import { OutputCollector, capMergedText, formatStream } from './output.js'

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
}

export interface BackgroundTableOptions {
  /** 终止整棵进程树（runner 注入，Windows taskkill /T /F + 兜底）。 */
  kill: (child: ChildProcess) => void
}

export interface BackgroundRegistration {
  command: string
  interpreter: string
  cwd: string
  timeoutMs: number
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
  const records = new Map<string, BackgroundRecord>()

  function snapshot(record: BackgroundRecord): CommandResult {
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
      autoBackgrounded: record.task.autoBackgrounded || undefined,
      backgroundedByUser: record.task.backgroundedByUser || undefined
    }
  }

  function force(record: BackgroundRecord, outcome: 'timeout' | 'cancelled', reason: string): void {
    if (record.settled || record.forced) return
    record.forced = { outcome, reason }
    options.kill(record.child)
  }

  function finalize(record: BackgroundRecord, exitCode: number | undefined, errorReason?: string): void {
    if (record.settled) return
    record.settled = true
    record.finishedAt = Date.now()
    clearTimeout(record.timer)
    record.signal.removeEventListener('abort', record.onAbort)
    const stdoutSnap = record.stdout.snapshot(EXEC_OUTPUT_CAP)
    const stderrSnap = record.stderr.snapshot(EXEC_OUTPUT_CAP)
    record.task.state = record.forced
      ? record.forced.outcome
      : errorReason !== undefined
        ? 'failed'
        : exitCode === 0
          ? 'completed'
          : 'failed'
    // 被信号终止/强制结束时不伪造退出码。
    record.task.exitCode = record.forced || errorReason !== undefined ? undefined : exitCode
    record.task.stdout = formatStream(stdoutSnap)
    record.task.stderr = formatStream(stderrSnap)
    record.task.truncated =
      stdoutSnap.truncated || stderrSnap.truncated || stdoutSnap.bytes + stderrSnap.bytes > EXEC_OUTPUT_CAP
    if (errorReason !== undefined) record.reason = errorReason
  }

  function register(
    meta: BackgroundRegistration,
    child: ChildProcess,
    stdout: OutputCollector,
    stderr: OutputCollector,
    signal: AbortSignal
  ): string {
    const taskId = `task-${randomUUID()}`
    const task: BackgroundTask = {
      taskId,
      command: meta.command,
      interpreter: meta.interpreter,
      cwd: meta.cwd,
      startedAt: Date.now(),
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
      onAbort: () => force(record, 'cancelled', '命令已取消'),
      timer: setTimeout(
        () => force(record, 'timeout', `命令执行超过 ${meta.timeoutMs}ms 超时限制，已终止进程树`),
        meta.timeoutMs
      ),
      settled: false
    }
    child.on('error', (error) => finalize(record, undefined, `进程启动失败：${error.message}`))
    child.on('close', (code) => finalize(record, code ?? undefined))
    if (signal.aborted) record.onAbort()
    else signal.addEventListener('abort', record.onAbort, { once: true })
    records.set(taskId, record)
    return taskId
  }

  function cancel(taskId: string): boolean {
    const record = records.get(taskId)
    if (!record || record.task.state !== 'running') return false
    force(record, 'cancelled', '命令已取消')
    return true
  }

  function dispose(): void {
    for (const record of records.values()) {
      if (record.task.state === 'running') force(record, 'cancelled', '会话已结束，后台任务被终止')
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