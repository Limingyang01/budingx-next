// SP004 T8 · worktree 进出（design §7.3，AC GW-05/GW-06/GW-07）。
// 只做纯 git 路径（hook 包装留 SP006）：git worktree add / list，不改主工作区。
// 失败必须保持原 cwd 不变且不留半成品；名称与路径都做越界校验。
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { dataRoot } from '../storage/paths.js'
import { readGitStatus } from './status.js'

export type WorktreeSession = {
  /** 隔离目录绝对路径。 */
  path: string
  /** 专用分支名。 */
  branch: string
  /** 创建时的基准分支。 */
  baseBranch: string
  /** 进入前的原工作目录（退出时回到这里）。 */
  originalCwd?: string
}

export type WorktreeEnterResult = Required<Pick<WorktreeSession, 'path' | 'branch' | 'baseBranch'>> &
  Pick<WorktreeSession, 'originalCwd'>

export type WorktreeExitResult = {
  cwd: string
  action: 'keep'
  path: string
}

export type EnterWorktreeInput = {
  cwd: string
  name: string
  /** worktree 根目录；缺省 ~/.budingx/worktrees。 */
  root?: string
  /** 数据根 home（测试注入）。 */
  home?: string
}

export type ExitWorktreeInput = WorktreeSession

/** 名称规则（F-18）：≤41 字符、小写字母/数字/连字符/下划线开头且整体合法。 */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-_]{0,40}$/

export function isValidWorktreeName(name: string): boolean {
  return NAME_PATTERN.test(name)
}

/** 仓库目录 slug：仅用于在 worktree 根下分目录，不参与分支命名。 */
export function repoSlug(repoPath: string): string {
  const raw = basename(repoPath).toLowerCase()
  const slug = raw.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  const safe = slug === '' ? 'repo' : slug
  return safe.slice(0, 64)
}

function flattenSlug(name: string): string {
  return name.split('/').filter((segment) => segment !== '').join('+')
}

function isInside(parent: string, child: string): boolean {
  const parentResolved = resolve(parent)
  const childResolved = resolve(child)
  const caseInsensitive = process.platform === 'win32'
  const left = caseInsensitive ? parentResolved.toLowerCase() : parentResolved
  const right = caseInsensitive ? childResolved.toLowerCase() : childResolved
  return right === left || right.startsWith(left + (process.platform === 'win32' ? '\\' : '/'))
}

type RunResult = { ok: boolean; stdout: string; stderr: string }

function runGit(args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    execFile(
      'git',
      ['--no-optional-locks', ...args],
      { cwd, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error === null) {
          resolvePromise({ ok: true, stdout, stderr })
          return
        }
        const code = (error as NodeJS.ErrnoException).code
        resolvePromise({
          ok: false,
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: code === 'ENOENT' ? 'git 不可用' : stderr
        })
      }
    )
  })
}

/** 统一分隔符大小写后比较路径（git 输出用 `/`，Windows 上路径可能用 `\\`）。 */
function comparablePath(path: string): string {
  const slashed = resolve(path).split('\\').join('/')
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed
}

/** 读取 `git worktree list --porcelain` 中某个真实路径对应的条目。 */
async function findWorktreeEntry(
  repoCwd: string,
  targetPath: string
): Promise<{ path: string; branch?: string } | undefined> {
  const list = await runGit(['worktree', 'list', '--porcelain'], repoCwd)
  if (!list.ok) return undefined
  const records = list.stdout.split('\n\n')
  const wanted = comparablePath(targetPath)
  for (const record of records) {
    const lines = record.split('\n').filter((line) => line !== '')
    const worktreeLine = lines.find((line) => line.startsWith('worktree '))
    if (worktreeLine === undefined) continue
    const entryPath = worktreeLine.slice('worktree '.length)
    if (comparablePath(entryPath) !== wanted) continue
    const branchLine = lines.find((line) => line.startsWith('branch '))
    return {
      path: entryPath,
      ...(branchLine !== undefined ? { branch: branchLine.slice('branch refs/heads/'.length) } : {})
    }
  }
  return undefined
}

async function branchExists(cwd: string, branch: string): Promise<boolean> {
  const result = await runGit(['branch', '--list', branch], cwd)
  return result.ok && result.stdout.trim() !== ''
}

/** 进入（或复用）一个隔离 worktree；失败时保持原 cwd、不留半成品。 */
export async function enterWorktree(input: EnterWorktreeInput): Promise<WorktreeEnterResult> {
  const { cwd, name } = input
  if (!isValidWorktreeName(name)) {
    throw new Error(`非法名称：${JSON.stringify(name)}；仅允许小写字母/数字/连字符/下划线，≤41 字符`)
  }
  const gitStatus = await readGitStatus(cwd)
  if (!gitStatus.gitAvailable) throw new Error('git 不可用，无法创建 worktree')
  if (!gitStatus.isRepository) throw new Error(`非 Git 仓库，无法创建 worktree：${cwd}`)
  const baseBranch = gitStatus.branch
  if (baseBranch === undefined) throw new Error('当前处于分离 HEAD，无法创建 worktree；请先切到分支')

  const root = input.root ?? join(dataRoot(input.home), 'worktrees')
  const targetPath = join(root, repoSlug(cwd), name)
  if (!isInside(root, targetPath)) {
    throw new Error(`目标路径越界：${targetPath} 不在 worktree 根目录内`)
  }

  // 已存在：只接受能核对身份的复用（真实路径 + 同仓库 + 专用分支）。
  if (existsSync(targetPath)) {
    const entry = await findWorktreeEntry(cwd, targetPath)
    if (entry !== undefined && entry.branch === `${baseBranch}-budingx/${flattenSlug(name)}`) {
      return { path: targetPath, branch: entry.branch, baseBranch, originalCwd: cwd }
    }
    throw new Error(`目标路径已存在且无法确认为本会话创建的 worktree：${targetPath}`)
  }

  const branch = `${baseBranch}-budingx/${flattenSlug(name)}`
  if (await branchExists(cwd, branch)) {
    throw new Error(`分支已存在：${branch}（名称冲突，请换一个名称）`)
  }

  mkdirSync(dirname(targetPath), { recursive: true })
  const added = await runGit(['worktree', 'add', targetPath, '-b', branch], cwd)
  if (!added.ok) {
    // 只清理本轮自己创建的路径，不触碰未知路径。
    if (existsSync(targetPath)) {
      try {
        rmSync(targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      } catch {
        // 清理失败时保留现场，错误信息里带上路径。
      }
    }
    throw new Error(`创建 worktree 失败：${added.stderr.trim() || added.stdout.trim()}`)
  }
  return { path: targetPath, branch, baseBranch, originalCwd: cwd }
}

/** 退出 worktree：默认 keep（保留目录与分支，不删除）。 */
export function exitWorktree(current: ExitWorktreeInput): WorktreeExitResult {
  const target = current.originalCwd ?? current.path
  return { cwd: target, action: 'keep', path: current.path }
}

/** 真实路径助手：用于宿主核对 worktree 身份（测试与 T23 复用）。 */
export function realPathOf(path: string): string | undefined {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}