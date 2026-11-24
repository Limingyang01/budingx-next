import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import * as worktree from '../dist/git/worktree.js'
import { runWorktreeCommand } from '../dist/tui/worktree.js'

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
}

function commit(cwd, file, content) {
  writeFileSync(join(cwd, file), content)
  git(cwd, 'add', '--', file)
  git(cwd, 'commit', '-qm', file)
  return git(cwd, 'rev-parse', 'HEAD')
}

async function setup(t) {
  const base = mkdtempSync(join(tmpdir(), 'budingx sp009 worktree '))
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10 }))
  const cwd = join(base, 'repo')
  const root = join(base, 'worktrees')
  mkdirSync(cwd)
  git(cwd, 'init', '-q', '-b', 'trunk')
  git(cwd, 'config', 'user.email', 'worktree@example.test')
  git(cwd, 'config', 'user.name', 'Worktree fixture')
  git(cwd, 'config', 'commit.gpgSign', 'false')
  git(cwd, 'config', 'core.autocrlf', 'false')
  const initial = commit(cwd, 'base.txt', 'original\n')
  const options = { cwd, root, origin: { cwd, branch: 'trunk' } }
  const created = await runWorktreeCommand('create demo', options)
  assert.equal(created.ok, true, created.text)
  const source = realpathSync.native(join(root, 'repo', 'demo'))
  const run = (args, overrides = {}) => runWorktreeCommand(args, { ...options, ...overrides }, 'en')
  return { cwd, source, initial, run }
}

test('concurrent same-slug creation leaves the winning checkout intact', async (t) => {
  const { cwd, run } = await setup(t)
  const results = await Promise.all([run('create race'), run('create race')])
  assert.ok(results.some((result) => result.ok))
  const checkout = (await worktree.listWorktrees(cwd)).find((row) => row.branch === 'trunk-budingx/race')
  assert.ok(checkout)
  assert.equal(readFileSync(join(checkout.path, 'base.txt'), 'utf8'), 'original\n')
})

test('enter and create reuse an existing checkout under a legacy repo path only inside the managed root', async (t) => {
  const { cwd, source, run } = await setup(t)
  const root = dirname(dirname(source))
  const legacyParent = join(root, 'legacy-short-repo')
  mkdirSync(legacyParent)
  const legacy = join(legacyParent, 'demo')
  git(cwd, 'worktree', 'move', source, legacy)

  const checkedOut = []
  const entered = await run('enter demo', { enter: async (binding) => { checkedOut.push(binding.path) } })
  assert.equal(entered.ok, true, entered.text)
  assert.deepEqual(checkedOut, [realpathSync.native(legacy)])
  const created = await run('create demo')
  assert.equal(created.ok, true, created.text)
  assert.match(created.text, /legacy-short-repo/)
  assert.equal(existsSync(source), false)

  const outside = join(dirname(root), 'unmanaged', 'demo')
  mkdirSync(dirname(outside))
  git(cwd, 'worktree', 'move', legacy, outside)
  assert.equal((await run('enter demo', { enter: async () => assert.fail('Unexpected unmanaged checkout') })).ok, false)
  assert.equal((await run('create demo')).ok, false)
  assert.equal(existsSync(outside), true)
})

test('enter delegates the verified binding for an existing worktree and exit keeps it', async (t) => {
  const { cwd, source, run } = await setup(t)
  const processCwd = process.cwd()
  const bindings = []
  let exited = false
  const enter = async (binding) => {
    bindings.push(binding)
  }
  assert.equal((await run('enter missing', { enter })).ok, false)
  assert.equal((await run('enter ../demo', { enter })).ok, false)
  const entered = await run('enter demo', { enter })
  assert.equal(entered.ok, true, entered.text)
  assert.deepEqual(bindings, [{ path: source, branch: 'trunk-budingx/demo', baseBranch: 'trunk', originalCwd: cwd }])
  const exit = async () => {
    exited = true
  }
  assert.equal((await run('exit', { cwd: source, exit })).ok, true)
  assert.equal(exited, true)
  assert.equal(process.cwd(), processCwd)
  assert.ok(existsSync(source))
})

test('resume verifies the registered checkout, branch, and repository', async (t) => {
  const { cwd, source } = await setup(t)
  const binding = {
    path: source, branch: 'trunk-budingx/demo', baseBranch: 'trunk', originalCwd: cwd
  }
  assert.equal(worktree.verifyWorktreeSessionSync(binding, cwd), source)
  assert.throws(() => worktree.verifyWorktreeSessionSync({ ...binding, path: cwd }, cwd), /worktree.*身份|路径/)
  assert.throws(
    () => worktree.verifyWorktreeSessionSync({ ...binding, path: join(source, 'missing') }, cwd),
    /worktree.*身份|路径/
  )
  git(source, 'switch', '--detach', '-q')
  assert.throws(() => worktree.verifyWorktreeSessionSync(binding, cwd), /分支|身份/)
})

test('merge requires separate confirmation of both exact commits and fast-forwards the bound origin', async (t) => {
  const { cwd, source, initial, run } = await setup(t)
  const head = commit(source, 'feature.txt', 'feature\n')
  assert.equal((await run('merge demo')).ok, false)
  assert.equal((await run('merge demo', { confirm: async () => false })).ok, false)
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), initial)
  const result = await run('merge demo', {
    cwd: source,
    confirm: async ({ summary, preview }) => {
      const displayed = [summary, ...preview].join('\n')
      for (const value of ['trunk-budingx/demo', head, 'trunk', initial]) assert.ok(displayed.includes(value))
      return true
    }
  })
  assert.equal(result.ok, true, result.text)
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), head)
  assert.equal(git(source, 'rev-parse', 'HEAD'), head)
  assert.equal(git(cwd, 'status', '--porcelain'), '')
  assert.ok(existsSync(source))
})

test('diverged clean worktrees produce a normal merge commit even with configured squash', async (t) => {
  const { cwd, source, run } = await setup(t)
  const src = commit(source, 'feature.txt', 'feature\n')
  const dest = commit(cwd, 'target.txt', 'target\n')
  git(cwd, 'config', 'branch.trunk.mergeOptions', '--squash')
  const result = await run('merge demo', { confirm: async () => true })
  assert.equal(result.ok, true, result.text)
  assert.equal(git(cwd, 'show', '-s', '--format=%P', 'HEAD'), `${dest} ${src}`)
})

test('merge conflicts leave native Git state and both original commits in place', async (t) => {
  const { cwd, source, run } = await setup(t)
  const src = commit(source, 'base.txt', 'source version\n')
  const dest = commit(cwd, 'base.txt', 'target version\n')
  const result = await run('merge demo', { confirm: async () => true })
  assert.equal(result.ok, false)
  assert.match(result.text, /conflict|冲突/i)
  assert.match(result.text, /base\.txt/)
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), dest)
  assert.equal(git(cwd, 'rev-parse', 'MERGE_HEAD'), src)
  assert.equal(git(cwd, 'diff', '--name-only', '--diff-filter=U'), 'base.txt')
  assert.match(readFileSync(join(cwd, 'base.txt'), 'utf8'), /<<<<<<</)
  assert.equal(git(source, 'status', '--porcelain'), '')
})

test('merge refuses dirty paths, Git operations, or target branch drift before confirmation', async (t) => {
  const { cwd, source, run } = await setup(t)
  commit(source, 'feature.txt', 'feature\n')
  const options = { confirm: async () => { assert.fail('unsafe merge must not ask for approval') } }
  writeFileSync(join(cwd, 'stage.txt'), 'staged\n')
  git(cwd, 'add', 'stage.txt')
  assert.match((await run('merge demo', options)).text, /clean|干净/)
  assert.equal(git(cwd, 'diff', '--cached', '--name-only'), 'stage.txt')
  commit(cwd, 'stage.txt', 'staged\n')
  writeFileSync(join(source, 'untracked.txt'), 'untracked\n')
  assert.match((await run('merge demo', options)).text, /clean|干净/)
  commit(source, 'untracked.txt', 'untracked\n')
  git(source, 'bisect', 'start')
  assert.match((await run('merge demo', options)).text, /BISECT_START|进行中/)
  git(source, 'bisect', 'reset')
  git(cwd, 'switch', '-qc', 'other')
  assert.match((await run('merge demo', options)).text, /trunk/)
  assert.equal(git(cwd, 'branch', '--show-current'), 'other')
})

test('merge rechecks source, target and working tree after confirmation', async (t) => {
  const { cwd, source, initial, run } = await setup(t)
  commit(source, 'feature.txt', 'feature\n')
  const staleSource = await run('merge demo', {
    confirm: async () => {
      commit(source, 'extra.txt', 'extra\n')
      return true
    }
  })
  assert.equal(staleSource.ok, false)
  assert.match(staleSource.text, /changed|变化/)
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), initial)
  let newTarget
  const staleTarget = await run('merge demo', {
    confirm: async () => {
      newTarget = commit(cwd, 'target.txt', 'target\n')
      return true
    }
  })
  assert.equal(staleTarget.ok, false)
  assert.match(staleTarget.text, /changed|变化/)
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), newTarget)
  const dirtyTarget = await run('merge demo', {
    confirm: async () => {
      writeFileSync(join(cwd, 'during.txt'), 'staged\n')
      git(cwd, 'add', 'during.txt')
      return true
    }
  })
  assert.equal(dirtyTarget.ok, false)
  assert.match(dirtyTarget.text, /clean|干净/)
  assert.equal(git(cwd, 'diff', '--cached', '--name-only'), 'during.txt')
})

test('remove rejects an active checkout, preserves unmerged work, and checks approved refs', async (t) => {
  const { cwd, source, run } = await setup(t)
  const active = await run('remove demo --discard', {
    cwd: source,
    confirm: async () => { assert.fail('active worktree must not be offered for removal') }
  })
  assert.equal(active.ok, false)
  assert.match(active.text, /active worktree/)
  commit(source, 'feature.txt', 'feature\n')
  assert.equal((await run('remove demo', { confirm: async () => true })).ok, false)
  assert.equal((await run('remove demo --discard', { confirm: async () => false })).ok, false)
  const stale = await run('remove demo --discard', {
    confirm: async () => {
      commit(source, 'during.txt', 'new commit\n')
      return true
    }
  })
  assert.equal(stale.ok, false)
  assert.match(stale.text, /changed|变化/)
  assert.ok(existsSync(source))
  assert.equal(git(cwd, 'branch', '--list', 'trunk-budingx/demo').includes('trunk-budingx/demo'), true)
  assert.equal((await run('merge demo', { confirm: async () => true })).ok, true)
  assert.equal((await run(`remove "${source}"`)).ok, false)
  const removed = await run(`remove "${source}"`, { confirm: async () => true })
  assert.equal(removed.ok, true, removed.text)
  assert.equal(existsSync(source), false)
  assert.equal(git(cwd, 'branch', '--list', 'trunk-budingx/demo'), '')
})

test('merge and default removal preserve ignored local data', async (t) => {
  const { cwd, source, run } = await setup(t)
  commit(cwd, '.gitignore', 'local.txt\n')
  commit(source, 'local.txt', 'tracked by source\n')
  writeFileSync(join(cwd, 'local.txt'), 'ignored local data\n')
  const merged = await run('merge demo', { confirm: async () => true })
  assert.equal(merged.ok, false)
  assert.equal(readFileSync(join(cwd, 'local.txt'), 'utf8'), 'ignored local data\n')

  const safeMerge = await run('merge demo', {
    confirm: async () => {
      rmSync(join(cwd, 'local.txt'))
      return true
    }
  })
  assert.equal(safeMerge.ok, true, safeMerge.text)
  writeFileSync(join(cwd, '.git', 'info', 'exclude'), 'generated.txt\n')
  writeFileSync(join(source, 'generated.txt'), 'local output\n')
  const removed = await run('remove demo', { confirm: async () => true })
  assert.equal(removed.ok, false)
  assert.match(removed.text, /1 pending files, 0 unmerged commits/)
  assert.equal(readFileSync(join(source, 'generated.txt'), 'utf8'), 'local output\n')
})
