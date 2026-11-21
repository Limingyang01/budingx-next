// SP006 §6.3 /tasks：后台任务登记表（CMD-08）。
// 任务由宿主登记；命令只读取，不启动/终止任务，避免命令面获得额外副作用。
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { openSync, closeSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export type TaskRecord = {
  id: string
  title: string
  status: TaskStatus
  /** 进程退出码；running 或非进程任务为 undefined。 */
  exitCode?: number
  /** 输出日志的绝对路径；无日志时为 undefined。 */
  outputPath?: string
  startedAt: number
  endedAt?: number
  /** 任务类型，便于 /tasks 分组展示。 */
  kind?: string
}

export type TaskRegistry = {
  add(record: TaskRecord): TaskRecord
  update(id: string, patch: Partial<Omit<TaskRecord, 'id'>>): TaskRecord | undefined
  get(id: string): TaskRecord | undefined
  list(): TaskRecord[]
  clear(): void
}

export function createTaskRegistry(): TaskRegistry {
  const records = new Map<string, TaskRecord>()
  return {
    add(record) {
      records.set(record.id, { ...record })
      return records.get(record.id)!
    },
    update(id, patch) {
      const current = records.get(id)
      if (!current) return undefined
      const next = { ...current, ...patch }
      records.set(id, next)
      return next
    },
    get(id) {
      return records.get(id)
    },
    list() {
      return [...records.values()]
    },
    clear() {
      records.clear()
    }
  }
}

export type TrackCommandSpec = {
  title: string
  command: string
  args?: string[]
  cwd?: string
  /** 日志目录；缺省使用调用方提供的目录，未提供则不落盘。 */
  logDir?: string
  env?: NodeJS.ProcessEnv
}

/**
 * 把一个真实子进程登记为后台任务：stdout/stderr 写入 logDir 下的日志文件，
 * 进程结束时回填状态、退出码与结束时间。返回值可直接交给 /tasks 展示。
 */
export function trackCommandTask(
  registry: TaskRegistry,
  spec: TrackCommandSpec
): { record: TaskRecord; done: Promise<TaskRecord> } {
  const id = randomUUID()
  const startedAt = Date.now()
  let outputPath: string | undefined
  let fd: number | undefined
  if (spec.logDir) {
    mkdirSync(spec.logDir, { recursive: true })
    outputPath = join(spec.logDir, id + '.log')
    fd = openSync(outputPath, 'a')
  }
  const record: TaskRecord = {
    id,
    title: spec.title,
    kind: 'command',
    status: 'running',
    startedAt,
    ...(outputPath ? { outputPath } : {})
  }
  registry.add(record)
  const child = spawn(spec.command, spec.args ?? [], {
    cwd: spec.cwd,
    env: spec.env ?? process.env,
    stdio: ['ignore', fd ?? 'ignore', fd ?? 'ignore'],
    windowsHide: true
  })
  if (fd !== undefined) closeSync(fd)
  const done = new Promise<TaskRecord>((resolve) => {
    let settled = false
    const finish = (status: TaskStatus, exitCode?: number) => {
      if (settled) return
      settled = true
      const updated = registry.update(id, {
        status,
        ...(exitCode === undefined ? {} : { exitCode }),
        endedAt: Date.now()
      })!
      resolve(updated)
    }
    child.on('error', () => finish('failed'))
    child.on('close', (code, signal) => {
      if (signal) finish('cancelled')
      else finish(code === 0 ? 'completed' : 'failed', code ?? undefined)
    })
  })
  return { record, done }
}

/** /tasks 的渲染：状态、退出码、输出路径（CMD-08）。 */
export function formatTaskList(tasks: TaskRecord[], lang: 'zh' | 'en' = 'zh'): string {
  if (tasks.length === 0) {
    return lang === 'en'
      ? 'No background or unfinished tasks.'
      : '暂无后台或未完成任务。'
  }
  const label = (task: TaskRecord): string => {
    const status =
      task.status === 'running'
        ? lang === 'en' ? 'running' : '运行中'
        : task.status === 'completed'
          ? lang === 'en' ? 'completed' : '已完成'
          : task.status === 'cancelled'
            ? lang === 'en' ? 'cancelled' : '已取消'
            : lang === 'en' ? 'failed' : '失败'
    const exit = task.exitCode === undefined ? '' : `  exit=${task.exitCode}`
    const output = task.outputPath ? `\n    output: ${task.outputPath}` : ''
    return `[${idShort(task.id)}] ${task.title} · ${status}${exit}${output}`
  }
  const header = lang === 'en' ? `${tasks.length} task(s):` : `共 ${tasks.length} 个任务：`
  return [header, ...tasks.map(label)].join('\n')
}

function idShort(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}
