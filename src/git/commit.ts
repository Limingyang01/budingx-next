// SP004 T9 · Git 受控提交（design §7.2、§7.4，AC GW-03/GW-04/GW-09）。
// 只在产品管理的专用 worktree 与其专用分支上提交；用户原 checkout 的分支、索引与工作文件保持原样。
// 授权一次性绑定仓库/分支/HEAD/补丁摘要/预计 tree/提交信息；受控索引经 Git plumbing 构造并校验，
// 条件更新 ref 要求旧值等于已审 HEAD；存在钩子/签名策略时拒绝（无法保留语义）。
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

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
  filePaths: string[]
  createdAt: number
  /** 已使用或已释放；不可复用。 */
  consumed: boolean
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

function runGit(
  cwd: string,
  args: string[],
  options: { env?: Record<string, string>; input?: string; allowFailure?: boolean } = {}
): Promise<GitResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = execFile(
      'git',
      args,
      {
        cwd,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, ...options.env }
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
    child.stdin?.on('error', rejectPromise)
    child.stdin?.end(options.input)
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
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`非法提交路径（禁止空段/./..）：${JSON.stringify(raw)}`)
  }
  if (segments[0] === '.git') throw new Error(`非法提交路径（不允许 Git 元数据）：${JSON.stringify(raw)}`)
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
  return { worktree, repository, head, branch }
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
  for (const hook of ['pre-commit', 'prepare-commit-msg', 'commit-msg']) {
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

/** 用临时索引从已审 HEAD 构造受控 tree（不触碰专用 worktree 的真实索引）。 */
async function computeTree(worktree: string, head: string, files: CommitFile[]): Promise<string> {
  const tempDir = mkdtempSync(join(tmpdir(), 'budingx-index-'))
  const indexPath = join(tempDir, 'index')
  const env = { GIT_INDEX_FILE: indexPath }
  try {
    await runGit(worktree, ['read-tree', head], { env })
    for (const file of files) {
      if (file.content === null) {
        await runGit(worktree, ['update-index', '--force-remove', '--', file.path], { env, allowFailure: true })
        continue
      }
      const blob = (await runGit(worktree, ['hash-object', '-w', '--stdin'], { env, input: file.content })).stdout.trim()
      await runGit(worktree, ['update-index', '--add', '--cacheinfo', `100644,${blob},${file.path}`], { env })
    }
    return (await runGit(worktree, ['write-tree'], { env })).stdout.trim()
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function changedPaths(worktree: string): Promise<string[]> {
  const raw = (await runGit(worktree, ['status', '--porcelain=v1', '-z'])).stdout
  const records = raw.split('\0')
  const paths: string[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === '' || record.length < 4) continue
    const code = record.slice(0, 2)
    if (code.includes('R') || code.includes('C')) index += 1 // 跳过重命名/复制来源路径
    paths.push(record.slice(3).replace(/\\/g, '/'))
  }
  return paths
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
    if (file.content === null) {
      if (existsSync(absolute)) throw new Error(`审批为删除的文件仍存在，内容已漂移：${file.path}`)
      continue
    }
    if (existsSync(absolute)) {
      const actual = readFileSync(absolute, 'utf8')
      if (actual !== file.content) throw new Error(`审批内容与工作区实际内容不一致（内容漂移）：${file.path}`)
    }
  }
}

function assertAuthorizationShape(value: unknown): asserts value is CommitAuthorization {
  const auth = value as CommitAuthorization | null
  const valid =
    typeof auth === 'object' &&
    auth !== null &&
    typeof auth.id === 'string' &&
    typeof auth.repository === 'string' &&
    typeof auth.worktree === 'string' &&
    typeof auth.branch === 'string' &&
    typeof auth.head === 'string' &&
    typeof auth.message === 'string' &&
    typeof auth.patchDigest === 'string' &&
    typeof auth.expectedTree === 'string' &&
    Array.isArray(auth.filePaths) &&
    typeof auth.consumed === 'boolean'
  if (!valid) throw new Error('未授权的提交请求：缺少有效的一次性授权')
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
  const expectedTree = await computeTree(identity.worktree, identity.head, files)
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
    consumed: false
  }
  const preview = [
    `目标分支：${authorization.branch}`,
    `基准 HEAD：${authorization.head}`,
    `提交信息：${authorization.message}`,
    `补丁摘要：${patchDigest.slice(0, 16)}…`,
    `预计 tree：${expectedTree}`,
    '文件：',
    ...files.map((file) => `  ${file.content === null ? 'D' : 'M'} ${file.path}`)
  ]
  return { authorization, preview }
}

/** 授权后受控提交：校验绑定与树一致，commit-tree + 条件更新专用分支 ref；失败释放授权。 */
export async function commitWithAuthorization(
  authorization: CommitAuthorization,
  files: CommitFile[]
): Promise<CommitResult> {
  assertAuthorizationShape(authorization)
  if (authorization.consumed) throw new Error('该提交授权已使用或已释放，不能重复提交')
  try {
    const normalized = normalizeFiles(files ?? [])
    const identity = await readIdentity(authorization.worktree)
    if (identity.repository !== authorization.repository) {
      throw new Error(`仓库身份不一致（审批 ${authorization.repository}，当前 ${identity.repository}），拒绝提交`)
    }
    if (identity.branch !== authorization.branch) {
      throw new Error(`审查后分支已漂移（审批 ${authorization.branch}，当前 ${identity.branch}），拒绝提交`)
    }
    if (identity.head !== authorization.head) {
      throw new Error(`审查后 HEAD 已漂移（审批 ${authorization.head}，当前 ${identity.head}），拒绝提交`)
    }
    await assertCommitPreconditions(identity)
    if (patchDigestOf(normalized) !== authorization.patchDigest) {
      throw new Error('审批内容漂移：补丁摘要不一致，拒绝提交')
    }
    if (
      normalized.length !== authorization.filePaths.length ||
      normalized.some((file, index) => file.path !== authorization.filePaths[index])
    ) {
      throw new Error('审批文件清单与提交文件不一致，拒绝提交')
    }
    const tree = await computeTree(identity.worktree, identity.head, normalized)
    if (tree !== authorization.expectedTree) {
      throw new Error(`待提交树与审批 tree 不一致（审批 ${authorization.expectedTree}，实际 ${tree}），拒绝提交`)
    }
    const sha = (
      await runGit(identity.worktree, ['commit-tree', tree, '-p', identity.head, '-m', authorization.message])
    ).stdout.trim()
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`受控提交未返回有效 SHA：${sha}`)
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
    authorization.consumed = true
    return { sha, tree, branch: authorization.branch, files: normalized.map((file) => file.path) }
  } catch (error) {
    authorization.consumed = true
    throw error
  }
}