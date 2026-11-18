// SP004 T8 · worktree 进出（design §7.3，AC GW-05/GW-06/GW-07）。
// 证据层级 L1Git：临时仓库 fixture；主工作区与隔离目录的真实 git 状态分别断言。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readGitStatus } from '../../tui/dist/git/status.js'
import { enterWorktree, exitWorktree } from '../../tui/dist/git/worktree.js'

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
  const base = mkdtempSync(join(tmpdir(), 'budingx-worktree-'))
  const repo = join(base, 'repo')
  mkdirSync(repo)
  git(repo, ['init', '-q'])
  git(repo, ['config', 'user.email', 'agent@example.test'])
  git(repo, ['config', 'user.name', 'Agent'])
  writeFileSync(join(repo, 'base.txt'), 'v1\n')
  git(repo, ['add', '.'])
  git(repo, ['commit', '-qm', 'init'])
  return {
    repo,
    root: join(base, 'worktrees'),
    base,
    cleanup: () => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

test('T8-1 进入 worktree：主工作区状态不变，新目录独立（GW-05）', async () => {
  const { repo, root, cleanup } = makeRepo()
  try {
    // 主工作区预置 staged + unstaged + untracked。
    writeFileSync(join(repo, 'staged.txt'), 's\n')
    git(repo, ['add', 'staged.txt'])
    appendFileSync(join(repo, 'base.txt'), 'unstaged\n')
    writeFileSync(join(repo, 'untracked.txt'), 'u\n')
    const before = await readGitStatus(repo)

    const entered = await enterWorktree({ cwd: repo, name: 'demo', root })
    assert.ok(existsSync(entered.path), 'worktree 目录应存在')
    assert.equal(entered.branch, 'master-budingx/demo')
    assert.equal(entered.baseBranch, 'master')
    assert.notEqual(entered.path, repo)

    const after = await readGitStatus(repo)
    assert.deepEqual(after.staged, before.staged)
    assert.deepEqual(after.unstaged, before.unstaged)
    assert.deepEqual(after.untracked, before.untracked)

    // 新目录独立：在其中写文件不影响主工作区。
    writeFileSync(join(entered.path, 'inside.txt'), 'i\n')
    const mainAfter = await readGitStatus(repo)
    assert.ok(!mainAfter.untracked.includes('inside.txt'))
    const insideStatus = await readGitStatus(entered.path)
    assert.deepEqual(insideStatus.untracked, ['inside.txt'])
  } finally {
    cleanup()
  }
})

test('T8-2 退出 worktree：回到原 cwd，目录与分支保留（GW-06）', async () => {
  const { repo, root, cleanup } = makeRepo()
  try {
    const entered = await enterWorktree({ cwd: repo, name: 'keep-me', root })
    const exited = exitWorktree({ ...entered, originalCwd: repo })
    assert.equal(exited.cwd, repo)
    assert.equal(exited.action, 'keep')
    assert.ok(existsSync(entered.path), '默认 keep 不删除隔离目录')
    assert.equal(git(repo, ['branch', '--list', entered.branch]).trim().length > 0, true)
  } finally {
    cleanup()
  }
})

test('T8-3 名称冲突：明确失败且不留半成品（GW-07）', async () => {
  const { repo, root, cleanup } = makeRepo()
  try {
    git(repo, ['branch', 'master-budingx/taken'])
    const expectedPath = join(root, 'repo', 'taken')
    await assert.rejects(
      () => enterWorktree({ cwd: repo, name: 'taken', root }),
      /已存在|冲突/
    )
    assert.equal(existsSync(expectedPath), false, '失败后不得留下半成品目录')
  } finally {
    cleanup()
  }
})

test('T8-4 非 Git 目录：明确失败（GW-07/GW-08）', async () => {
  const base = mkdtempSync(join(tmpdir(), 'budingx-worktree-plain-'))
  try {
    await assert.rejects(
      () => enterWorktree({ cwd: base, name: 'demo', root: join(base, 'wt') }),
      /非 Git 仓库/
    )
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('T8-5 非法名称：路径穿越与分隔符一律拒绝', async () => {
  const { repo, root, cleanup } = makeRepo()
  try {
    for (const name of ['../evil', 'a/b', '.', '..', 'A-Upper', 'x'.repeat(42), '']) {
      await assert.rejects(
        () => enterWorktree({ cwd: repo, name, root }),
        /非法名称|名称/,
        `名称 ${JSON.stringify(name)} 应被拒绝`
      )
    }
    assert.equal(existsSync(join(root, 'repo')), false, '非法名称不得创建任何目录')
  } finally {
    cleanup()
  }
})

test('T8-6 重复进入同名 worktree：核对身份后恢复复用（F-18）', async () => {
  const { repo, root, cleanup } = makeRepo()
  try {
    const first = await enterWorktree({ cwd: repo, name: 'reuse', root })
    const second = await enterWorktree({ cwd: repo, name: 'reuse', root })
    assert.equal(second.path, first.path)
    assert.equal(second.branch, first.branch)
    const list = git(repo, ['worktree', 'list', '--porcelain'])
    assert.equal(list.split('\n').filter((line) => line.startsWith('worktree ')).length, 2)
  } finally {
    cleanup()
  }
})