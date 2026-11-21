import { spawn } from 'node:child_process'
import type { HookRunResult, SessionHookEvent } from '../../core/hooks.js'
import type {
  HookConfig,
  HookExecution,
  HookHandler,
  HookMatcher,
  HookResponse
} from './types.js'

export interface HookRunnerOptions {
  cwd?: string
  homeDir?: string
  /** 处理器未配置 timeout 时的默认超时（毫秒），默认 30s。 */
  defaultTimeoutMs?: number
  env?: NodeJS.ProcessEnv
}

export interface HookRunner {
  run(event: SessionHookEvent, input: Record<string, unknown>): Promise<HookRunResult>
  /** 该事件是否有启用的处理器（宿主可据此跳过输入构造）。 */
  has(event: SessionHookEvent): boolean
  /** 已执行记录（事件名、类型、耗时、退出码），用于诊断与测试。 */
  executions(): HookExecution[]
}

const PASS: HookRunResult = { blocked: false }

function matches(matcher: string | undefined, value: string): boolean {
  if (!matcher || matcher === '*') return true
  try {
    return new RegExp(matcher).test(value)
  } catch {
    return value === matcher || value.includes(matcher)
  }
}

function matcherValue(input: Record<string, unknown>): string {
  const candidate =
    input.tool_name ?? input.source ?? input.notification_type ?? input.message ?? ''
  return typeof candidate === 'string' ? candidate : String(candidate)
}

interface CommandOutcome {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

function runCommand(
  command: string,
  event: SessionHookEvent,
  input: Record<string, unknown>,
  timeoutMs: number,
  options: HookRunnerOptions
): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, {
        shell: true,
        cwd: options.cwd,
        windowsHide: true,
        env: {
          ...process.env,
          ...options.env,
          BUDINGX_HOOK_EVENT: event,
          ...(options.cwd ? { BUDINGX_PROJECT_DIR: options.cwd } : {})
        },
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (error) {
      resolve({
        code: null,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        timedOut: false
      })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (outcome: CommandOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(outcome)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* already exited */
      }
      finish({ code: null, stdout, stderr, timedOut: true })
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      finish({ code: null, stdout, stderr: stderr || error.message, timedOut: false })
    })
    child.on('close', (code) => {
      finish({ code, stdout, stderr, timedOut: false })
    })
    try {
      child.stdin.end(JSON.stringify(input))
    } catch {
      /* 子进程可能已退出 */
    }
  })
}

function parseResponse(stdout: string): HookResponse | undefined {
  const text = stdout.trim()
  if (!text.startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as HookResponse) : undefined
  } catch {
    return undefined
  }
}

export function createHookRunner(
  config: HookConfig,
  options: HookRunnerOptions = {}
): HookRunner {
  const executions: HookExecution[] = []
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000

  function matchersFor(event: SessionHookEvent): HookMatcher[] {
    const entry = config[event]
    return Array.isArray(entry) ? entry : []
  }

  return {
    has(event: SessionHookEvent): boolean {
      return matchersFor(event).length > 0
    },

    async run(event: SessionHookEvent, input: Record<string, unknown>): Promise<HookRunResult> {
    const matchers = matchersFor(event)
    if (matchers.length === 0) return { ...PASS }
    const payload: Record<string, unknown> = {
      ...input,
      hook_event_name: event,
      ...(options.cwd ? { cwd: input.cwd ?? options.cwd } : {})
    }
    const value = matcherValue(payload)
    const systemMessages: string[] = []
    const additionalContext: string[] = []
    const warnings: string[] = []
    let blocked = false
    let reason: string | undefined
    let suppressOutput = false
    let permissionDecision: 'allow' | 'deny' | 'ask' | undefined
    let permissionDecisionReason: string | undefined
    let updatedInput: Record<string, unknown> | undefined

    const applyPermission = (next: 'allow' | 'deny' | 'ask' | undefined) => {
      if (!next) return
      // deny 最优先，其次 ask，allow 只在没有更强约束时生效。
      if (permissionDecision === 'deny') return
      if (next === 'deny' || permissionDecision !== 'ask') permissionDecision = next
    }

    for (const matcher of matchers) {
      if (!matches(matcher.matcher, value)) continue
      for (const handler of matcher.hooks) {
        const startedAt = Date.now()
        try {
          if (handler.type === 'prompt') {
            executions.push({
              event,
              handler: 'prompt',
              durationMs: Date.now() - startedAt
            })
            if (handler.prompt.trim()) additionalContext.push(handler.prompt.trim())
            continue
          }
          const timeoutMs =
            handler.timeout && handler.timeout > 0 ? handler.timeout * 1000 : defaultTimeoutMs
          const outcome = await runCommand(handler.command, event, payload, timeoutMs, options)
          const response = parseResponse(outcome.stdout)
          executions.push({
            event,
            handler: 'command',
            durationMs: Date.now() - startedAt,
            exitCode: outcome.code,
            ...(outcome.code === 2 ? { blocked: true } : {})
          })
          if (outcome.timedOut) {
            warnings.push('hook 超时，已跳过：' + event)
            continue
          }
          if (outcome.code === 2) {
            blocked = true
            reason =
              outcome.stderr.trim() ||
              outcome.stdout.trim() ||
              'hook 以退出码 2 结束'
            continue
          }
          if (outcome.code !== 0) {
            warnings.push(
              'hook 执行失败（退出码 ' + String(outcome.code) + '），已跳过：' + event
            )
            continue
          }
          if (response) {
            if (response.suppressOutput) suppressOutput = true
            if (response.continue === false || response.decision === 'block') {
              blocked = true
              reason = response.stopReason ?? response.reason ?? 'hook 要求阻断'
            }
            applyPermission(response.hookSpecificOutput?.permissionDecision)
            if (response.hookSpecificOutput?.permissionDecisionReason) {
              permissionDecisionReason = response.hookSpecificOutput.permissionDecisionReason
            }
            if (response.hookSpecificOutput?.updatedInput !== undefined) {
              updatedInput = response.hookSpecificOutput.updatedInput as Record<string, unknown>
            }
            const context = response.hookSpecificOutput?.additionalContext
            if (typeof context === 'string' && context.trim()) additionalContext.push(context.trim())
            if (typeof response.systemMessage === 'string' && response.systemMessage.trim()) {
              systemMessages.push(response.systemMessage.trim())
            }
            if (typeof response.reason === 'string' && response.reason.trim() && response.decision === 'block') {
              reason = response.reason.trim()
            }
            continue
          }
          const text = outcome.stdout.trim()
          if (text) systemMessages.push(text)
        } catch (error) {
          warnings.push(
            'hook 执行异常，已跳过：' + event + '（' +
              (error instanceof Error ? error.message : String(error)) + '）'
          )
        }
      }
    }

    return {
      blocked,
      ...(reason ? { reason } : {}),
      ...(suppressOutput ? { suppressOutput: true } : {}),
      ...(suppressOutput ? {} : { systemMessages, warnings }),
      ...(additionalContext.length > 0 ? { additionalContext } : {}),
      ...(permissionDecision ? { permissionDecision } : {}),
      ...(permissionDecisionReason ? { permissionDecisionReason } : {}),
      ...(updatedInput !== undefined ? { updatedInput } : {})
    }
  },

    executions: () => [...executions]
  }
}
