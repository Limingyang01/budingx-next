// SP004 T18 · 后台输出落盘与完成通知（design §4.4，CE-17）。
// 数据只写 ~/.budingx 会话隔离路径，不写用户项目目录。
import { createWriteStream, mkdirSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { dataRoot } from '../storage/paths.js'
import type { CommandOutcome, TestEvidence } from '../core/exec.js'

/** 会话隔离的任务输出绝对路径：~/.budingx/sessions/<sessionId>/tasks/<taskId>.out。 */
export function resolveTaskOutputPath(sessionId: string, taskId: string, home: string = homedir()): string {
  return join(dataRoot(home), 'sessions', sessionId, 'tasks', `${taskId}.out`)
}

/** 写入完整输出（自动创建目录），返回真实路径与字节数。 */
export async function persistOutput(path: string, content: string): Promise<{ path: string; size: number }> {
  await mkdir(dirname(path), { recursive: true })
  const buf = Buffer.from(content, 'utf8')
  await writeFile(path, buf)
  return { path, size: buf.length }
}

export type PersistedOutput = { path: string; size: number }

/** One spool for the entire process, including a foreground-to-background handoff. */
export function createOutputSpool(path: string, backpressure: (paused: boolean) => void) {
  const partial = `${path}.partial`
  let stream
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    stream = createWriteStream(partial, { flags: 'wx', mode: 0o600, highWaterMark: 64 * 1024 })
  } catch {
    return undefined
  }
  let ownsFile = false
  let failed = false
  let paused = false
  let closed = false
  const setPaused = (next: boolean) => {
    if (next === paused) return
    paused = next
    backpressure(next)
  }
  stream.on('open', () => { ownsFile = true })
  stream.on('drain', () => setPaused(false))
  stream.on('error', () => {
    failed = true
    setPaused(false)
  })
  const close = new Promise<void>((resolve) => stream.once('close', () => {
    closed = true
    setPaused(false)
    resolve()
  }))

  return {
    push(chunk: Buffer): void {
      if (!failed && !closed && !stream.writableEnded && !stream.write(chunk)) setPaused(true)
    },
    async finish(keep: boolean): Promise<PersistedOutput | undefined> {
      if (!stream.destroyed) stream.end()
      await close
      if (!ownsFile) return undefined
      if (keep && !failed) {
        try {
          await rename(partial, path)
          return { path, size: stream.bytesWritten }
        } catch {
          // Retention failed; keep the bounded live summary and discard this partial.
        }
      }
      await rm(partial, { force: true }).catch(() => {})
      return undefined
    }
  }
}

export interface CommandFinishedInput {
  taskId: string
  callId?: string
  turnId?: string
  outcome: CommandOutcome
  exitCode?: number
  outputPath?: string
  finishedAt: number
  testEvidence?: TestEvidence
}

/** command_finished 事件构造器。 */
export function buildCommandFinishedEvent(input: CommandFinishedInput): { type: 'command_finished' } & CommandFinishedInput {
  return { type: 'command_finished', ...input }
}

/** command_finished 事件形状（T18）。 */
export type CommandFinishedEvent = ReturnType<typeof buildCommandFinishedEvent>
