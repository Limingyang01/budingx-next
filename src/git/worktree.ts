// SP004 T8/T23 · worktree 进出（design §7.3，AC GW-05/GW-06/GW-07）。
// 只做纯 git 路径（hook 包装留 SP006）：git worktree add / list / remove，不改主工作区。
// 失败必须保持原 cwd 不变且不留半成品；名称与路径都做越界校验。
// 删除一律需要宿主单次授权，并先列出可确认的残留（未提交文件/未合并提交）。
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { dataRoot } from '../storage/paths.js'
import { gitEnvironment, readGitStatus } from './status.js'

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

const removalSnapshots = new WeakMap<WorktreeRemovalAuthorization, string>()

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
      {
        cwd,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: gitEnvironment()
      },
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
    const real = realPathOf(targetPath)
    if (real !== undefined && comparablePath(real) === comparablePath(targetPath) &&
        entry !== undefined && entry.branch === `${baseBranch}-budingx/${flattenSlug(name)}`) {
      return { path: targetPath, branch: entry.branch, baseBranch, originalCwd: cwd }
    }
    throw new Error(`目标路径已存在且无法确认为本会话创建的 worktree：${targetPath}`)
  }

  const branch = `${baseBranch}-budingx/${flattenSlug(name)}`
  if (await branchExists(cwd, branch)) {
    throw new Error(`分支已存在：${branch}（名称冲突，请换一个名称）`)
  }

  mkdirSync(dirname(targetPath), { recursive: true })
  if (comparablePath(realpathSync(dirname(targetPath))) !== comparablePath(dirname(targetPath))) {
    throw new Error(`目标 worktree 的父目录经过链接，拒绝创建：${targetPath}`)
  }
  const added = await runGit(['worktree', 'add', targetPath, '-b', branch], cwd)
  if (!added.ok) {
    throw new Error(`创建 worktree 失败：${added.stderr.trim() || added.stdout.trim()}；请检查路径 ${targetPath}`)
  }
  return { path: targetPath, branch, baseBranch, originalCwd: cwd }
}

async function removalSnapshot(current: WorktreeSession) {
  const repoCwd = current.originalCwd ?? current.path
  const real = realPathOf(current.path)
  const entry = await findWorktreeEntry(repoCwd, current.path)
  if (real === undefined || comparablePath(real) !== comparablePath(current.path) ||
      entry?.branch !== current.branch || !current.branch.startsWith(`${current.baseBranch}-budingx/`)) {
    throw new Error(`无法复核 worktree 身份，拒绝删除；可确认残留：路径 ${current.path}、分支 ${current.branch}`)
  }

  const head = await runGit(['rev-parse', '--verify', `refs/heads/${current.branch}`], repoCwd)
  const base = await runGit(['rev-parse', '--verify', `refs/heads/${current.baseBranch}`], repoCwd)
  const commonDir = await runGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], repoCwd)
  const status = await runGit(['status', '--porcelain=v1', '--untracked-files=all', '--no-renames', '-z'], real)
  const ignored = await runGit(['ls-files', '--others', '--ignored', '--exclude-standard', '-z'], real)
  const staged = await runGit(['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z'], real)
  if (![head, base, commonDir, status, ignored, staged].every((result) => result.ok)) {
    throw new Error(`无法复核 worktree 当前状态，拒绝删除；可确认残留：路径 ${current.path}、分支 ${current.branch}`)
  }
  const headId = head.stdout.trim()
  const baseId = base.stdout.trim()
  const counts = await runGit(['rev-list', '--count', `${baseId}..${headId}`], repoCwd)
  const discardedCommits = Number(counts.stdout.trim())
  if (!counts.ok || !Number.isSafeInteger(discardedCommits) || discardedCommits < 0) {
    throw new Error('无法复核未合并提交数量，拒绝删除')
  }
  const split = (text: string) => text.split('\0').filter(Boolean)
  const changedPaths = split(status.stdout).map((entry) => entry.slice(3))
  const ignoredPaths = split(ignored.stdout)
  const paths = [...new Set([...changedPaths, ...ignoredPaths])].sort()
  const fingerprint = createHash('sha256')
  fingerprint.update(JSON.stringify([
    comparablePath(real), commonDir.stdout.trim(), current.branch, current.baseBranch,
    headId, baseId, status.stdout, ignored.stdout, staged.stdout
  ]))
  for (const path of paths) {
    const rel = relative(real, resolve(real, path))
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error('无法复核 worktree 残留文件路径，拒绝删除')
    }
    const stat = lstatSync(join(real, path), { bigint: true, throwIfNoEntry: false })
    fingerprint.update(JSON.stringify([
      path, stat?.ino.toString(), stat?.size.toString(), stat?.mode.toString(),
      stat?.mtimeNs.toString(), stat?.ctimeNs.toString()
    ]))
  }
  return { fingerprint: fingerprint.digest('hex'), paths, ignoredPaths, discardedCommits, headId, repoCwd }
}

export async function prepareWorktreeRemoval(
  worktree: WorktreeSession,
  discardChanges: boolean
): Promise<{ authorization: WorktreeRemovalAuthorization; preview: readonly string[] }> {
  const snapshot = await removalSnapshot(worktree)
  if (!discardChanges && (snapshot.paths.length > 0 || snapshot.discardedCommits > 0)) {
    throw new Error(`worktree 存在可确认的残留：未提交文件 ${snapshot.paths.length} 个、未合并提交 ${snapshot.discardedCommits} 个；删除需要明确弃置意图`)
  }
  const authorization = Object.freeze({
    id: randomUUID(), worktree: worktree.path, branch: worktree.branch, discardChanges
  })
  removalSnapshots.set(authorization, snapshot.fingerprint)
  return {
    authorization,
    preview: [
      `删除工作树：${worktree.path}`,
      `删除分支：${worktree.branch}（${snapshot.headId}）`,
      `未提交文件 ${snapshot.paths.length} 个（含忽略文件 ${snapshot.ignoredPaths.length} 个）`,
      `未合并提交 ${snapshot.discardedCommits} 个`,
      ...snapshot.paths.map((path) => JSON.stringify(path))
    ]
  }
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
  if (comparablePath(authorization.worktree) !== comparablePath(current.path) || authorization.branch !== current.branch) {
    throw new Error(`授权与目标 worktree 不匹配，拒绝删除：授权 ${authorization.worktree}@${authorization.branch}`)
  }

  const fingerprint = removalSnapshots.get(authorization)
  if (fingerprint === undefined) throw new Error('缺少宿主签发的一次性删除授权，或授权已用完')
  removalSnapshots.delete(authorization)
  const snapshot = await removalSnapshot(current)
  if (snapshot.fingerprint !== fingerprint) throw new Error('删除审批后工作树残留或分支已漂移，请重新审批')
  const { discardedCommits, headId, repoCwd } = snapshot
  const discardedFiles = snapshot.paths.length
  const hasResidue = discardedFiles > 0 || discardedCommits > 0
  if (hasResidue && !(current.discard_changes === true && authorization.discardChanges === true)) {
    throw new Error(
      `worktree 存在可确认的残留：未提交文件 ${discardedFiles} 个、未合并提交 ${discardedCommits} 个；` +
        '删除需要 discard_changes=true 且宿主明确授权'
    )
  }

  const removed = await runGit([
    'worktree', 'remove', ...(discardedFiles > 0 ? ['--force'] : []), '--', current.path
  ], repoCwd)
  if (!removed.ok) {
    throw new Error(`删除 worktree 失败：${removed.stderr.trim() || removed.stdout.trim()}；可确认残留：路径 ${current.path}`)
  }
  const deleted = await runGit(['update-ref', '-d', `refs/heads/${current.branch}`, headId], repoCwd)
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
    return realpathSync(path)
  } catch {
    return undefined
  }
}
