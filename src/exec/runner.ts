// SP004 T3 · 前台命令执行器（design §4.1–§4.3）。
// core 只持有契约；真实进程由本模块注入。拒绝路径（缺隔离/交互式/阻塞/硬上限/预取消）零 spawn。
import { spawn as nodeSpawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  EXEC_BLOCKING_BUDGET_MS,
  EXEC_OUTPUT_CAP,
  EXEC_PERSIST_THRESHOLD,
  resolveTimeoutConfig,
  type CommandResult,
  type CommandRunner,
  type CommandSpec
} from '../core/exec.js'
import { selectInterpreter } from './interpreter.js'
import { isBlockingWaitCommand, isInteractiveCommand } from './readonly-commands.js'
import { createSandboxPolicy, type SandboxPolicy } from './sandbox-policy.js'
import { OutputCollector, capMergedText, formatStream } from './output.js'
import { createBackgroundTable } from './background.js'
import { persistOutput, resolveTaskOutputPath, type CommandFinishedEvent } from './persist.js'

export interface CommandRunnerOptions {
  /** 缺省工作目录（会话项目根）。 */
  defaultCwd: string
  /** 宿主基线追加环境（与 process.env、spec.env 依次合并）。 */
  env?: Record<string, string>
  /** 隔离门禁（T20）；缺省为无后端策略——普通命令一律拒绝。 */
  sandboxPolicy?: SandboxPolicy
  /** 注入 spawn（测试计数/替换）；缺省真实 child_process.spawn。 */
  spawn?: typeof nodeSpawn
  /** 显式放行阻塞等待族（用于确需等待的测试）。 */
  allowBlocking?: boolean
  /** 平台注入（测试用）；缺省 process.platform。 */
  platform?: NodeJS.Platform
  /** 会话 ID（T18 输出落盘的会话隔离键）；缺省时不落盘。 */
  sessionId?: string
  /** 数据根 home 注入（测试用）；缺省 os.homedir()。 */
  home?: string
  /** 前台输出落盘阈值（字节）；缺省 EXEC_PERSIST_THRESHOLD（1MB）。 */
  persistThreshold?: number
  /** 前台阻塞预算（毫秒，T19）；超预算自动转后台。测试可注入缩短，生产默认 EXEC_BLOCKING_BUDGET_MS（15s）。 */
  blockingBudgetMs?: number
  /** 后台任务完成事件回调（T18 command_finished）。 */
  onCommandFinished?: (event: CommandFinishedEvent) => void
}

/** 终止整棵进程树：Windows taskkill /T /F，POSIX 进程组 SIGKILL；均带 child.kill 兜底。 */
function killTree(child: ChildProcess, spawnFn: typeof nodeSpawn, platform: NodeJS.Platform): void {
  if (child.pid === undefined) return
  const fallback = () => {
    try {
      child.kill('SIGKILL')
    } catch {
      // 已退出
    }
  }
  if (platform === 'win32') {
    // 必须先让 taskkill 完成进程树枚举与终止，再兜底杀直接子进程；
    // 若先 child.kill 杀死父进程，taskkill 将无法定位孤儿子进程。
    try {
      const killer = spawnFn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      killer.on('error', fallback)
      killer.on('close', fallback)
    } catch {
      fallback()
    }
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    fallback()
  }
}

export function createCommandRunner(options: CommandRunnerOptions): CommandRunner {
  const spawnFn = options.spawn ?? nodeSpawn
  const sandboxPolicy = options.sandboxPolicy ?? createSandboxPolicy()
  const platform = options.platform ?? process.platform
  const timeouts = resolveTimeoutConfig(process.env)
  const persistThreshold = options.persistThreshold ?? EXEC_PERSIST_THRESHOLD
  const background = createBackgroundTable({
    kill: (child) => killTree(child, spawnFn, platform),
    persist: options.sessionId !== undefined ? { sessionId: options.sessionId, home: options.home } : undefined,
    onFinished: options.onCommandFinished
  })

  async function run(spec: CommandSpec, context: { signal: AbortSignal; cwd: string }): Promise<CommandResult> {
    const started = Date.now()
    const base = (): CommandResult => ({
      outcome: 'failed',
      stdout: '',
      stderr: '',
      output: '',
      truncated: false,
      bytes: 0,
      durationMs: Date.now() - started
    })
    const early = (partial: Partial<CommandResult>): CommandResult => ({ ...base(), ...partial })

    // 拒绝路径全部在 spawn 之前（零 spawn）。
    if (context.signal.aborted) {
      return early({ outcome: 'cancelled', interrupted: true, reason: '命令已取消' })
    }
    if (spec.timeoutMs !== undefined && spec.timeoutMs > timeouts.hardMs) {
      return early({
        outcome: 'blocked',
        reason: `超时请求 ${spec.timeoutMs}ms 超过硬上限（${timeouts.hardMs}ms），拒绝启动`
      })
    }
    if (isInteractiveCommand(spec.command)) {
      return early({ outcome: 'failed', reason: '命令需要交互式输入，本产品不提供 TTY' })
    }
    if (isBlockingWaitCommand(spec.command) && options.allowBlocking !== true) {
      return early({
        outcome: 'blocked',
        reason: '该命令属于阻塞等待族，前台执行会长时间占用回合；请改用 runInBackground 后台执行'
      })
    }
    const decision = sandboxPolicy.decide({ tool: 'Bash', command: spec.command })
    if (decision.action === 'deny') {
      return early({ outcome: 'blocked', reason: decision.reason })
    }
    const interpreter = selectInterpreter('Bash', platform)
    if ('error' in interpreter) {
      return early({ outcome: 'failed', reason: interpreter.error })
    }

    const timeoutMs = Math.min(spec.timeoutMs ?? timeouts.defaultMs, timeouts.maxMs)
    const cwd = spec.cwd ?? context.cwd ?? options.defaultCwd
    const child = spawnFn(interpreter.shell, [...interpreter.args, spec.command], {
      cwd,
      env: { ...process.env, ...options.env, ...spec.env },
      shell: false,
      windowsHide: true,
      detached: platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe']
    })
    // stdin 立即关闭：交互式子进程因 EOF 退出，不无限挂起。
    child.stdin?.end()

    // full 模式保留完整输出块，供落盘使用（快照仍按上限截断）。
    const stdoutCollector = new OutputCollector(EXEC_OUTPUT_CAP, true)
    const stderrCollector = new OutputCollector(EXEC_OUTPUT_CAP, true)
    child.stdout?.on('data', (chunk: Buffer) => stdoutCollector.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderrCollector.push(chunk))

    // 后台路径：同一启动门禁后立即返回 running + taskId，终态经 status/list 查询（design §4.4）。
    if (spec.runInBackground === true) {
      const taskId = background.register(
        {
          command: spec.command,
          interpreter: interpreter.label,
          cwd,
          timeoutMs,
          autoBackgrounded: false,
          backgroundedByUser: true
        },
        child,
        stdoutCollector,
        stderrCollector,
        context.signal
      )
      return early({ outcome: 'running', taskId, backgroundedByUser: true })
    }

    return await new Promise<CommandResult>((resolve) => {
      let settled = false
      let forced: { outcome: 'timeout' | 'cancelled'; reason: string } | undefined
      const timer = setTimeout(() => {
        forced = { outcome: 'timeout', reason: `命令执行超过 ${timeoutMs}ms 超时限制，已终止进程树` }
        killTree(child, spawnFn, platform)
      }, timeoutMs)
      const onAbort = () => {
        forced = { outcome: 'cancelled', reason: '命令已取消' }
        killTree(child, spawnFn, platform)
      }
      if (context.signal.aborted) onAbort()
      else context.signal.addEventListener('abort', onAbort, { once: true })

      // T19：阻塞预算——前台命令超预算即移交后台任务表并立即返回，回合不被长时间阻塞（design §4.4）。
      // 复用同一子进程与收集器（register 不重复挂 data 监听）；超时/取消仍由后台表接管。
      const blockingBudgetMs = options.blockingBudgetMs ?? EXEC_BLOCKING_BUDGET_MS
      const budgetTimer = setTimeout(() => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        context.signal.removeEventListener('abort', onAbort)
        const taskId = background.register(
          {
            command: spec.command,
            interpreter: interpreter.label,
            cwd,
            timeoutMs,
            autoBackgrounded: true,
            backgroundedByUser: false
          },
          child,
          stdoutCollector,
          stderrCollector,
          context.signal
        )
        const outputPath =
          options.sessionId !== undefined
            ? resolveTaskOutputPath(options.sessionId, taskId, options.home)
            : undefined
        resolve(
          early({
            outcome: 'running',
            taskId,
            autoBackgrounded: true,
            reason:
              `命令超过阻塞预算（${blockingBudgetMs}ms）已自动转入后台` +
              (outputPath !== undefined ? `，输出将写入：${outputPath}` : '')
          })
        )
      }, blockingBudgetMs)

      const finalize = async (exitCode: number | undefined) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        clearTimeout(budgetTimer)
        context.signal.removeEventListener('abort', onAbort)
        const stdoutSnap = stdoutCollector.snapshot(EXEC_OUTPUT_CAP)
        const stderrSnap = stderrCollector.snapshot(EXEC_OUTPUT_CAP)
        const stdout = formatStream(stdoutSnap)
        const stderr = formatStream(stderrSnap)
        const mergedBytes = stdoutSnap.bytes + stderrSnap.bytes
        const output = capMergedText(stdoutSnap.text + stderrSnap.text, mergedBytes, EXEC_OUTPUT_CAP)
        const truncated = stdoutSnap.truncated || stderrSnap.truncated || mergedBytes > EXEC_OUTPUT_CAP
        const outcome = forced ? forced.outcome : exitCode === 0 ? 'completed' : 'failed'
        // T18：超大前台输出落盘到会话隔离路径（best-effort，不影响命令结果）。
        let persistedOutputPath: string | undefined
        let persistedOutputSize: number | undefined
        if (options.sessionId !== undefined && mergedBytes > persistThreshold) {
          try {
            const content = Buffer.concat([stdoutCollector.fullContent(), stderrCollector.fullContent()]).toString('utf8')
            const path = resolveTaskOutputPath(options.sessionId, `task-${randomUUID()}`, options.home)
            const persisted = await persistOutput(path, content)
            persistedOutputPath = persisted.path
            persistedOutputSize = persisted.size
          } catch {
            // 落盘失败不改变命令终态。
          }
        }
        resolve({
          outcome,
          // 被信号终止/强制结束时不伪造退出码。
          exitCode: forced ? undefined : exitCode,
          stdout,
          stderr,
          output,
          truncated,
          bytes: mergedBytes,
          durationMs: Date.now() - started,
          interrupted: forced !== undefined || undefined,
          reason: forced?.reason,
          persistedOutputPath,
          persistedOutputSize
        })
      }
      child.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        clearTimeout(budgetTimer)
        context.signal.removeEventListener('abort', onAbort)
        resolve(early({ outcome: 'failed', reason: `进程启动失败：${error.message}` }))
      })
      child.on('close', (code) => void finalize(code ?? undefined))
    })
  }

  return {
    run,
    status: (taskId) => background.status(taskId),
    cancel: (taskId) => background.cancel(taskId),
    list: () => background.list(),
    dispose: () => background.dispose()
  }
}