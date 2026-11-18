// SP004 T6 · Git 只读状态识别（design §7.1）。
// 证据层级 L1Git：全部在临时仓库 fixture 中执行，不在用户真实仓库做任何写操作。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readGitStatus } from '../../tui/dist/git/status.js'
import { parsePorcelain } from '../../tui/dist/git/porcelain.js'

function git(cwd, args) {
  const result = spawnSync('git', ['--no-optional-locks', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: cwd }
  })
  assert.equal(result.status, 0, `git ${args.join(' ')} 失败：${result.stderr}`)
  return result.stdout
}

/** 建一个带初始提交的临时仓库。 */
function makeRepo() {
  const base = mkdtempSync(join(tmpdir(), 'budingx-git-status-'))
  const repo = join(base, 'repo')
  mkdirSync(repo)
  git(repo, ['init', '-q'])
  git(repo, ['config', 'user.email', 'agent@example.test'])
  git(repo, ['config', 'user.name', 'Agent'])
  writeFileSync(join(repo, 'base.txt'), 'base\n')
  git(repo, ['add', 'base.txt'])
  git(repo, ['commit', '-qm', 'init'])
  return {
    repo,
    base,
    cleanup: () => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

test('T6-1 空仓库：isRepository=true 且三类改动为空', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'budingx-git-empty-'))
  try {
    git(empty, ['init', '-q'])
    const status = await readGitStatus(empty)
    assert.equal(status.isRepository, true)
    assert.equal(status.gitAvailable, true)
    assert.deepEqual(status.staged, [])
    assert.deepEqual(status.unstaged, [])
    assert.deepEqual(status.untracked, [])
    assert.deepEqual(status.conflicted, [])
  } finally {
    rmSync(empty, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('T6-2 三类改动齐备：staged/unstaged/untracked 分别计数', async () => {
  const { repo, cleanup } = makeRepo()
  try {
    // staged：已提交文件的修改并暂存
    writeFileSync(join(repo, 'base.txt'), 'base changed\n')
    git(repo, ['add', 'base.txt'])
    // unstaged：新文件暂存后又改工作区
    writeFileSync(join(repo, 'both.txt'), 'v1\n')
    git(repo, ['add', 'both.txt'])
    writeFileSync(join(repo, 'both.txt'), 'v2\n')
    // untracked：未跟踪文件
    writeFileSync(join(repo, 'plain.txt'), 'x\n')

    const status = await readGitStatus(repo)
    assert.equal(status.isRepository, true)
    assert.deepEqual(status.staged.sort(), ['base.txt', 'both.txt'])
    assert.deepEqual(status.unstaged, ['both.txt'])
    assert.deepEqual(status.untracked, ['plain.txt'])
    assert.equal(status.head?.length, 40)
    assert.ok(status.branch, '应报告当前分支名')
  } finally {
    cleanup()
  }
})

test('T6-3 路径含空格与中文：-z 解析不误切', async () => {
  const { repo, cleanup } = makeRepo()
  try {
    writeFileSync(join(repo, '空 格 文件.txt'), 'cn\n')
    writeFileSync(join(repo, 'a b c.txt'), 'space\n')
    const status = await readGitStatus(repo)
    assert.deepEqual(status.untracked.sort(), ['a b c.txt', '空 格 文件.txt'])
  } finally {
    cleanup()
  }
})

test('T6-4 非 Git 目录：isRepository=false，不伪造状态', async () => {
  const plain = mkdtempSync(join(tmpdir(), 'budingx-plain-'))
  try {
    const status = await readGitStatus(plain)
    assert.equal(status.isRepository, false)
    assert.equal(status.gitAvailable, true)
    assert.deepEqual(status.staged, [])
    assert.deepEqual(status.unstaged, [])
    assert.deepEqual(status.untracked, [])
  } finally {
    rmSync(plain, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('T6-5 git 不可用：gitAvailable=false 且不抛未捕获异常', async () => {
  const { repo, cleanup } = makeRepo()
  try {
    const status = await readGitStatus(repo, { env: { PATH: '', PATHEXT: '' } })
    assert.equal(status.gitAvailable, false)
    assert.equal(status.isRepository, false)
  } finally {
    cleanup()
  }
})

test('T6-6 porcelain 纯解析：冲突、重命名与忽略项', () => {
  const raw = [
    '## main...origin/main [ahead 2, behind 1]',
    'M  staged.txt',
    ' M unstaged.txt',
    'MM both.txt',
    '?? new.txt',
    'UU conflict.txt',
    'DD both-deleted.txt',
    'R  renamed-new.txt',
    'renamed-old.txt',
    '!! ignored.txt',
    ''
  ].join('\0')
  const parsed = parsePorcelain(raw)
  assert.deepEqual(parsed.staged.sort(), ['both.txt', 'renamed-new.txt', 'staged.txt'])
  assert.deepEqual(parsed.unstaged.sort(), ['both.txt', 'unstaged.txt'])
  assert.deepEqual(parsed.untracked, ['new.txt'])
  assert.deepEqual(parsed.conflicted.sort(), ['both-deleted.txt', 'conflict.txt'])
  assert.deepEqual(parsed.branch, { name: 'main', ahead: 2, behind: 1 })
})

test('T6-7 detached HEAD：分支缺省但 HEAD 仍报告', async () => {
  const { repo, cleanup } = makeRepo()
  try {
    git(repo, ['checkout', '-q', '--detach'])
    const status = await readGitStatus(repo)
    assert.equal(status.isRepository, true)
    assert.equal(status.head?.length, 40)
    assert.equal(status.branch, undefined)
  } finally {
    cleanup()
  }
})