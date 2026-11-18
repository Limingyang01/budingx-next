// SP004 T6 · Git 只读状态识别（design §7.1，AC GW-01 / GW-08）。
// 只读取状态：不带 -c 改配置、不写索引；非 Git 目录与 git 不可用都明确报告，不伪造。
import { execFile } from 'node:child_process'
import { parsePorcelain, type ParsedPorcelain, type PorcelainEntry } from './porcelain.js'

export type GitStatus = {
  isRepository: boolean
  gitAvailable: boolean
  head?: string
  branch?: string
  /** 远端地址（可能含 token，需脱敏；T23 接入）。 */
  remoteUrl?: string
  /** HEAD 是否已推送到远端（T23 接入）。 */
  isHeadOnRemote?: boolean
  staged: string[]
  unstaged: string[]
  untracked: string[]
  conflicted: string[]
  /** 结构化条目（含索引/工作区状态码），用于判定操作类型（T7）。 */
  changes?: PorcelainEntry[]
  /** 仓库内 worktree 数量（T23 接入）。 */
  worktreeCount?: number
  ahead?: number
  behind?: number
}

export type ReadGitStatusOptions = {
  /** 子进程环境（测试注入；缺省继承 process.env）。 */
  env?: Record<string, string | undefined>
  /** git 可执行文件（测试注入；缺省 `git`）。 */
  gitCommand?: string
}

type RunResult = {
  ok: boolean
  notFound: boolean
  stdout: string
  stderr: string
}

function runGit(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> | undefined
): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      // `--no-optional-locks`：不与检查点操作争抢索引锁（design §7.1 / F-17）。
      ['--no-optional-locks', ...args],
      { cwd, env: env ?? process.env, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ ok: true, notFound: false, stdout, stderr })
          return
        }
        const code = (error as NodeJS.ErrnoException).code
        resolve({
          ok: false,
          notFound: code === 'ENOENT',
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : ''
        })
      }
    )
  })
}

function emptyStatus(gitAvailable: boolean): GitStatus {
  return {
    isRepository: false,
    gitAvailable,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: []
  }
}

/** 读取某个工作目录的 Git 只读状态；任何失败都以字段表达，不抛异常。 */
export async function readGitStatus(cwd: string, options: ReadGitStatusOptions = {}): Promise<GitStatus> {
  const command = options.gitCommand ?? 'git'
  const statusRun = await runGit(
    command,
    ['status', '--porcelain=v1', '-z', '--branch'],
    cwd,
    options.env
  )
  if (statusRun.notFound) return emptyStatus(false)
  if (!statusRun.ok) {
    // 非 Git 目录、权限问题等都按「不是仓库」报告；git 本身可用。
    return emptyStatus(true)
  }

  const parsed: ParsedPorcelain = parsePorcelain(statusRun.stdout)
  const status: GitStatus = {
    isRepository: true,
    gitAvailable: true,
    staged: parsed.staged,
    unstaged: parsed.unstaged,
    untracked: parsed.untracked,
    conflicted: parsed.conflicted,
    changes: parsed.entries
  }
  if (parsed.branch !== undefined) {
    status.branch = parsed.branch.name
    if (parsed.branch.ahead !== undefined) status.ahead = parsed.branch.ahead
    if (parsed.branch.behind !== undefined) status.behind = parsed.branch.behind
  }

  // `--branch` 只给分支与 ahead/behind；HEAD 提交需单独读取（空仓库无 HEAD）。
  const headRun = await runGit(command, ['rev-parse', 'HEAD'], cwd, options.env)
  if (headRun.ok) {
    const head = headRun.stdout.trim()
    if (head !== '') status.head = head
  }
  return status
}