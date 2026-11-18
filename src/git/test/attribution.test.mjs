// SP004 T7 · 改动归属与提交范围分析（design §7.2，AC GW-02 / GW-03）。
// 证据层级 L1Git：临时仓库 fixture + 真实文件；断言全程没有 reset/stash/clean。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readGitStatus } from '../../tui/dist/git/status.js'
import { analyzeChanges, ownPathsFromCheckpoints } from '../../tui/dist/git/attribution.js'
import { createCheckpointStore } from '../../tui/dist/workspace/checkpoint.js'

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
  const base = mkdtempSync(join(tmpdir(), 'budingx-attr-'))
  const repo = join(base, 'repo')
  mkdirSync(repo)
  git(repo, ['init', '-q'])
  git(repo, ['config', 'user.email', 'agent@example.test'])
  git(repo, ['config', 'user.name', 'Agent'])
  for (const name of ['base.txt', 'user-staged.txt', 'user-unstaged.txt', 'agent.txt']) {
    writeFileSync(join(repo, name), `${name} v1\n`)
  }
  git(repo, ['add', '.'])
  git(repo, ['commit', '-qm', 'init'])
  return {
    repo,
    base,
    cleanup: () => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

/** Git 引用快照：用于证明归属分析没有改动 refs/索引。 */
function refsSnapshot(repo) {
  return {
    head: git(repo, ['rev-parse', 'HEAD']).trim(),
    refs: git(repo, ['for-each-ref', '--format=%(refname) %(objectname)']),
    index: git(repo, ['ls-files', '-s'])
  }
}

test('T7-1 用户三类改动与 Agent 改动分开归属（GW-02/GW-03）', async () => {
  const { repo, cleanup } = makeRepo()
  try {
    // 用户预置：staged / unstaged / untracked 各一。
    appendFileSync(join(repo, 'user-staged.txt'), 'user staged\n')
    git(repo, ['add', 'user-staged.txt'])
    appendFileSync(join(repo, 'user-unstaged.txt'), 'user unstaged\n')
    writeFileSync(join(repo, 'user-untracked.txt'), 'user untracked\n')

    // Agent 改另一个文件（checkpoint 记录其改动）。
    const store = createCheckpointStore()
    const before = 'agent.txt v1\n'
    const after = 'agent.txt v2\n'
    writeFileSync(join(repo, 'agent.txt'), after)
    store.record({
      path: join(repo, 'agent.txt'),
      operation: 'update',
      before,
      after,
      diff: [],
      fingerprintAfter: 'fp'
    })
    const ownPaths = ownPathsFromCheckpoints(store.changes(), repo)
    assert.deepEqual(ownPaths, ['agent.txt'])

    const status = await readGitStatus(repo)
    const analysis = analyzeChanges({ status, ownPaths })

    assert.deepEqual(analysis.include.map((entry) => entry.path), ['agent.txt'])
    assert.equal(analysis.include[0].operation, 'modify')
    assert.equal(analysis.include[0].mixed, undefined)
    assert.deepEqual(analysis.userOwned, [
      'user-staged.txt',
      'user-unstaged.txt',
      'user-untracked.txt'
    ])
    assert.deepEqual(analysis.mixed, [])
    assert.deepEqual(analysis.conflicted, [])
  } finally {
    cleanup()
  }
})

test('T7-2 归属分析不 reset/stash/clean：refs、索引与工作区保持原样（GW-02）', async () => {
  const { repo, cleanup } = makeRepo()
  try {
    appendFileSync(join(repo, 'user-staged.txt'), 'staged\n')
    git(repo, ['add', 'user-staged.txt'])
    appendFileSync(join(repo, 'user-unstaged.txt'), 'unstaged\n')
    writeFileSync(join(repo, 'user-untracked.txt'), 'untracked\n')
    appendFileSync(join(repo, 'agent.txt'), 'agent\n')

    const before = refsSnapshot(repo)
    const status = await readGitStatus(repo)
    analyzeChanges({ status, ownPaths: ['agent.txt'] })
    const after = refsSnapshot(repo)
    assert.deepEqual(after, before)

    // 用户未跟踪文件仍在，且内容未被 touch。
    const statusAfter = await readGitStatus(repo)
    assert.ok(statusAfter.untracked.includes('user-untracked.txt'))
  } finally {
    cleanup()
  }
})

test('T7-3 同文件混合修改：只出现一次并标注混合（GW-03）', async () => {
  const { repo, cleanup } = makeRepo()
  try {
    // 用户先改 base.txt（未暂存），Agent 又在同一文件继续改。
    appendFileSync(join(repo, 'base.txt'), 'user line\n')
    appendFileSync(join(repo, 'base.txt'), 'agent line\n')

    const status = await readGitStatus(repo)
    const analysis = analyzeChanges({
      status,
      ownPaths: ['base.txt'],
      userPaths: ['base.txt']
    })

    assert.equal(analysis.include.length, 1)
    assert.equal(analysis.include[0].path, 'base.txt')
    assert.equal(analysis.include[0].mixed, true)
    assert.ok(analysis.mixed.includes('base.txt'))
    const allPaths = [...analysis.include.map((entry) => entry.path), ...analysis.userOwned]
    assert.equal(allPaths.filter((path) => path === 'base.txt').length, 1, '混合文件只出现一次')
  } finally {
    cleanup()
  }
})

test('T7-4 冲突文件不进入可提交范围，单独报告', async () => {
  const { repo, cleanup } = makeRepo()
  try {
    // 构造未解决冲突：两个分支改同一文件。
    git(repo, ['checkout', '-qb', 'side'])
    writeFileSync(join(repo, 'base.txt'), 'side\n')
    git(repo, ['commit', '-qam', 'side'])
    git(repo, ['checkout', '-q', 'master'])
    writeFileSync(join(repo, 'base.txt'), 'master\n')
    git(repo, ['commit', '-qam', 'master'])
    const merge = spawnSync('git', ['--no-optional-locks', 'merge', 'side'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: repo }
    })
    assert.notEqual(merge.status, 0, '构造冲突应失败')

    const status = await readGitStatus(repo)
    assert.deepEqual(status.conflicted, ['base.txt'])
    const analysis = analyzeChanges({ status, ownPaths: ['base.txt'] })
    assert.deepEqual(analysis.conflicted, ['base.txt'])
    assert.deepEqual(analysis.include, [], '冲突文件不得进入可提交范围')
    assert.deepEqual(analysis.userOwned, [])
  } finally {
    cleanup()
  }
})

test('T7-5 Agent 声明的路径已无改动：记为 untouched，不伪造补丁', async () => {
  const { repo, cleanup } = makeRepo()
  try {
    const status = await readGitStatus(repo)
    const analysis = analyzeChanges({ status, ownPaths: ['agent.txt'] })
    assert.deepEqual(analysis.include, [])
    assert.deepEqual(analysis.untouched, ['agent.txt'])
    assert.deepEqual(analysis.userOwned, [])
  } finally {
    cleanup()
  }
})

test('T7-6 新增文件与删除文件的操作类型可区分', async () => {
  const { repo, cleanup } = makeRepo()
  try {
    writeFileSync(join(repo, 'agent-new.txt'), 'new\n')
    rmSync(join(repo, 'agent.txt'))
    const status = await readGitStatus(repo)
    const analysis = analyzeChanges({ status, ownPaths: ['agent-new.txt', 'agent.txt'] })
    const byPath = new Map(analysis.include.map((entry) => [entry.path, entry.operation]))
    assert.equal(byPath.get('agent-new.txt'), 'add')
    assert.equal(byPath.get('agent.txt'), 'delete')
  } finally {
    cleanup()
  }
})

test('T7-7 checkpoint 记录转仓库相对路径：越界路径被忽略', () => {
  const store = createCheckpointStore()
  const root = join(tmpdir(), 'budingx-attr-root')
  store.record({ path: join(root, 'a', 'b.txt'), operation: 'update', after: 'x', diff: [], fingerprintAfter: 'fp' })
  store.record({ path: join(root, 'c.txt'), operation: 'create', after: 'y', diff: [], fingerprintAfter: 'fp' })
  store.record({ path: join(tmpdir(), 'outside.txt'), operation: 'update', after: 'z', diff: [], fingerprintAfter: 'fp' })
  assert.deepEqual(ownPathsFromCheckpoints(store.changes(), root), ['a/b.txt', 'c.txt'])
})