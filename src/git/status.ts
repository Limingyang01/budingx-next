// SP004 T6 · Git 只读状态识别（design §7.1，AC GW-01 / GW-08）。
// 只读取状态：不带 -c 改配置、不写索引；非 Git 目录与 git 不可用都明确报告，不伪造。
import { execFile } from 'node:child_process'
import { parsePorcelain, type ParsedPorcelain, type PorcelainEntry } from './porcelain.js'

export type GitStatus = {
  isRepository: boolean
  gitAvailable: boolean
  head?: string
  branch?: string
  /** 远端地址（已脱敏，绝不把凭据交给模型；T23）。 */
  remoteUrl?: string
  /** HEAD 是否已推送到远端（T23）。 */
  isHeadOnRemote?: boolean
  staged: string[]
  unstaged: string[]
  untracked: string[]
  conflicted: string[]
  /** 结构化条目（含索引/工作区状态码），用于判定操作类型（T7）。 */
  changes?: PorcelainEntry[]
  /** 仓库内 worktree 数量（T23）。 */
  worktreeCount?: number
  ahead?: number
  behind?: number
}

export type ReadGitStatusOptions = {
  /** 子进程环境（测试注入；生产过滤继承的 Git 控制变量）。 */
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

/** Git 子进程从指定 cwd 定位仓库与索引。 */
export function gitEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_'))
  )
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
      { cwd, env: env ?? gitEnvironment(), maxBuffer: 8 * 1024 * 1024, windowsHide: true },
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

/** 脱掉 URL 中的凭据：`https://user:token@host/repo` → `https://host/repo`（design §7.1）。 */
export function sanitizeRemoteUrl(url: string): string {
  const trimmed = url.trim()
  // scp 形式（git@host:org/repo.git）本身不含密码，用户名不敏感，保持原样。
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed)
  if (schemeMatch === null) return trimmed
  const rest = trimmed.slice(schemeMatch[0].length)
  const at = rest.lastIndexOf('@')
  const slash = rest.indexOf('/')
  if (at === -1) return trimmed
  // 只去掉 authority 段里的 userinfo，避免误伤路径里的 '@'。
  if (slash !== -1 && at > slash) return trimmed
  return `${schemeMatch[1]}://${rest.slice(at + 1)}`
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

  // 远端地址：origin 优先，其次第一个远端；返回值一律脱敏（design §7.1）。
  const originRun = await runGit(command, ['config', '--get', 'remote.origin.url'], cwd, options.env)
  let rawRemote: string | undefined
  if (originRun.ok && originRun.stdout.trim() !== '') {
    rawRemote = originRun.stdout.trim()
  } else {
    const remotesRun = await runGit(command, ['remote'], cwd, options.env)
    const first = remotesRun.ok ? remotesRun.stdout.split('\n').map((line) => line.trim()).find((line) => line !== '') : undefined
    if (first !== undefined) {
      const firstRun = await runGit(command, ['config', '--get', `remote.${first}.url`], cwd, options.env)
      if (firstRun.ok && firstRun.stdout.trim() !== '') rawRemote = firstRun.stdout.trim()
    }
  }
  if (rawRemote !== undefined) status.remoteUrl = sanitizeRemoteUrl(rawRemote)

  // HEAD 是否已在远端分支上（只读判定；无远端或读取失败则省略字段）。
  if (status.head !== undefined && rawRemote !== undefined) {
    const containsRun = await runGit(command, ['branch', '-r', '--contains', status.head], cwd, options.env)
    if (containsRun.ok) status.isHeadOnRemote = containsRun.stdout.trim() !== ''
  }

  // worktree 数量（含主工作区），失败则省略字段。
  const worktreeRun = await runGit(command, ['worktree', 'list', '--porcelain'], cwd, options.env)
  if (worktreeRun.ok) {
    status.worktreeCount = worktreeRun.stdout.split('\n').filter((line) => line.startsWith('worktree ')).length
  }
  return status
}
