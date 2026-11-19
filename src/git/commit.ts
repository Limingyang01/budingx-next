// SP004 T9 · Git 受控提交（design §7.2、§7.4，AC GW-03/GW-04/GW-09）。
// 只在产品管理的专用 worktree 与其专用分支上提交；用户原 checkout 的分支、索引与工作文件保持原样。
// 授权一次性绑定仓库/分支/HEAD/补丁摘要/预计 tree/提交信息；受控索引经 Git plumbing 构造并校验，
// 条件更新 ref 要求旧值等于已审 HEAD；存在钩子/签名策略时拒绝（无法保留语义）。
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync, existsSync, lstatSync, mkdtempSync, openSync, readFileSync,
  realpathSync, renameSync, rmSync, writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ChangeRecord } from '../workspace/checkpoint.js'
import { gitEnvironment } from './status.js'

/** 待提交文件：content=null 表示删除（工作区须已移除该文件）。 */
export type CommitFile = {
  path: string
  content: string | null
}

export type CommitRequest = {
  /** 专用 worktree 路径。 */
  worktree: string
  /** 专用分支（形如 <base>-budingx/<name>）。 */
  branch: string
  /** 已审查的 HEAD。 */
  head: string
  message: string
  files: CommitFile[]
}

export type CommitAuthorization = {
  id: string
  /** 仓库共同 Git 目录真实路径（仓库身份）。 */
  repository: string
  worktree: string
  branch: string
  head: string
  message: string
  patchDigest: string
  expectedTree: string
  filePaths: readonly string[]
  createdAt: number
  /** 已使用或已释放；不可复用。 */
  readonly consumed: boolean
}

export type CommitSnapshot = {
  authorization: CommitAuthorization
  preview: string[]
}

export type CommitResult = {
  sha: string
  tree: string
  branch: string
  files: string[]
}

type GitResult = { stdout: string; stderr: string; status: number }

const issuedAuthorizations = new WeakSet<CommitAuthorization>()
const usedAuthorizations = new WeakSet<CommitAuthorization>()

function runGit(
  cwd: string,
  args: string[],
  options: { env?: Record<string, string>; input?: string; allowFailure?: boolean } = {}
): Promise<GitResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = execFile(
      'git',
      ['--no-optional-locks', ...args],
      {
        cwd,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...gitEnvironment(),
          GIT_LITERAL_PATHSPECS: '1',
          ...options.env
        }
      },
      (error, stdout, stderr) => {
        if (error && options.allowFailure !== true) {
          const detail = String(stderr).trim() || error.message
          rejectPromise(new Error(`Git 命令失败（git ${args.join(' ')}）：${detail}`))
          return
        }
        resolvePromise({ stdout: String(stdout), stderr: String(stderr), status: error ? 1 : 0 })
      }
    )
    child.stdin?.end(options.input ?? '')
  })
}

function realDir(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

function normalizeFilePath(raw: string): string {
  const normalized = raw.replace(/\\/g, '/')
  if (normalized === '' || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`非法提交路径（必须是 worktree 内的相对路径）：${JSON.stringify(raw)}`)
  }
  const segments = normalized.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw new Error(`非法提交路径（禁止空段/./..）：${JSON.stringify(raw)}`)
  }
  if (segments.some((segment) => segment.toLowerCase() === '.git')) {
    throw new Error(`非法提交路径（不允许 Git 元数据）：${JSON.stringify(raw)}`)
  }
  return segments.join('/')
}

function normalizeFiles(files: CommitFile[]): CommitFile[] {
  const seen = new Map<string, CommitFile>()
  for (const file of files) {
    if (typeof file?.path !== 'string') throw new Error('提交文件缺少 path')
    if (file.content !== null && typeof file.content !== 'string') {
      throw new Error(`提交文件内容必须是字符串或 null：${file.path}`)
    }
    const path = normalizeFilePath(file.path)
    if (seen.has(path)) throw new Error(`提交文件重复：${path}`)
    seen.set(path, { path, content: file.content })
  }
  return [...seen.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** 补丁摘要：按路径排序后对「路径 + 内容」做 SHA-256，绑定审批时看到的内容。 */
export function patchDigestOf(files: CommitFile[]): string {
  const normalizePd = normalizeFiles(files)
  const hash = createHash('sha256')
  for (const file of normalizePd) {
    hash.update(file.path)
    hash.update('\0')
    hash.update(file.content === null ? '\u0001' : `\u0000${file.content}`)
    hash.update('\n')
  }
  return hash.digest('hex')
}

type RepoIdentity = {
  worktree: string
  repository: string
  indexPath: string
  head: string
  branch: string
}

async function readIdentity(worktreeInput: string): Promise<RepoIdentity> {
  const worktree = realDir(worktreeInput)
  const check = await runGit(worktree, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true })
  if (check.status !== 0 || check.stdout.trim() !== 'true') {
    throw new Error(`非 Git 工作区，无法提交：${worktree}`)
  }
  const gitDir = (await runGit(worktree, ['rev-parse', '--path-format=absolute', '--git-dir'])).stdout.trim()
  const commonDir = (
    await runGit(worktree, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  ).stdout.trim()
  const repository = realDir(commonDir)
  if (realDir(gitDir) === repository) {
    throw new Error('必须在产品管理的专用 worktree 中提交（分支形如 <base>-budingx/<name>）；原 checkout 不开放提交')
  }
  const head = (await runGit(worktree, ['rev-parse', 'HEAD'], { allowFailure: true })).stdout.trim()
  if (head === '') throw new Error(`分离 HEAD 或空仓库，无法受控提交：${worktree}`)
  const branch = (await runGit(worktree, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
  if (!branch.includes('-budingx/')) {
    throw new Error(`必须在产品管理的专用分支上提交（形如 <base>-budingx/<name>）：当前分支 ${branch}`)
  }
  return { worktree, repository, indexPath: join(realDir(gitDir), 'index'), head, branch }
}

async function assertCommitPreconditions(identity: RepoIdentity): Promise<void> {
  // 索引必须干净：受控索引由 plumbing 单独构造，不接受已有暂存内容。
  const staged = (await runGit(identity.worktree, ['diff', '--cached', '--name-only'])).stdout.trim()
  if (staged !== '') {
    throw new Error(`专用 worktree 索引存在已暂存改动，拒绝提交：${staged.split('\n').slice(0, 5).join(', ')}`)
  }
  const unmerged = (await runGit(identity.worktree, ['ls-files', '-u'])).stdout.trim()
  if (unmerged !== '') throw new Error('专用 worktree 存在未合并冲突，拒绝提交')
  // 钩子与签名：受控提交后端无法保留其语义，一律拒绝。
  const hooksPath = (await runGit(identity.worktree, ['config', '--get', 'core.hooksPath'], { allowFailure: true }))
    .stdout.trim()
  if (hooksPath !== '') throw new Error(`该仓库启用了自定义提交钩子路径（core.hooksPath=${hooksPath}），受控提交无法保留钩子语义`)
  for (const hook of ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit']) {
    if (existsSync(join(identity.repository, 'hooks', hook))) {
      throw new Error(`该仓库存在适用的提交钩子（${hook}），受控提交无法保留钩子语义，已拒绝`)
    }
  }
  const gpgsign = (await runGit(identity.worktree, ['config', '--get', 'commit.gpgsign'], { allowFailure: true }))
    .stdout.trim()
  if (gpgsign === 'true') throw new Error('该仓库启用了提交签名（commit.gpgsign），受控提交无法保留签名策略，已拒绝')
  const userName = (await runGit(identity.worktree, ['config', '--get', 'user.name'], { allowFailure: true })).stdout.trim()
  const userEmail = (await runGit(identity.worktree, ['config', '--get', 'user.email'], { allowFailure: true })).stdout.trim()
  if (userName === '' || userEmail === '') throw new Error('异常 Git 配置：缺少 user.name/user.email，无法受控提交')
}

async function readTreeEntry(worktree: string, head: string, path: string): Promise<{ mode: string; oid: string } | undefined> {
  const entry = (await runGit(worktree, ['ls-tree', '-z', head, '--', path])).stdout
  if (entry === '') return undefined
  const match = /^(100644|100755) blob ([0-9a-f]+)\t/.exec(entry)
  if (!match) throw new Error(`受控提交只接受普通文件：${path}`)
  return { mode: match[1]!, oid: match[2]! }
}

async function hashWorktreeContent(worktree: string, file: { path: string; content: string }, write = false): Promise<string> {
  const attributes = (await runGit(worktree, ['check-attr', '-z', 'filter', '--', file.path])).stdout.split('\0')
  if (attributes.length !== 4 || !['unspecified', 'unset'].includes(attributes[2]!)) {
    throw new Error(`受控提交不执行自定义 Git 文件过滤器：${file.path}`)
  }
  const result = await runGit(
    worktree,
    [
      '-c', 'filter.unset.process=', '-c', 'filter.unset.clean=',
      '-c', 'filter.unspecified.process=', '-c', 'filter.unspecified.clean=',
      'hash-object', ...(write ? ['-w'] : []), `--path=${file.path}`, '--stdin'
    ],
    { input: file.content }
  )
  return result.stdout.trim()
}

/** 从 HEAD 和未撤销的 checkpoint 证明文件改动由本次托管编辑产生。 */
export async function commitFilesFromCheckpoints(
  worktree: string,
  head: string,
  records: readonly ChangeRecord[]
): Promise<CommitFile[]> {
  const changes = new Map<string, { before?: string; after: string }>()
  for (const record of records) {
    if (record.undone) continue
    const path = normalizeFilePath(record.path)
    const previous = changes.get(path)
    if (previous && previous.after !== record.before) {
      throw new Error(`文件包含无法归属的中间改动：${path}`)
    }
    if (previous) previous.after = record.after
    else changes.set(path, { before: record.before, after: record.after })
  }

  const files: CommitFile[] = []
  for (const [path, change] of changes) {
    const base = await readTreeEntry(worktree, head, path)
    const before = change.before === undefined
      ? undefined
      : await hashWorktreeContent(worktree, { path, content: change.before })
    if (base?.oid !== before) throw new Error(`工作区文件包含审批前的用户改动或基线漂移：${path}`)
    if (change.before !== change.after &&
        await hashWorktreeContent(worktree, { path, content: change.after }) !== base?.oid) {
      files.push({ path, content: change.after })
    }
  }
  return files
}

/** 用临时索引从已审 HEAD 构造受控 tree 与对应索引。 */
async function computeTree(worktree: string, head: string, files: CommitFile[]): Promise<{ tree: string; index: Buffer }> {
  const tempDir = mkdtempSync(join(tmpdir(), 'budingx-index-'))
  const indexPath = join(tempDir, 'index')
  const env = { GIT_INDEX_FILE: indexPath }
  try {
    await runGit(worktree, ['read-tree', head], { env })
    for (const file of files) {
      if (file.content === null) {
        await runGit(worktree, ['update-index', '--force-remove', '--', file.path], { env })
        continue
      }
      const blob = await hashWorktreeContent(worktree, { path: file.path, content: file.content }, true)
      const mode = (await readTreeEntry(worktree, head, file.path))?.mode ?? '100644'
      await runGit(worktree, ['update-index', '--add', '--cacheinfo', `${mode},${blob},${file.path}`], { env })
    }
    const tree = (await runGit(worktree, ['write-tree'], { env })).stdout.trim()
    return { tree, index: readFileSync(indexPath) }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function changedPaths(worktree: string): Promise<string[]> {
  const raw = (await runGit(worktree, ['status', '--porcelain=v1', '--untracked-files=all', '--no-renames', '-z'])).stdout
  return raw.split('\0').filter(Boolean).map((record) => record.slice(3).replace(/\\/g, '/'))
}

async function assertWorktreeMatchesPatch(identity: RepoIdentity, files: CommitFile[]): Promise<void> {
  const approved = new Set(files.map((file) => file.path))
  const changed = await changedPaths(identity.worktree)
  const unapproved = changed.filter((path) => !approved.has(path))
  if (unapproved.length > 0) {
    throw new Error(`专用 worktree 存在未审批的改动（混合归属），拒绝提交：${unapproved.slice(0, 5).join(', ')}`)
  }
  for (const file of files) {
    const absolute = join(identity.worktree, file.path)
    const info = lstatSync(absolute, { throwIfNoEntry: false })
    if (file.content === null) {
      if (info !== undefined) throw new Error(`审批为删除的文件仍存在，内容已漂移：${file.path}`)
      continue
    }
    if (!info?.isFile()) throw new Error(`审批文件已缺失或不再是普通文件（内容漂移）：${file.path}`)
    const real = realpathSync.native(absolute)
    const rel = relative(identity.worktree, real)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) ||
        rel.split(sep).join('/') !== file.path) {
      throw new Error(`审批文件的真实路径已漂移：${file.path}`)
    }
    const actual = readFileSync(real)
    if (!actual.equals(Buffer.from(file.content))) throw new Error(`审批内容与工作区实际内容不一致（内容漂移）：${file.path}`)
  }
}

/** 审批快照：校验专用 worktree/分支/HEAD/索引/钩子/归属，产出一次性授权与预览行。 */
export async function createCommitAuthorization(request: CommitRequest): Promise<CommitSnapshot> {
  if (typeof request?.message !== 'string' || request.message.trim() === '') {
    throw new Error('提交信息不能为空')
  }
  const files = normalizeFiles(request.files ?? [])
  if (files.length === 0) throw new Error('提交文件清单为空，拒绝提交')
  const identity = await readIdentity(request.worktree)
  if (identity.branch !== request.branch) {
    throw new Error(`分支已漂移（审批 ${request.branch}，当前 ${identity.branch}）；请重新审查`)
  }
  if (identity.head !== request.head) {
    throw new Error(`审查后 HEAD 已漂移（审批 ${request.head}，当前 ${identity.head}）；请重新审查`)
  }
  await assertCommitPreconditions(identity)
  await assertWorktreeMatchesPatch(identity, files)
  const { tree: expectedTree } = await computeTree(identity.worktree, identity.head, files)
  const patchDigest = patchDigestOf(files)
  const authorization: CommitAuthorization = {
    id: randomUUID(),
    repository: identity.repository,
    worktree: identity.worktree,
    branch: identity.branch,
    head: identity.head,
    message: request.message,
    patchDigest,
    expectedTree,
    filePaths: files.map((file) => file.path),
    createdAt: Date.now(),
    get consumed() { return usedAuthorizations.has(this) }
  }
  Object.freeze(authorization.filePaths)
  Object.freeze(authorization)
  const patch = (await runGit(identity.worktree, [
    'diff-tree', '-p', '--no-ext-diff', '--no-textconv', '--no-renames', identity.head, expectedTree
  ])).stdout.trimEnd()
  const preview = [
    `目标分支：${authorization.branch}`,
    `基准 HEAD：${authorization.head}`,
    `提交信息：${authorization.message}`,
    `补丁摘要：${patchDigest.slice(0, 16)}…`,
    `预计 tree：${expectedTree}`,
    '文件：',
    ...files.map((file) => `  ${file.content === null ? 'D' : 'M'} ${file.path}`),
    ...patch.split('\n')
  ]
  issuedAuthorizations.add(authorization)
  return { authorization, preview }
}

/** 授权后受控提交：校验绑定与树一致，commit-tree + 条件更新专用分支 ref；失败释放授权。 */
export async function commitWithAuthorization(
  authorization: CommitAuthorization,
  files: CommitFile[]
): Promise<CommitResult> {
  if (!issuedAuthorizations.has(authorization)) {
    throw new Error('未授权的提交请求：缺少宿主签发的一次性授权')
  }
  if (authorization.consumed) throw new Error('该提交授权已使用或已释放，不能重复提交')
  usedAuthorizations.add(authorization)
  const normalized = normalizeFiles(files ?? [])
  const identity = await readIdentity(authorization.worktree)
  if (identity.repository !== authorization.repository) throw new Error('审批后仓库身份已漂移，拒绝提交')
  if (identity.branch !== authorization.branch) throw new Error('审批后专用分支已漂移，拒绝提交')
  if (identity.head !== authorization.head) throw new Error('审批后 HEAD 已漂移，拒绝提交')
  if (patchDigestOf(normalized) !== authorization.patchDigest) {
    throw new Error('审批内容漂移：补丁摘要不一致，拒绝提交')
  }

  // 按 Git 的索引锁约定阻止并发暂存。提交对象和新索引都准备好后才推进 ref。
  const lockPath = `${identity.indexPath}.lock`
  const lockFd = openSync(lockPath, 'wx')
  let openLock = true
  let publishedIndex = false
  try {
    await assertCommitPreconditions(identity)
    const { tree, index } = await computeTree(identity.worktree, identity.head, normalized)
    if (tree !== authorization.expectedTree) {
      throw new Error(`待提交树与审批 tree 不一致（审批 ${authorization.expectedTree}，实际 ${tree}），拒绝提交`)
    }
    const sha = (
      await runGit(identity.worktree, ['commit-tree', tree, '-p', identity.head, '-m', authorization.message])
    ).stdout.trim()
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) throw new Error(`受控提交未返回有效 SHA：${sha}`)
    writeFileSync(lockFd, index)
    closeSync(lockFd)
    openLock = false
    await assertWorktreeMatchesPatch(identity, normalized)
    // 条件更新：旧值必须等于已审 HEAD，防止并发 ref 变更被覆盖。
    const updated = await runGit(
      identity.worktree,
      ['update-ref', `refs/heads/${authorization.branch}`, sha, authorization.head],
      { allowFailure: true }
    )
    if (updated.status !== 0) {
      throw new Error(
        `专用分支 ref 在提交期间被并发修改，条件更新失败：${updated.stderr.trim() || 'old value mismatch'}`
      )
    }
    try {
      renameSync(lockPath, identity.indexPath)
      publishedIndex = true
    } catch (error) {
      const ref = `refs/heads/${identity.branch}`
      const rollback = await runGit(identity.worktree, ['update-ref', ref, identity.head, sha], { allowFailure: true })
      if (rollback.status !== 0) {
        throw new Error(`提交 ${sha} 已生成，但索引同步与条件回退失败；请检查专用 worktree：${identity.worktree}`, { cause: error })
      }
      throw new Error('专用 worktree 索引同步失败，分支已恢复至审批前 HEAD', { cause: error })
    }
    return { sha, tree, branch: authorization.branch, files: normalized.map((file) => file.path) }
  } finally {
    if (openLock) closeSync(lockFd)
    if (!publishedIndex) rmSync(lockPath, { force: true })
  }
}
