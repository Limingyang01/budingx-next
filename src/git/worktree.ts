// SP004 T8/T23 · worktree 进出；SP009 #39 · 宿主确认后的本地合并。
// 失败必须保持原 cwd 不变且不留半成品；名称与路径都做越界校验。
// 删除一律需要宿主单次授权，并先列出可确认的残留（未提交文件/未合并提交）。
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
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
  /** 由交互式命令在显示审批前采集，执行时重新核对。 */
  snapshot?: WorktreeRemovalSnapshot
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
          stderr: code === 'ENOENT' ? 'git 不可用' : stderr || error.message
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

export type WorktreeEntry = {
  path: string
  head?: string
  branch?: string
  detached?: boolean
  bare?: boolean
  prunable?: boolean
}

/** 解析 Git porcelain 工作树列表，兼容旧的换行格式。 */
export function parseWorktreeList(output: string): WorktreeEntry[] {
  const nulTerminated = output.includes('\0')
  const records = output.split(nulTerminated ? '\0\0' : /\r?\n\r?\n/)
  const entries: WorktreeEntry[] = []
  for (const record of records) {
    const [first, ...lines] = record.split(nulTerminated ? '\0' : /\r?\n/)
    if (!first?.startsWith('worktree ')) continue
    const entry: WorktreeEntry = { path: first.slice('worktree '.length) }
    for (const line of lines) {
      if (line.startsWith('HEAD ')) entry.head = line.slice('HEAD '.length)
      else if (line.startsWith('branch refs/heads/')) entry.branch = line.slice('branch refs/heads/'.length)
      else if (line === 'detached') entry.detached = true
      else if (line === 'bare') entry.bare = true
      else if (line === 'prunable' || line.startsWith('prunable ')) entry.prunable = true
    }
    entries.push(entry)
  }
  return entries
}

export async function listWorktrees(cwd: string): Promise<WorktreeEntry[]> {
  const list = await runGit(['worktree', 'list', '--porcelain', '-z'], cwd)
  if (!list.ok) throw new Error(`无法列出 worktree：${list.stderr.trim() || 'git 失败'}`)
  return parseWorktreeList(list.stdout)
}

async function findWorktreeEntry(repoCwd: string, targetPath: string): Promise<WorktreeEntry | undefined> {
  return findLinkedWorktreeEntry(await listWorktrees(repoCwd), targetPath)
}

function findLinkedWorktreeEntry(entries: WorktreeEntry[], targetPath: string): WorktreeEntry | undefined {
  const wanted = comparablePath(targetPath)
  if (wanted === undefined) return undefined
  return entries.slice(1).find((entry) => !entry.prunable && comparablePath(entry.path) === wanted)
}

export async function getWorktreeBranch(cwd: string): Promise<string | undefined> {
  const ref = await runGit(['symbolic-ref', '--quiet', 'HEAD'], cwd)
  const name = ref.stdout.trim()
  return ref.ok && name.startsWith('refs/heads/') ? name.slice('refs/heads/'.length) : undefined
}

type Checkout = {
  path: string
  branch: string
  head: string
  gitDir: string
  commonDir: string
}

const CHECKOUT_ARGS = [
  'rev-parse', '--path-format=absolute', '--show-toplevel', '--absolute-git-dir', '--git-common-dir',
  'HEAD', '--symbolic-full-name', 'HEAD'
]

const COMMON_DIR_ARGS = ['rev-parse', '--path-format=absolute', '--git-common-dir']

function parseCheckout(output: string, cwd: string, expectedBranch: string, role: string): Checkout {
  const [path, gitDir, commonDir, head, branch] = output.trimEnd().split(/\r?\n/)
  if (!path || !gitDir || !commonDir || !head || !OBJECT_ID_PATTERN.test(head)) {
    throw new Error(`无法核对${role}身份与 HEAD：${cwd}`)
  }
  if (branch !== `refs/heads/${expectedBranch}`) {
    throw new Error(`${role}未检出绑定分支 ${expectedBranch}，请先切回该分支：${cwd}`)
  }
  return { path, branch: expectedBranch, head, gitDir, commonDir }
}

async function readCheckout(cwd: string, expectedBranch: string, role: string): Promise<Checkout> {
  const details = await runGit(CHECKOUT_ARGS, cwd)
  return parseCheckout(details.ok ? details.stdout : '', cwd, expectedBranch, role)
}

async function readCommonDir(cwd: string): Promise<string | undefined> {
  const result = await runGit(COMMON_DIR_ARGS, cwd)
  return result.ok ? comparablePath(result.stdout.trimEnd()) : undefined
}

function assertLinkedCheckout(checkout: Checkout, path: string, originCommon: string | undefined): void {
  const gitDir = comparablePath(checkout.gitDir)
  if (!originCommon || !gitDir || gitDir === originCommon ||
    comparablePath(checkout.commonDir) !== originCommon ||
    comparablePath(checkout.path) !== comparablePath(path)) {
    throw new Error(`无法核对 worktree 仓库身份：${path}`)
  }
}

/** 会话恢复前同步验证原始工作区、已登记路径及检出分支。 */
export function verifyWorktreeSessionSync(binding: WorktreeSession, originCwd: string): string {
  const path = realPathOf(binding.path)
  const origin = comparablePath(originCwd)
  if (!path || !origin || origin === comparablePath(path) ||
    (binding.originalCwd !== undefined && origin !== comparablePath(binding.originalCwd))) {
    throw new Error(`无法核对 worktree 与来源工作区的路径：${binding.path}`)
  }
  const read = (args: string[], cwd: string): string => {
    try {
      return execFileSync('git', ['--no-optional-locks', ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true
      })
    } catch {
      throw new Error(`无法核对 worktree Git 身份：${cwd}`)
    }
  }
  const entries = parseWorktreeList(read(['worktree', 'list', '--porcelain', '-z'], originCwd))
  const entry = findLinkedWorktreeEntry(entries, path)
  if (entry?.branch !== binding.branch) throw new Error(`worktree 身份已变化或分支未检出：${path} · ${binding.branch}`)
  const checkout = parseCheckout(read(CHECKOUT_ARGS, path), path, binding.branch, '绑定 worktree')
  assertLinkedCheckout(checkout, path, comparablePath(read(COMMON_DIR_ARGS, originCwd).trimEnd()))
  return path
}

/** 解析现有专用 worktree，供命令进入及宿主恢复时核对绑定。 */
export async function resolveWorktreeSession(input: EnterWorktreeInput & { baseBranch: string }): Promise<WorktreeSession> {
  const { cwd, name, baseBranch } = input
  if (!isValidWorktreeName(name)) throw new Error(`非法 worktree 名称：${JSON.stringify(name)}`)
  const root = input.root ?? join(dataRoot(input.home), 'worktrees')
  const path = realPathOf(join(root, repoSlug(cwd), name))
  const rootReal = realPathOf(root)
  const branch = `${baseBranch}-budingx/${name}`
  if (!path || !rootReal || !isInside(rootReal, path)) {
    throw new Error(`找不到 worktree 或路径越界：${name}`)
  }
  const entry = await findWorktreeEntry(cwd, path)
  if (entry?.branch !== branch) throw new Error(`worktree 身份已变化或分支未检出：${path} · ${branch}`)
  const source = await readCheckout(path, branch, '源 worktree')
  assertLinkedCheckout(source, path, await readCommonDir(cwd))
  return { path, branch, baseBranch, originalCwd: cwd }
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
    // Git owns its cleanup. A concurrent call may have created this path.
    throw new Error(`创建 worktree 失败：${added.stderr.trim() || added.stdout.trim()}`)
  }
  return { path: worktreePath, branch, baseBranch, originalCwd: cwd }
}

function assertGitOperationIdle(checkout: Checkout): void {
  const markers = [
    'MERGE_HEAD', 'MERGE_AUTOSTASH', 'CHERRY_PICK_HEAD', 'REVERT_HEAD',
    'REBASE_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_START'
  ]
  const operation = markers.find((marker) => existsSync(join(checkout.gitDir, marker)))
  if (operation) throw new Error(`Git 操作正在进行中（${operation}）：${checkout.path}`)
}

async function readPendingFiles(worktreePath: string, includeIgnored = false): Promise<string> {
  const args = ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']
  if (includeIgnored) args.push('--ignored')
  const statusRun = await runGit(args, worktreePath)
  if (!statusRun.ok) {
    throw new Error(`无法复核工作区和暂存区：${worktreePath}；${statusRun.stderr.trim() || 'git status 失败'}`)
  }
  return statusRun.stdout
}

export type WorktreeMergePlan = { source: Checkout; target: Checkout }

export async function prepareWorktreeMerge(session: WorktreeSession): Promise<WorktreeMergePlan> {
  if (!session.originalCwd || session.baseBranch === session.branch) {
    throw new Error('合并需要不同的源分支与已绑定的目标工作区')
  }
  const entry = await findWorktreeEntry(session.originalCwd, session.path)
  if (entry?.branch !== session.branch) throw new Error(`worktree 身份已变化：${session.path} · ${session.branch}`)
  const source = await readCheckout(session.path, session.branch, '源 worktree')
  const target = await readCheckout(session.originalCwd, session.baseBranch, '目标工作区')
  assertLinkedCheckout(source, session.path, comparablePath(target.commonDir))
  if (comparablePath(source.path) === comparablePath(target.path)) {
    throw new Error('合并的源与目标 worktree 路径无效')
  }
  for (const checkout of [source, target]) {
    assertGitOperationIdle(checkout)
    if (await readPendingFiles(checkout.path)) {
      throw new Error(`合并要求工作区和暂存区干净：${checkout.path} · ${checkout.branch}`)
    }
  }
  return { source, target }
}

const OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

/** Git 2.51 的普通 ort 合并仍可能覆盖本地忽略文件，因此预检其合并树。 */
async function assertIgnoredFilesPreserved({ source, target }: WorktreeMergePlan): Promise<void> {
  const ignored = await runGit(
    ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory', '-z'],
    target.path
  )
  if (!ignored.ok) throw new Error(`无法核对目标工作区的忽略文件：${target.path}`)
  if (!ignored.stdout) return
  const tree = await runGit(['merge-tree', '--write-tree', '--no-messages', target.head, source.head], target.path)
  const treeId = tree.stdout.split(/\r?\n/, 1)[0]
  if (!treeId || !OBJECT_ID_PATTERN.test(treeId)) {
    throw new Error(`无法验证合并是否会覆盖目标工作区的忽略文件：${tree.stderr.trim()}`)
  }
  const diff = await runGit(
    ['diff', '--name-only', '--no-renames', '--diff-filter=ACMT', '-z', target.head, treeId, '--'],
    target.path
  )
  if (!diff.ok) throw new Error(`无法核对合并对目标工作区的影响：${target.path}`)
  const normalize = (path: string) => {
    const name = path.replace(/\/$/, '')
    return process.platform === 'win32' ? name.toLowerCase() : name
  }
  const ignoredPaths = new Set(ignored.stdout.split('\0').filter(Boolean).map(normalize))
  const changedPaths = diff.stdout.split('\0').filter(Boolean).map(normalize)
  // 路径同名或文件与目录互相替代时，忽略文件可能被覆盖。
  for (const changed of changedPaths) {
    let prefix = changed
    while (prefix) {
      if (ignoredPaths.has(prefix)) throw new Error(`合并会覆盖目标工作区的忽略路径：${prefix}`)
      const parent = prefix.lastIndexOf('/')
      prefix = parent === -1 ? '' : prefix.slice(0, parent)
    }
  }
  const changed = new Set(changedPaths)
  for (const ignoredPath of ignoredPaths) {
    let parent = ignoredPath.lastIndexOf('/')
    while (parent !== -1) {
      const prefix = ignoredPath.slice(0, parent)
      if (changed.has(prefix)) throw new Error(`合并会覆盖目标工作区的忽略路径：${ignoredPath}`)
      parent = prefix.lastIndexOf('/')
    }
  }
}

/** 复核宿主已批准的源与目标后，以批准的源提交执行正常 Git 合并。 */
export async function mergeWorktree(session: WorktreeSession, approved: WorktreeMergePlan): Promise<void> {
  const current = await prepareWorktreeMerge(session)
  if (JSON.stringify(current) !== JSON.stringify(approved)) {
    throw new Error('源或目标 worktree 的身份或 HEAD 在审批期间发生变化，请重新发起合并')
  }
  await assertIgnoredFilesPreserved(current)
  const { source, target } = current
  const merged = await runGit([
    'merge', '--ff', '--no-squash', '--commit', '--no-edit', '--no-autostash', '--no-overwrite-ignore', '--', source.head
  ], target.path)
  if (merged.ok) return
  if (existsSync(join(target.gitDir, 'MERGE_HEAD'))) {
    const conflicts = await runGit(['diff', '--diff-filter=U', '--name-only', '-z'], target.path)
    const paths = conflicts.ok ? conflicts.stdout.split('\0').filter(Boolean).join('、') : ''
    const state = paths ? `合并冲突：${paths}` : '合并尚未完成'
    throw new Error(`${state}。Git 合并状态已保留，请在 ${target.path} 检查 git status。${merged.stderr.trim()}`)
  }
  throw new Error(`合并失败：${merged.stderr.trim() || merged.stdout.trim() || 'git merge 失败'}`)
}

type WorktreeRemovalSnapshot = {
  source: Checkout
  baseHead: string
  status: string
  discardedFiles: number
  discardedCommits: number
}

export async function prepareWorktreeRemoval(session: WorktreeSession): Promise<WorktreeRemovalSnapshot> {
  const repoCwd = session.originalCwd ?? session.path
  const entry = await findWorktreeEntry(repoCwd, session.path)
  if (entry?.branch !== session.branch || session.branch === session.baseBranch) {
    throw new Error(`无法复核 worktree 身份，拒绝删除；可确认残留：路径 ${session.path}、分支 ${session.branch}`)
  }
  const source = await readCheckout(entry.path, session.branch, '待删除 worktree')
  assertLinkedCheckout(source, session.path, await readCommonDir(repoCwd))
  assertGitOperationIdle(source)
  const status = await readPendingFiles(source.path, true)
  const discardedFiles = status.split('\0').filter((entry) => entry !== '').length
  const base = await runGit(['rev-parse', '--verify', `refs/heads/${session.baseBranch}`], repoCwd)
  if (!base.ok) throw new Error(`无法复核基准分支，拒绝删除：${session.baseBranch}`)
  const baseHead = base.stdout.trim()
  const count = await runGit(['rev-list', '--count', `${baseHead}..${source.head}`], repoCwd)
  const discardedCommits = Number.parseInt(count.stdout.trim(), 10)
  if (!count.ok || !Number.isSafeInteger(discardedCommits)) {
    throw new Error(`无法复核未合并提交数量：${count.stderr.trim() || 'git rev-list 失败'}`)
  }
  return { source, baseHead, status, discardedFiles, discardedCommits }
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
  const snapshot = await prepareWorktreeRemoval(current)
  const authorizedPath = comparablePath(authorization.worktree)
  if (
    authorizedPath === undefined ||
    authorizedPath !== comparablePath(snapshot.source.path) ||
    authorization.branch !== current.branch
  ) {
    throw new Error(`授权与目标 worktree 不匹配，拒绝删除：授权 ${authorization.worktree}@${authorization.branch}`)
  }

  if (authorization.snapshot && JSON.stringify(snapshot) !== JSON.stringify(authorization.snapshot)) {
    throw new Error('worktree 的身份、HEAD 或未提交文件在审批期间发生变化，请重新发起删除')
  }
  const { discardedFiles, discardedCommits } = snapshot
  const hasResidue = discardedFiles > 0 || discardedCommits > 0
  if (hasResidue && !(current.discard_changes === true && authorization.discardChanges === true)) {
    throw new Error(
      `worktree 存在可确认的残留：未提交文件 ${discardedFiles} 个、未合并提交 ${discardedCommits} 个；` +
        '删除需要 discard_changes=true 且宿主明确授权'
    )
  }

  const removed = await runGit(
    ['worktree', 'remove', ...(discardedFiles > 0 ? ['--force'] : []), '--', snapshot.source.path],
    repoCwd
  )
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
