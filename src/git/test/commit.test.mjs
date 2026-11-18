// SP004 T9 · Git 受控提交授权与专用 worktree（design §7.4，AC GW-03/GW-04/GW-09）。
// 证据层级：L1 Git（真实临时仓库 fixture）。禁止在用户真实仓库做 Git 写操作。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  commitWithAuthorization,
  createCommitAuthorization,
  patchDigestOf
} from '../../tui/dist/git/commit.js'
import { enterWorktree } from '../../tui/dist/git/worktree.js'

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'BudingX Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'BudingX Test',
  GIT_COMMITTER_EMAIL: 'test@example.com'
}

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: GIT_ENV }).trim()
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'budingx-t9-'))
  git(root, 'init', '-q', '-b', 'master')
  git(root, 'config', 'user.name', 'BudingX Test')
  git(root, 'config', 'user.email', 'test@example.com')
  writeFileSync(join(root, 'base.txt'), 'base\n')
  writeFileSync(join(root, 'mixed.txt'), 'original-mixed\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'init')
  return root
}

async function makeWorktree(root) {
  return enterWorktree({ cwd: root, name: 'demo', root: join(root, '.wt') })
}

function cleanupRepo(root) {
  // 链接 worktree 在 Windows 下会短暂锁定文件：先移除 worktree，再带重试删除临时仓库。
  try {
    execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', join(root, '.wt', 'demo')], {
      encoding: 'utf8',
      env: GIT_ENV,
      stdio: 'ignore'
    })
  } catch {
    // worktree 不存在或已移除
  }
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  } catch {
    // 临时目录残留不影响用例结论；交给系统清理
  }
}

function statusOf(cwd) {
  return git(cwd, 'status', '--porcelain=v1')
}

async function withRepo(fn) {
  const root = makeRepo()
  try {
    return await fn(root)
  } finally {
    cleanupRepo(root)
  }
}

test('T9-1 授权快照绑定 worktree/分支/HEAD/补丁摘要/预计 tree/提交信息', async () => {
  await withRepo(async (root) => {
    const wt = await makeWorktree(root)
    const files = [{ path: 'a.txt', content: 'A\n' }]
    writeFileSync(join(wt.path, 'a.txt'), 'A\n')
    const result = await createCommitAuthorization({
      worktree: wt.path,
      branch: wt.branch,
      head: git(wt.path, 'rev-parse', 'HEAD'),
      message: 'feat: add a',
      files
    })
    const auth = result.authorization
    assert.equal(auth.worktree, wt.path)
    assert.equal(auth.branch, wt.branch)
    assert.equal(auth.head, git(root, 'rev-parse', 'master'))
    assert.equal(auth.message, 'feat: add a')
    assert.equal(auth.patchDigest, patchDigestOf(files))
    assert.match(auth.expectedTree, /^[0-9a-f]{40}$/)
    assert.deepEqual(auth.filePaths, ['a.txt'])
    assert.equal(auth.consumed, false)
    assert.ok(result.preview.some((line) => line.includes('a.txt')))
    assert.ok(result.preview.some((line) => line.includes('feat: add a')))
  })
})

test('T9-2 未授权（伪造授权）提交被拒绝且不写 ref', async () => {
  await withRepo(async (root) => {
    const wt = await makeWorktree(root)
    const before = git(root, 'rev-parse', wt.branch)
    await assert.rejects(
      () => commitWithAuthorization({ worktree: wt.path, branch: wt.branch }, [{ path: 'a.txt', content: 'A\n' }]),
      /未授权的提交请求/
    )
    assert.equal(git(root, 'rev-parse', wt.branch), before)
  })
})

test('T9-3 授权后仅对专用分支提交审批补丁并返回 SHA 与文件清单', async () => {
  await withRepo(async (root) => {
    const wt = await makeWorktree(root)
    const baseHead = git(wt.path, 'rev-parse', 'HEAD')
    const files = [{ path: 'a.txt', content: 'A\n' }, { path: 'base.txt', content: 'base-updated\n' }]
    writeFileSync(join(wt.path, 'a.txt'), 'A\n')
    writeFileSync(join(wt.path, 'base.txt'), 'base-updated\n')
    const { authorization } = await createCommitAuthorization({
      worktree: wt.path,
      branch: wt.branch,
      head: baseHead,
      message: 'feat: controlled commit',
      files
    })
    const result = await commitWithAuthorization(authorization, files)
    assert.match(result.sha, /^[0-9a-f]{40}$/)
    assert.equal(result.tree, authorization.expectedTree)
    assert.deepEqual(result.files, ['a.txt', 'base.txt'])
    assert.equal(git(root, 'rev-parse', wt.branch), result.sha)
    assert.equal(git(root, 'rev-parse', `${result.sha}^`), baseHead)
    assert.equal(git(root, 'log', '-1', '--format=%s', result.sha), 'feat: controlled commit')
    // 主 checkout 分支未动。
    assert.equal(git(root, 'rev-parse', 'master'), baseHead)
  })
})

test('T9-4 原 checkout 的 staged/unstaged/untracked 保持原样，专用分支只提交审批补丁', async () => {
  await withRepo(async (root) => {
    const wt = await makeWorktree(root)
    // 原 checkout 制造三种未提交状态。
    writeFileSync(join(root, 'staged.txt'), 'staged\n')
    git(root, 'add', 'staged.txt')
    writeFileSync(join(root, 'base.txt'), 'user-unstaged\n')
    writeFileSync(join(root, 'untracked.txt'), 'untracked\n')
    const beforeStatus = statusOf(root)
    const beforeIndex = git(root, 'diff', '--cached', '--name-only')
    const beforeHead = git(root, 'rev-parse', 'master')
    // 专用 worktree 只产生审批内改动。
    writeFileSync(join(wt.path, 'only-approved.txt'), 'approved\n')
    const files = [{ path: 'only-approved.txt', content: 'approved\n' }]
    const { authorization } = await createCommitAuthorization({
      worktree: wt.path,
      branch: wt.branch,
      head: git(wt.path, 'rev-parse', 'HEAD'),
      message: 'feat: approved only',
      files
    })
    const result = await commitWithAuthorization(authorization, files)
    assert.deepEqual(result.files, ['only-approved.txt'])
    // 原 checkout 完全不变。
    assert.equal(statusOf(root), beforeStatus)
    assert.equal(git(root, 'diff', '--cached', '--name-only'), beforeIndex)
    assert.equal(readFileSync(join(root, 'base.txt'), 'utf8'), 'user-unstaged\n')
    assert.equal(git(root, 'rev-parse', 'master'), beforeHead)
    // 提交内容只含审批补丁，不含用户的 staged/untracked。
    const treeFiles = git(root, 'ls-tree', '--name-only', `${result.sha}^{tree}`).split('\n')
    assert.ok(treeFiles.includes('only-approved.txt'))
    assert.ok(!treeFiles.includes('staged.txt'))
    assert.ok(!treeFiles.includes('untracked.txt'))
  })
})

test('T9-5 专用 worktree 存在未审批改动（混合归属）→ 拒绝且不写 ref', async () => {
  await withRepo(async (root) => {
    const wt = await makeWorktree(root)
    const before = git(root, 'rev-parse', wt.branch)
    writeFileSync(join(wt.path, 'a.txt'), 'A\n')
    writeFileSync(join(wt.path, 'external.txt'), 'external\n')
    await assert.rejects(
      () =>
        createCommitAuthorization({
          worktree: wt.path,
          branch: wt.branch,
          head: git(wt.path, 'rev-parse', 'HEAD'),
          message: 'feat: add a',
          files: [{ path: 'a.txt', content: 'A\n' }]
        }),
      /未审批|混合/
    )
    assert.equal(git(root, 'rev-parse', wt.branch), before)
  })
})

test('T9-6 过期 HEAD（审查后分支前进）→ 拒绝且不覆盖 ref', async () => {
  await withRepo(async (root) => {
    const wt = await makeWorktree(root)
    writeFileSync(join(wt.path, 'a.txt'), 'A\n')
    const files = [{ path: 'a.txt', content: 'A\n' }]
    const reviewedHead = git(wt.path, 'rev-parse', 'HEAD')
    const { authorization } = await createCommitAuthorization({
      worktree: wt.path,
      branch: wt.branch,
      head: reviewedHead,
      message: 'feat: add a',
      files
    })
    // 审查之后他人推进了分支。
    writeFileSync(join(wt.path, 'later.txt'), 'later\n')
    git(wt.path, 'add', 'later.txt')
    git(wt.path, 'commit', '-qm', 'later commit')
    const movedHead = git(wt.path, 'rev-parse', 'HEAD')
    assert.notEqual(movedHead, reviewedHead)
    await assert.rejects(() => commitWithAuthorization(authorization, files), /HEAD|漂移|过期/)
    assert.equal(git(root, 'rev-parse', wt.branch), movedHead)
    assert.equal(authorization.consumed, true)
  })
})

test('T9-7 审批内容漂移 → 拒绝且授权被释放（不可重试）', async () => {
  await withRepo(async (root) => {
    const wt = await makeWorktree(root)
    writeFileSync(join(wt.path, 'a.txt'), 'A\n')
    const { authorization } = await createCommitAuthorization({
      worktree: wt.path,
      branch: wt.branch,
      head: git(wt.path, 'rev-parse', 'HEAD'),
      message: 'feat: add a',
      files: [{ path: 'a.txt', content: 'A\n' }]
    })
    const before = git(root, 'rev-parse', wt.branch)
    await assert.rejects(
      () => commitWithAuthorization(authorization, [{ path: 'a.txt', content: 'B\n' }]),
      /漂移|摘要|不一致/
    )
    assert.equal(authorization.consumed, true)
    assert.equal(git(root, 'rev-parse', wt.branch), before)
    // 授权已释放：即便内容正确也不再可提交。
    await assert.rejects(
      () => commitWithAuthorization(authorization, [{ path: 'a.txt', content: 'A\n' }]),
      /已使用|授权/
    )
    assert.equal(git(root, 'rev-parse', wt.branch), before)
  })
})

test('T9-8 重复授权不写 ref', async () => {
  await withRepo(async (root) => {
    const wt = await makeWorktree(root)
    writeFileSync(join(wt.path, 'a.txt'), 'A\n')
    const files = [{ path: 'a.txt', content: 'A\n' }]
    const { authorization } = await createCommitAuthorization({
      worktree: wt.path,
      branch: wt.branch,
      head: git(wt.path, 'rev-parse', 'HEAD'),
      message: 'feat: add a',
      files
    })
    const first = await commitWithAuthorization(authorization, files)
    await assert.rejects(() => commitWithAuthorization(authorization, files), /已使用|授权/)
    assert.equal(git(root, 'rev-parse', wt.branch), first.sha)
  })
})

test('T9-9 待提交树与审批 tree 不一致 → 拒绝', async () => {
  await withRepo(async (root) => {
    const wt = await makeWorktree(root)
    writeFileSync(join(wt.path, 'a.txt'), 'A\n')
    const files = [{ path: 'a.txt', content: 'A\n' }]
    const { authorization } = await createCommitAuthorization({
      worktree: wt.path,
      branch: wt.branch,
      head: git(wt.path, 'rev-parse', 'HEAD'),
      message: 'feat: add a',
      files
    })
    const tampered = { ...authorization, expectedTree: '0'.repeat(40) }
    const before = git(root, 'rev-parse', wt.branch)
    await assert.rejects(() => commitWithAuthorization(tampered, files), /树|tree/)
    assert.equal(git(root, 'rev-parse', wt.branch), before)
  })
})

test('T9-10 存在提交钩子 → 拒绝受控提交（无法保留钩子语义）', async () => {
  await withRepo(async (root) => {
    const wt = await makeWorktree(root)
    const hookPath = join(root, '.git', 'hooks', 'pre-commit')
    writeFileSync(hookPath, '#!/bin/sh\nexit 0\n')
    chmodSync(hookPath, 0o755)
    writeFileSync(join(wt.path, 'a.txt'), 'A\n')
    await assert.rejects(
      () =>
        createCommitAuthorization({
          worktree: wt.path,
          branch: wt.branch,
          head: git(wt.path, 'rev-parse', 'HEAD'),
          message: 'feat: add a',
          files: [{ path: 'a.txt', content: 'A\n' }]
        }),
      /钩子|hook|签名/
    )
  })
})

test('T9-11 在原 checkout 直接提交 → 受控入口限制', async () => {
  await withRepo(async (root) => {
    writeFileSync(join(root, 'base.txt'), 'changed\n')
    await assert.rejects(
      () =>
        createCommitAuthorization({
          worktree: root,
          branch: 'master',
          head: git(root, 'rev-parse', 'HEAD'),
          message: 'feat: direct',
          files: [{ path: 'base.txt', content: 'changed\n' }]
        }),
      /受控|专用|worktree/
    )
  })
})