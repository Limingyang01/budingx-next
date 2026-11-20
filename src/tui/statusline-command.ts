import { spawn } from 'node:child_process'
import type { StatusLineInput } from './render/statusline.js'

export interface StatusLineCommand {
  command: string
  args?: string[]
  timeoutMs?: number
}

export type StatusLineCommandResult = { ok: true; text: string } | { ok: false; reason: string }

export interface RunStatusLineOptions {
  timeoutMs?: number
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Abort an in-flight run (a newer trigger superseded it). */
  signal?: AbortSignal
}

/** stdout 归一化：整体 trim → 按行 split → 每行 trim → 丢弃空行 → 换行 join。 */
export function normalizeStatusLineOutput(stdout: string): string {
  return stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

/** 执行状态栏外部命令：stdin 收 JSON，stdout 作为状态栏文本。失败静默（返回 ok:false）。 */
export function runStatusLineCommand(
  spec: StatusLineCommand,
  input: StatusLineInput,
  options: RunStatusLineOptions = {},
): Promise<StatusLineCommandResult> {
  const timeoutMs = Math.max(1, options.timeoutMs ?? spec.timeoutMs ?? 5000)
  return new Promise((resolve) => {
    let settled = false
    let child: ReturnType<typeof spawn> | undefined
    const finish = (result: StatusLineCommandResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }
    const onAbort = () => {
      try {
        child?.kill('SIGKILL')
      } catch {
        // ignore
      }
      finish({ ok: false, reason: 'aborted' })
    }
    try {
      child = spawn(spec.command, spec.args ?? [], {
        stdio: ['pipe', 'pipe', 'ignore'],
        cwd: options.cwd,
        env: options.env ?? process.env,
      })
    } catch (error) {
      resolve({ ok: false, reason: 'spawn:' + (error as Error).message })
      return
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
      finish({ ok: false, reason: 'timeout' })
    }, timeoutMs)

    let stdout = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.on('error', (error) => {
      finish({ ok: false, reason: 'spawn:' + error.message })
    })
    child.on('close', (code) => {
      if (code !== 0) {
        finish({ ok: false, reason: 'exit:' + String(code) })
        return
      }
      finish({ ok: true, text: normalizeStatusLineOutput(stdout) })
    })
    if (options.signal?.aborted) {
      onAbort()
      return
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      child.stdin?.end(JSON.stringify(input))
    } catch {
      finish({ ok: false, reason: 'stdin' })
    }
  })
}
