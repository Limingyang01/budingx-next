// SP004 T23 · Git 状态增强（design §7.1，AC GW-01）。
// 证据层级 L1Git：临时仓库 fixture；远端用本地 bare 仓库，不接触网络与用户真实仓库。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readGitStatus, sanitizeRemoteUrl } from '../../tui/dist/git/status.js'

function git(cwd, args, env) {
  const result = spawnSync('git', ['--no-optional-locks', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: cwd, ...env }
  })
  assert.equal(result.status, 0, `git ${args.join(' ')} 失败：${result.stderr}`)
  return result.stdout
}

function makeRepo(prefix = 'budingx-status-') {
  const base = mkdtempSync(join(tmpdir(), prefix))
  const repo = join(base, 'repo')
  mkdirSync(repo)
  git(repo, ['init', '-q'])
  git(repo, ['config', 'user.name', 'T23 Fixture'])
  git(repo, ['config', 'user.email', 't23@example.test'])
  git(repo, ['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(repo, 'a.txt'), 'alpha\n', 'utf8')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', 'initial'])
  return {
    base,
    repo,
    cleanup() {
      rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    }
  }
}

test('T23-1 所有 git 调用带 --no-optional-locks（GW-01）', async () => {
  const { base, repo, cleanup } = makeRepo()
  try {
    const tracePath = join(base, 'trace.json')
    const status = await readGitStatus(repo, {
      env: { ...process.env, GIT_TRACE2_EVENT: tracePath.split('\\').join('/') }
    })
    assert.equal(status.isRepository, true)
    assert.equal(existsSync(tracePath), true, 'GIT_TRACE2_EVENT 必须产生跟踪文件')
    const events = readFileSync(tracePath, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return undefined
        }
      })
      .filter((event) => event !== undefined && Array.isArray(event.argv))
    const statusArgv = events.map((event) => event.argv).find((argv) => argv.includes('status'))
    assert.ok(statusArgv !== undefined, '跟踪记录里应有 status 调用')
    assert.ok(statusArgv.includes('--no-optional-locks'), `status 调用缺少 --no-optional-locks：${statusArgv.join(' ')}`)
    for (const argv of events.map((event) => event.argv)) {
      if (argv.includes('rev-parse') || argv.includes('worktree') || argv.includes('config') || argv.includes('remote') || argv.includes('branch')) {
        assert.ok(argv.includes('--no-optional-locks'), `git ${argv.slice(1).join(' ')} 缺少 --no-optional-locks`)
      }
    }
  } finally {
    cleanup()
  }
})

test('T23-2 远端地址脱敏：凭据不出仓，ssh/scp 形式原样（GW-01）', async () => {
  assert.equal(
    sanitizeRemoteUrl('https://user:secret-token@github.com/org/repo.git'),
    'https://github.com/org/repo.git'
  )
  assert.equal(sanitizeRemoteUrl('https://github.com/org/repo.git'), 'https://github.com/org/repo.git')
  assert.equal(sanitizeRemoteUrl('git@github.com:org/repo.git'), 'git@github.com:org/repo.git')
  assert.equal(sanitizeRemoteUrl('ssh://git@github.com/org/repo.git'), 'ssh://github.com/org/repo.git')

  const { repo, cleanup } = makeRepo()
  try {
    git(repo, ['remote', 'add', 'origin', 'https://user:secret-token@example.test/org/repo.git'])
    const status = await readGitStatus(repo)
    assert.equal(status.remoteUrl, 'https://example.test/org/repo.git')
    assert.equal(status.remoteUrl.includes('secret-token'), false, '脱敏后不得包含 token')
  } finally {
    cleanup()
  }
})

test('T23-3 worktreeCount 反映仓库内 worktree 数量（GW-01）', async () => {
  const { base, repo, cleanup } = makeRepo()
  try {
    const before = await readGitStatus(repo)
    assert.equal(before.worktreeCount, 1)
    const worktreePath = join(base, 'linked')
    git(repo, ['worktree', 'add', '-q', worktreePath, '-b', 'linked-branch'])
    const after = await readGitStatus(repo)
    assert.equal(after.worktreeCount, 2)
  } finally {
    cleanup()
  }
})

test('T23-4 isHeadOnRemote：无远端省略，已推送为 true，本地新提交为 false（GW-01）', async () => {
  const { base, repo, cleanup } = makeRepo()
  try {
    const noRemote = await readGitStatus(repo)
    assert.equal(noRemote.remoteUrl, undefined)
    assert.equal(noRemote.isHeadOnRemote, undefined, '没有远端时不伪造推送状态')

    const bare = join(base, 'origin.git')
    git(base, ['init', '--bare', '-q', bare])
    git(repo, ['remote', 'add', 'origin', bare])
    git(repo, ['push', '-q', '-u', 'origin', 'HEAD'])
    const pushed = await readGitStatus(repo)
    assert.equal(pushed.remoteUrl, bare)
    assert.equal(pushed.isHeadOnRemote, true)

    writeFileSync(join(repo, 'b.txt'), 'beta\n', 'utf8')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', 'local only'])
    const advanced = await readGitStatus(repo)
    assert.equal(advanced.isHeadOnRemote, false)
  } finally {
    cleanup()
  }
})