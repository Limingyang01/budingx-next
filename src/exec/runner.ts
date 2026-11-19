// SP004 T3 · 前台命令执行器（design §4.1–§4.3）。
// core 只持有契约；真实进程由本模块注入。拒绝路径（缺隔离/交互式/阻塞/硬上限/预取消）零 spawn。
import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { ERROR_CODES } from '../core/constants.js'
import { isTestCommand } from '../core/coding.js'
import {
  EXEC_BLOCKING_BUDGET_MS,
  EXEC_OUTPUT_CAP,
  EXEC_PERSIST_THRESHOLD,
  resolveTimeoutConfig,
  type CommandResult,
  type CommandRunner,
  type CommandRunContext,
  type CommandSpec,
  type TestEvidence,
  type VerifiedTestEvidence
} from '../core/exec.js'
import { selectInterpreter } from './interpreter.js'
import { isBlockingWaitCommand, isInteractiveCommand } from './readonly-commands.js'
import { createSandboxPolicy, type SandboxPolicy } from './sandbox-policy.js'
import { OutputCollector, capMergedText, formatStream } from './output.js'
import { createBackgroundTable } from './background.js'
import { createOutputSpool, resolveTaskOutputPath, type CommandFinishedEvent } from './persist.js'
import { createTestSummaryParser } from './test-summary.js'

export interface CommandRunnerOptions {
  /** 缺省工作目录（会话项目根）。 */
  defaultCwd: string
  /** 宿主可覆盖白名单内的变量。 */
  env?: Record<string, string>
  /** 宿主额外批准的环境变量名。 */
  allowedEnv?: readonly string[]
  isWorkspacePathReadable?: (relativePath: string) => boolean
  /** 隔离门禁（T20）；缺省为无后端策略——普通命令一律拒绝。 */
  sandboxPolicy?: SandboxPolicy
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

const BASE_ENV = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ']

function allowedEnvironment(options: CommandRunnerOptions, spec: CommandSpec, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  const canonicalName = (name: string) => platform === 'win32' ? name.toUpperCase() : name
  const allowed = new Set([...BASE_ENV, ...(options.allowedEnv ?? [])].map(canonicalName))
  const env: NodeJS.ProcessEnv = Object.create(null)
  for (const source of [process.env, options.env ?? {}, spec.env ?? {}]) {
    for (const [name, value] of Object.entries(source)) {
      const key = canonicalName(name)
      if (allowed.has(key) && value !== undefined) env[key] = value
    }
  }
  return env
}

function insideDirectory(root: string, path: string): boolean {
  const delta = relative(root, path)
  return delta !== '..' && !delta.startsWith(`..${sep}`) && !isAbsolute(delta)
}

/** Test attestation permits a single direct invocation, without shell composition. */
function isDirectTestCommand(command: string): boolean {
  if (/[\r\n]/.test(command)) return false
  const [program, ...args] = command.trim().split(/[ \t]+/)
  const projectPath = (value: string) =>
    /^(?:\.\/)?[a-zA-Z0-9_@.-]+(?:\/[a-zA-Z0-9_@.-]+)*$/.test(value) &&
    !value.startsWith('-') && !value.replace(/^\.\//, '').split('/').some((part) => part === '.' || part === '..')
  if (program === 'node') return args[0] === '--test' && args.slice(1).every(projectPath)
  if (program === 'bash' || program === 'sh') {
    return args.length === 1 && projectPath(args[0]) &&
      /(?:^|\/)(?:tests?\.sh|test[-_.][a-zA-Z0-9_.-]+\.sh|[a-zA-Z0-9_.-]+[._-](?:test|spec)\.sh)$/.test(args[0])
  }
  if (program === 'npm' || program === 'pnpm') {
    return (args.length === 1 && args[0] === 'test') ||
      (args.length === 2 && args[0] === 'run' && /^test(?::[a-zA-Z0-9_-]+)*$/.test(args[1]))
  }
  if (program === 'cargo' || program === 'go' || program === 'make') {
    return args.length === 1 && args[0] === 'test'
  }
  if (program === 'pytest' || program === 'jest' || program === 'mocha') return args.every(projectPath)
  if (program === 'vitest') return args[0] === 'run' && args.slice(1).every(projectPath)
  return (program === 'python' || program === 'python3') && args[0] === '-m' &&
    args[1] === 'unittest' && args.slice(2).every(projectPath)
}

export function createCommandRunner(options: CommandRunnerOptions): CommandRunner {
  const sandboxPolicy = options.sandboxPolicy ?? createSandboxPolicy()
  const platform = options.platform ?? process.platform
  const timeouts = resolveTimeoutConfig(process.env)
  const persistThreshold = options.persistThreshold ?? EXEC_PERSIST_THRESHOLD
  const terminators = new WeakMap<ChildProcess, () => void>()
  const verifiedEvidence = new WeakMap<VerifiedTestEvidence, () => boolean>()
  const terminate = (child: ChildProcess) => terminators.get(child)?.()
  const background = createBackgroundTable({
    kill: terminate,
    onFinished: options.onCommandFinished
  })

  async function run(
    spec: CommandSpec,
    context: CommandRunContext
  ): Promise<CommandResult> {
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
      return early({ outcome: 'cancelled', interrupted: true, reason: '命令已取消', errorCode: ERROR_CODES.execCancelled })
    }
    if (spec.timeoutMs !== undefined && spec.timeoutMs > timeouts.hardMs) {
      return early({
        outcome: 'blocked',
        errorCode: ERROR_CODES.execHardTimeoutExceeded,
        reason: `超时请求 ${spec.timeoutMs}ms 超过硬上限（${timeouts.hardMs}ms），拒绝启动`
      })
    }
    if (isInteractiveCommand(spec.command)) {
      return early({
        outcome: 'failed',
        errorCode: ERROR_CODES.execInteractiveUnsupported,
        reason: '命令需要交互式输入，本产品不提供 TTY'
      })
    }
    if (isBlockingWaitCommand(spec.command) && !spec.runInBackground && options.allowBlocking !== true) {
      return early({
        outcome: 'blocked',
        errorCode: ERROR_CODES.execBlockingCommand,
        reason: '该命令属于阻塞等待族，前台执行会长时间占用回合；请改用 runInBackground 后台执行'
      })
    }
    const interpreterTool = spec.interpreter ?? 'Bash'
    const decision = sandboxPolicy.decide({ tool: interpreterTool, command: spec.command })
    if (decision.action === 'deny') {
      return early({ outcome: 'blocked', reason: decision.reason, errorCode: decision.code })
    }
    const backend = sandboxPolicy.backend()
    if (
      backend?.verified !== true ||
      backend.id !== decision.backendId ||
      typeof backend.start !== 'function' ||
      typeof backend.terminate !== 'function'
    ) {
      return early({ outcome: 'blocked', reason: '没有可启动进程的执行隔离后端', errorCode: ERROR_CODES.execSandboxUnavailable })
    }
    const interpreter = backend.resolveInterpreter?.(interpreterTool) ?? selectInterpreter(interpreterTool, platform)
    if ('error' in interpreter) {
      return early({ outcome: 'failed', reason: interpreter.error, errorCode: ERROR_CODES.execInterpreterUnavailable })
    }

    const timeoutMs = Math.min(spec.timeoutMs ?? timeouts.defaultMs, timeouts.maxMs)
    let cwd: string
    let root: string
    try {
      root = realpathSync(context.cwd || options.defaultCwd)
      cwd = realpathSync(spec.cwd ?? root)
      if (!insideDirectory(root, cwd) || !statSync(cwd).isDirectory()) throw new Error('invalid cwd')
    } catch {
      return early({ outcome: 'blocked', reason: '工作目录不在当前工作区内或不可访问', errorCode: ERROR_CODES.permissionDenied })
    }
    const denied = backend.capabilities.denyRead.some((path) => insideDirectory(path, cwd))
    const allowed = backend.capabilities.allowRead
    if (denied || (allowed.length > 0 && !allowed.some((path) => insideDirectory(path, cwd)))) {
      return early({ outcome: 'blocked', reason: '工作目录超出隔离后端允许读取的范围', errorCode: ERROR_CODES.permissionDenied })
    }
    const attestsHostInput = backend.testSnapshot !== undefined
    const verifyTestInput = attestsHostInput && isDirectTestCommand(spec.command)
    const mode = verifyTestInput ? 'read_only' : context.mode ?? 'workspace'
    let child: ChildProcess
    try {
      child = backend.start({
        executable: interpreter.shell,
        args: [...interpreter.args, spec.command],
        cwd,
        env: allowedEnvironment(options, spec, platform),
        mode,
        ...(verifyTestInput ? { verifyTestInput: true } : {}),
        ...(options.isWorkspacePathReadable ? {
          isWorkspacePathReadable: (path: string) =>
            options.isWorkspacePathReadable!(relative(root, resolve(cwd, path)).split(sep).join('/'))
        } : {})
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return early({ outcome: 'failed', reason: `隔离后端启动失败：${message}`, errorCode: ERROR_CODES.coreToolFailed })
    }
    const testSummary = verifyTestInput ? createTestSummaryParser(spec.command) : undefined
    const verifyResult = attestsHostInput && (verifyTestInput || isTestCommand(spec.command))
      ? (): TestEvidence => {
          try {
            if (!verifyTestInput) return { status: 'unavailable' }
            const snapshot = backend.testSnapshot?.(child)
            if (!snapshot) return { status: 'unavailable' }
            if (!snapshot.isCurrent()) return { status: 'stale' }
            const summary = testSummary?.result()
            if (!summary) return { status: 'no_tests' }
            const evidence: VerifiedTestEvidence = Object.freeze({
              status: 'verified', workspaceDigest: snapshot.digest, executedTests: summary.executed
            })
            verifiedEvidence.set(evidence, () => snapshot.isCurrent())
            return evidence
          } catch {
            return { status: 'unavailable' }
          }
        }
      : undefined
    terminators.set(child, () => backend.terminate(child))
    // stdin 立即关闭：交互式子进程因 EOF 退出，不无限挂起。
    if (backend.keepsSupervisorStdinOpen !== true) child.stdin?.end()

    const id = `task-${randomUUID()}`
    const outputPath = options.sessionId !== undefined
      ? resolveTaskOutputPath(options.sessionId, id, options.home)
      : undefined
    const spool = outputPath === undefined ? undefined : createOutputSpool(outputPath, (paused) => {
      for (const source of [child.stdout, child.stderr]) {
        if (!source || source.destroyed) continue
        if (paused) source.pause()
        else source.resume()
      }
    })
    const stdoutCollector = new OutputCollector(EXEC_OUTPUT_CAP)
    const stderrCollector = new OutputCollector(EXEC_OUTPUT_CAP)
    const capture = (channel: 'stdout' | 'stderr', collector: OutputCollector) => (chunk: Buffer) => {
      testSummary?.push(channel, chunk)
      collector.push(chunk)
      spool?.push(chunk)
    }
    const onStdout = capture('stdout', stdoutCollector)
    const onStderr = capture('stderr', stderrCollector)
    child.stdout?.on('data', onStdout)
    child.stderr?.on('data', onStderr)
    async function finishOutput(keep: boolean) {
      child.stdout?.off('data', onStdout)
      child.stderr?.off('data', onStderr)
      child.stdout?.destroy()
      child.stderr?.destroy()
      return await spool?.finish(keep)
    }
    const getOutputWarning = () => spool?.warning

    // 后台路径：同一启动门禁后立即返回 running + taskId，终态经 status/list 查询（design §4.4）。
    if (spec.runInBackground === true) {
      const taskId = background.register(
        {
          taskId: id,
          command: spec.command,
          interpreter: interpreter.label,
          cwd,
          timeoutMs,
          startedAt: started,
          turnId: context.turnId,
          callId: context.callId,
          finishOutput,
          getOutputWarning,
          verifyResult,
          autoBackgrounded: false,
          backgroundedByUser: true
        },
        child,
        stdoutCollector,
        stderrCollector,
        context.signal
      )
      // 命令已真正启动才通知宿主（拒绝路径零 spawn，也就不发 command_started）。
      context.onStarted?.({ taskId, startedAt: started, readOnlyWorkspace: mode === 'read_only' })
      const outputWarning = getOutputWarning()
      return early({
        outcome: 'running', taskId, backgroundedByUser: true,
        ...(outputWarning !== undefined ? { outputWarning } : {})
      })
    }

    // 前台命令已真正启动：通知宿主（拒绝路径零 spawn，不发 command_started）。
    context.onStarted?.({ startedAt: started, readOnlyWorkspace: mode === 'read_only' })

    return await new Promise<CommandResult>((resolve) => {
      let settled = false
      let forced: { outcome: 'timeout' | 'cancelled'; reason: string } | undefined
      const timer = setTimeout(() => {
        forced = { outcome: 'timeout', reason: `命令执行超过 ${timeoutMs}ms 超时限制，已终止进程树` }
        terminate(child)
      }, timeoutMs)
      const onAbort = () => {
        forced = { outcome: 'cancelled', reason: '命令已取消' }
        terminate(child)
      }
      if (context.signal.aborted) onAbort()
      else context.signal.addEventListener('abort', onAbort, { once: true })

      // T19：阻塞预算——前台命令超预算即移交后台任务表并立即返回，回合不被长时间阻塞（design §4.4）。
      // 复用同一子进程与收集器（register 不重复挂 data 监听）；超时/取消仍由后台表接管。
      const blockingBudgetMs = options.blockingBudgetMs ?? EXEC_BLOCKING_BUDGET_MS
      const budgetTimer = setTimeout(() => {
        if (settled || forced !== undefined) return
        settled = true
        clearTimeout(timer)
        context.signal.removeEventListener('abort', onAbort)
        const taskId = background.register(
          {
            taskId: id,
            command: spec.command,
            interpreter: interpreter.label,
            cwd,
            timeoutMs,
            startedAt: started,
            turnId: context.turnId,
            callId: context.callId,
            finishOutput,
            getOutputWarning,
            verifyResult,
            autoBackgrounded: true,
            backgroundedByUser: false
          },
          child,
          stdoutCollector,
          stderrCollector,
          context.signal
        )
        const outputWarning = getOutputWarning()
        resolve(
          early({
            outcome: 'running',
            taskId,
            autoBackgrounded: true,
            reason:
              `命令超过阻塞预算（${blockingBudgetMs}ms）已自动转入后台` +
              (spool !== undefined && outputWarning === undefined ? `，最终输出将写入：${outputPath}` : ''),
            ...(outputWarning !== undefined ? { outputWarning } : {})
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
        const retainedOutput = await finishOutput(mergedBytes > persistThreshold)
        const testEvidence = outcome === 'completed' ? verifyResult?.() : undefined
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
          errorCode: forced?.outcome === 'timeout'
            ? ERROR_CODES.execTimeout
            : forced?.outcome === 'cancelled' ? ERROR_CODES.execCancelled : undefined,
          persistedOutputPath: retainedOutput?.file?.path,
          persistedOutputSize: retainedOutput?.file?.size,
          ...(retainedOutput?.warning !== undefined ? { outputWarning: retainedOutput.warning } : {}),
          ...(testEvidence !== undefined ? { testEvidence } : {})
        })
      }
      child.on('error', async (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        clearTimeout(budgetTimer)
        context.signal.removeEventListener('abort', onAbort)
        await finishOutput(false)
        resolve(early({ outcome: 'failed', reason: `进程启动失败：${error.message}` }))
      })
      child.on('exit', () => {
        // 强制结束（超时/取消）时子进程退出即可收敛，不等待残留孙进程关闭管道。
        if (forced !== undefined && !settled) void finalize(undefined)
      })
      child.on('close', (code) => void finalize(code ?? undefined))
    })
  }

  return {
    run,
    status: (taskId) => background.status(taskId),
    cancel: (taskId) => background.cancel(taskId),
    list: () => background.list(),
    isTestEvidenceCurrent(evidence) {
      try {
        return verifiedEvidence.get(evidence)?.() === true
      } catch {
        return false
      }
    },
    dispose: () => background.dispose()
  }
}
