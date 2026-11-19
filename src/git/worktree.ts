// SP004 T8/T23 · worktree 进出（design §7.3，AC GW-05/GW-06/GW-07）。
// 只做纯 git 路径（hook 包装留 SP006）：git worktree add / list / remove，不改主工作区。
// 失败必须保持原 cwd 不变且不留半成品；名称与路径都做越界校验。
// 删除一律需要宿主单次授权，并先列出可确认的残留（未提交文件/未合并提交）。
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

export type WorktreeExitAction = 'keep' | 'remove'

/** 宿主单次删除授权：绑定具体 worktree 与专用分支，模型参数本身无授权效力。 */
export type WorktreeRemovalAuthorization = {
  id: string
  /** 被授权删除的 worktree 真实路径。 */
  worktree: string
  /** 被授权删除的专用分支。 */
  branch: string
  /** 是否允许丢弃未提交改动与未合并提交。 */
  discardChanges: boolean
}

export type WorktreeExitResult = {
  cwd: string
  action: WorktreeExitAction
  path: string
  /** action='remove' 时实际被丢弃的未提交文件数。 */
  discardedFiles?: number
  /** action='remove' 时实际被丢弃的未合并提交数。 */
  discardedCommits?: number
}

export type ExitWorktreeInput = WorktreeSession & {
  /** 默认 keep；remove 会删除 worktree 与专用分支。 */
  action?: WorktreeExitAction
  /** 模型表达的丢弃意图；必须与宿主授权同时成立（GW-06）。 */
  discard_changes?: boolean
  authorization?: WorktreeRemovalAuthorization
}

export type EnterWorktreeInput = {
  cwd: string
  name: string
  /** worktree 根目录；缺省 ~/.budingx/worktrees。 */
  root?: string
  /** 数据根 home（测试注入）。 */
  home?: string
}

/** 名称规则（F-18）：≤41 字符、小写字母/数字/连字符/下划线开头且整体合法。 */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-_]{0,40}$/

export function isValidWorktreeName(name: string): boolean {
  return NAME_PATTERN.test(name)
}

/** slug 段字符集（F-18）：字母、数字、点、下划线、连字符。 */
const SLUG_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/

/**
 * 校验工作区/计录路径 slug（F-18）：总长 ≤64，按 `/` 分段，每段非空且合法，
 * 禁止 `.`/`..` 段，避免路径穿越与空路径片段。
 */
export function validateWorktreeSlug(slug: string): { ok: boolean; reason?: string } {
  if (slug === '') return { ok: false, reason: 'slug 不能为空' }
  if (slug.length > 64) return { ok: false, reason: 'slug 超过 64 字符' }
  for (const segment of slug.split('/')) {
    if (segment === '') {
      return { ok: false, reason: 'slug 含空段：不能以 / 开头或结尾，也不能出现连续 //' }
    }
    if (segment === '.' || segment === '..') {
      return { ok: false, reason: `slug 不允许 ${segment} 段` }
    }
    if (!SLUG_SEGMENT_PATTERN.test(segment)) {
      return { ok: false, reason: `slug 段含非法字符：${segment}` }
    }
  }
  return { ok: true }
}

export function assertWorktreeSlug(slug: string): string {
  const result = validateWorktreeSlug(slug)
  if (!result.ok) throw new Error(`非法 slug：${JSON.stringify(slug)}；${result.reason}`)
  return slug
}

/** 仓库目录 slug：仅用于在 worktree 根下分目录，不参与分支命名。 */
export function repoSlug(repoPath: string): string {
  const raw = basename(repoPath).toLowerCase()
  const slug = raw.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  const safe = slug === '' ? 'repo' : slug
  return assertWorktreeSlug(safe)
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

/** 对现存目录比较真实路径，兼容 Windows 短路径与目录别名。 */
function comparablePath(path: string): string | undefined {
  const realPath = realPathOf(path)
  if (realPath === undefined) return undefined
  return process.platform === 'win32' ? realPath.toLowerCase() : realPath
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
  if (wanted === undefined) return undefined
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
    const rootReal = realPathOf(root)
    const targetReal = realPathOf(targetPath)
    if (rootReal === undefined || targetReal === undefined || !isInside(rootReal, targetReal)) {
      throw new Error(`目标路径越界或无法解析：${targetPath}`)
    }
    const entry = await findWorktreeEntry(cwd, targetPath)
    if (entry !== undefined && entry.branch === `${baseBranch}-budingx/${flattenSlug(name)}`) {
      return { path: targetReal, branch: entry.branch, baseBranch, originalCwd: cwd }
    }
    throw new Error(`目标路径已存在且无法确认为本会话创建的 worktree：${targetPath}`)
  }

  const branch = `${baseBranch}-budingx/${flattenSlug(name)}`
  if (await branchExists(cwd, branch)) {
    throw new Error(`分支已存在：${branch}（名称冲突，请换一个名称）`)
  }

  mkdirSync(dirname(targetPath), { recursive: true })
  const rootReal = realpathSync.native(root)
  const worktreePath = join(realpathSync.native(dirname(targetPath)), name)
  if (!isInside(rootReal, worktreePath)) {
    throw new Error('目标路径越界：worktree 的真实路径不在 worktree 根目录内')
  }
  const added = await runGit(['worktree', 'add', worktreePath, '-b', branch], cwd)
  if (!added.ok) {
    // 只清理本轮自己创建的路径，不触碰未知路径。
    if (existsSync(worktreePath)) {
      try {
        rmSync(worktreePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      } catch {
        // 清理失败时保留现场，错误信息里带上路径。
      }
    }
    throw new Error(`创建 worktree 失败：${added.stderr.trim() || added.stdout.trim()}`)
  }
  return { path: worktreePath, branch, baseBranch, originalCwd: cwd }
}

/** 统计 worktree 内未提交文件数（含暂存、未暂存、未跟踪；重命名按一条记录计）。 */
async function countPendingFiles(worktreePath: string): Promise<number> {
  const statusRun = await runGit(['status', '--porcelain=v1', '-z'], worktreePath)
  if (!statusRun.ok) {
    throw new Error(`无法复核未提交文件，拒绝删除：${worktreePath}；${statusRun.stderr.trim() || 'git status 失败'}`)
  }
  return statusRun.stdout.split('\0').filter((entry) => entry !== '').length
}

/** 统计专用分支相对基准分支的未合并提交数。 */
async function countUnmergedCommits(repoCwd: string, baseBranch: string, branch: string): Promise<number> {
  const countRun = await runGit(['rev-list', '--count', `refs/heads/${baseBranch}..refs/heads/${branch}`], repoCwd)
  if (!countRun.ok) {
    throw new Error(`无法复核未合并提交数量：${countRun.stderr.trim() || 'git rev-list 失败'}`)
  }
  const parsed = Number.parseInt(countRun.stdout.trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * 退出 worktree：默认 keep（保留目录与分支，不删除）。
 * remove 必须先通过宿主单次授权；存在残留（未提交文件/未合并提交）时还要
 * discard_changes 与授权里的 discardChanges 同时成立，否则拒绝并列出残留（GW-06）。
 */
export async function exitWorktree(current: ExitWorktreeInput): Promise<WorktreeExitResult> {
  const target = current.originalCwd ?? current.path
  const action = current.action ?? 'keep'
  if (action === 'keep') return { cwd: target, action: 'keep', path: current.path }

  const authorization = current.authorization
  if (authorization === undefined) {
    throw new Error('删除 worktree 需要宿主单次授权：缺少 authorization（未经授权不会删除任何文件）')
  }
  const repoCwd = current.originalCwd ?? current.path
  const entry = await findWorktreeEntry(repoCwd, current.path)
  if (entry === undefined || entry.branch !== current.branch) {
    throw new Error(
      `无法复核 worktree 身份，拒绝删除；可确认残留：路径 ${current.path}、分支 ${current.branch}`
    )
  }

  const authorizedPath = comparablePath(authorization.worktree)
  if (
    authorizedPath === undefined ||
    authorizedPath !== comparablePath(entry.path) ||
    authorization.branch !== current.branch
  ) {
    throw new Error(`授权与目标 worktree 不匹配，拒绝删除：授权 ${authorization.worktree}@${authorization.branch}`)
  }

  const discardedFiles = await countPendingFiles(entry.path)
  const discardedCommits = await countUnmergedCommits(repoCwd, current.baseBranch, current.branch)
  const hasResidue = discardedFiles > 0 || discardedCommits > 0
  if (hasResidue && !(current.discard_changes === true && authorization.discardChanges === true)) {
    throw new Error(
      `worktree 存在可确认的残留：未提交文件 ${discardedFiles} 个、未合并提交 ${discardedCommits} 个；` +
        '删除需要 discard_changes=true 且宿主明确授权'
    )
  }

  const removed = await runGit(['worktree', 'remove', '--force', entry.path], repoCwd)
  if (!removed.ok) {
    throw new Error(`删除 worktree 失败：${removed.stderr.trim() || removed.stdout.trim()}；可确认残留：路径 ${current.path}`)
  }
  const deleted = await runGit(['branch', '-D', current.branch], repoCwd)
  if (!deleted.ok) {
    throw new Error(`删除专用分支失败：${deleted.stderr.trim() || deleted.stdout.trim()}；可确认残留：分支 ${current.branch}`)
  }
  return {
    cwd: target,
    action: 'remove',
    path: current.path,
    discardedFiles,
    discardedCommits
  }
}

/** 真实路径助手：用于宿主核对 worktree 身份（测试与 T23 复用）。 */
export function realPathOf(path: string): string | undefined {
  try {
    return realpathSync.native(path)
  } catch {
    return undefined
  }
}