// SP004 T23 · worktree 退出与 slug 校验（design §7.3，AC GW-05/GW-06/GW-07）。
// 证据层级 L1Git：临时仓库 fixture；删除授权由宿主签发，模型参数本身无授权效力。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  enterWorktree,
  exitWorktree,
  prepareWorktreeRemoval,
  repoSlug,
  validateWorktreeSlug
} from '../../tui/dist/git/worktree.js'

function git(cwd, args) {
  const result = spawnSync('git', ['--no-optional-locks', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: cwd }
  })
  assert.equal(result.status, 0, `git ${args.join(' ')} 失败：${result.stderr}`)
  return result.stdout
}

function makeRepo() {
  const base = mkdtempSync(join(tmpdir(), 'budingx-worktree-exit-'))
  const repo = join(base, 'repo')
  const root = join(base, 'worktrees')
  mkdirSync(repo)
  git(repo, ['init', '-q'])
  git(repo, ['config', 'user.name', 'T23 Fixture'])
  git(repo, ['config', 'user.email', 't23@example.test'])
  git(repo, ['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(repo, 'base.txt'), 'base\n', 'utf8')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', 'initial'])
  return {
    base,
    repo,
    root,
    cleanup() {
      spawnSync('git', ['--no-optional-locks', 'worktree', 'prune'], { cwd: repo, encoding: 'utf8' })
      rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    }
  }
}

async function authorizationOf(entered, discardChanges) {
  return (await prepareWorktreeRemoval(entered, discardChanges)).authorization
}

test('T23-5 slug 校验：总长 ≤64、分段非空合法、禁 . 与 ..（GW-07）', async () => {
  assert.equal(validateWorktreeSlug('fix-auth.v2').ok, true)
  assert.equal(validateWorktreeSlug('feature/one_two').ok, true)
  const invalid = [
    ['x'.repeat(65), /64/],
    ['a//b', /空段/],
    ['/abs', /空段/],
    ['trail/', /空段/],
    ['../evil', /不允许|非法字符/],
    ['a/../b', /不允许/],
    ['.', /不允许/],
    ['..', /不允许/],
    ['', /空/],
    ['bad slug', /非法字符/]
  ]
  for (const [slug, pattern] of invalid) {
    const result = validateWorktreeSlug(slug)
    assert.equal(result.ok, false, `slug ${JSON.stringify(slug)} 应被拒绝`)
    assert.match(result.reason, pattern, `slug ${JSON.stringify(slug)} 的拒绝原因应说明规则`)
  }
  // 目录 slug 同样受 F-18 约束：超长仓库名不做静默截断，而是明确拒绝。
  const { base, cleanup } = makeRepo()
  try {
    assert.throws(() => repoSlug(join(base, 'x'.repeat(65))), /64/)
  } finally {
    cleanup()
  }
})

test('T23-6 remove 缺少宿主授权：拒绝删除且目录与分支保持原样（GW-06）', async () => {
  const { repo, root, cleanup } = makeRepo()
  try {
    const entered = await enterWorktree({ cwd: repo, name: 'no-auth', root })
    await assert.rejects(
      () => exitWorktree({ ...entered, originalCwd: repo, action: 'remove' }),
      /授权/
    )
    assert.equal(existsSync(entered.path), true, '未经授权不得删除 worktree')
    assert.ok(git(repo, ['branch', '--list', entered.branch]).trim().length > 0)
  } finally {
    cleanup()
  }
})

test('T23-7 remove 有未提交文件且缺 discard_changes：拒绝并列出残留（GW-06）', async () => {
  const { repo, root, cleanup } = makeRepo()
  try {
    const entered = await enterWorktree({ cwd: repo, name: 'dirty', root })
    writeFileSync(join(entered.path, 'dirty.txt'), 'dirty\n', 'utf8')
    const authorization = await authorizationOf(entered, true)
    await assert.rejects(
      () =>
        exitWorktree({
          ...entered,
          originalCwd: repo,
          action: 'remove',
          authorization
        }),
      (error) => {
        assert.match(error.message, /残留/)
        assert.match(error.message, /未提交文件 1 个/)
        return true
      }
    )
    assert.equal(existsSync(join(entered.path, 'dirty.txt')), true)
  } finally {
    cleanup()
  }
})

test('T23-8 remove 有未合并提交：缺弃置意图拒绝，完整授权后删除并回执计数（GW-06）', async () => {
  const { repo, root, cleanup } = makeRepo()
  try {
    const entered = await enterWorktree({ cwd: repo, name: 'ahead', root })
    writeFileSync(join(entered.path, 'feature.txt'), 'feature\n', 'utf8')
    git(entered.path, ['add', '-A'])
    git(entered.path, ['commit', '-q', '-m', 'feature work'])

    const authorization = await authorizationOf(entered, true)
    await assert.rejects(
      () =>
        exitWorktree({
          ...entered,
          originalCwd: repo,
          action: 'remove',
          authorization
        }),
      /未合并提交 1 个/
    )
    assert.equal(existsSync(entered.path), true)

    const result = await exitWorktree({
      ...entered,
      originalCwd: repo,
      action: 'remove',
      discard_changes: true,
      authorization: await authorizationOf(entered, true)
    })
    assert.equal(result.action, 'remove')
    assert.equal(result.discardedFiles, 0)
    assert.equal(result.discardedCommits, 1)
    assert.equal(existsSync(entered.path), false, '授权后 worktree 必须被删除')
    assert.equal(git(repo, ['branch', '--list', entered.branch]).trim(), '', '专用分支必须被删除')
  } finally {
    cleanup()
  }
})

test('T23-9 keep：目录与专用分支保留，cwd 回到原工作区（GW-06）', async () => {
  const { repo, root, cleanup } = makeRepo()
  try {
    const entered = await enterWorktree({ cwd: repo, name: 'kept', root })
    const exited = await exitWorktree({ ...entered, originalCwd: repo })
    assert.equal(exited.action, 'keep')
    assert.equal(exited.cwd, repo)
    assert.equal(existsSync(entered.path), true)
    assert.ok(git(repo, ['branch', '--list', entered.branch]).trim().length > 0)
  } finally {
    cleanup()
  }
})

test('T23-10 身份无法复核：拒绝删除并列出可确认残留（GW-06）', async () => {
  const { repo, root, cleanup } = makeRepo()
  try {
    const entered = await enterWorktree({ cwd: repo, name: 'vanished', root })
    const authorization = await authorizationOf(entered, true)
    rmSync(entered.path, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    git(repo, ['worktree', 'prune'])
    await assert.rejects(
      () =>
        exitWorktree({
          ...entered,
          originalCwd: repo,
          action: 'remove',
          discard_changes: true,
          authorization
        }),
      (error) => {
        assert.match(error.message, /无法复核/)
        assert.match(error.message, /残留/)
        assert.ok(error.message.includes(entered.path), '错误必须列出可确认的残留路径')
        assert.ok(error.message.includes(entered.branch), '错误必须列出可确认的残留分支')
        return true
      }
    )
  } finally {
    cleanup()
  }
})

test('T23-11 删除审批后同一未提交文件的内容变化，拒绝并保留工作树', async () => {
  const { repo, root, cleanup } = makeRepo()
  try {
    const entered = await enterWorktree({ cwd: repo, name: 'drift', root })
    const file = join(entered.path, 'dirty.txt')
    writeFileSync(file, 'approved residue\n')
    const { authorization, preview } = await prepareWorktreeRemoval(entered, true)
    assert.ok(preview.some((line) => line.includes('dirty.txt')))
    writeFileSync(file, 'new user work after approval\n')
    await assert.rejects(
      () => exitWorktree({ ...entered, action: 'remove', discard_changes: true, authorization }),
      /漂移/
    )
    assert.ok(existsSync(file))
    assert.ok(git(repo, ['branch', '--list', entered.branch]).trim())
  } finally {
    cleanup()
  }
})
