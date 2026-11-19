// SP004 T25 · worktree 工具表面（design §7.3）：EnterWorktree/ExitWorktree
// 的协议、会话记录与「删除必须宿主单次授权」语义。
// 证据层级：L1Git（真实临时仓库 + 真实 worktree）与 L0（Session 授权传递）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session } from '../../tui/dist/core/session.js'
import { createWorktreeTools } from '../../tui/dist/git/tools.js'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: true }
}

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
  const base = mkdtempSync(join(tmpdir(), 'budingx-worktree-tools-'))
  const repo = join(base, 'repo')
  const root = join(base, 'worktrees')
  mkdirSync(repo)
  git(repo, ['init', '-q'])
  git(repo, ['config', 'user.name', 'T25 Fixture'])
  git(repo, ['config', 'user.email', 't25@example.test'])
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

function contextOf({ approved = false, callId = 'call-wt' } = {}) {
  return {
    signal: new AbortController().signal,
    callId,
    ...(approved ? { approved: true } : {})
  }
}

function toolNamed(toolset, name) {
  const tool = toolset.tools.find((item) => item.name === name)
  assert.ok(tool, `缺少工具 ${name}`)
  return tool
}

async function enterOf(toolset, name) {
  return toolNamed(toolset, 'EnterWorktree').execute(
    name === undefined ? {} : { name },
    contextOf()
  )
}

test('T25-1 进入 worktree：独立目录与专用分支，主工作区改动不受影响（GW-05）', async (t) => {
  const fixture = makeRepo()
  t.after(() => fixture.cleanup())
  writeFileSync(join(fixture.repo, 'dirty.txt'), 'user change\n', 'utf8')

  const toolset = createWorktreeTools({ cwd: fixture.repo, root: fixture.root })
  const message = await enterOf(toolset, 'fix-auth')

  const session = toolset.session()
  assert.ok(session)
  assert.equal(session.path, join(realpathSync.native(fixture.root), 'repo', 'fix-auth'))
  assert.equal(existsSync(join(session.path, 'base.txt')), true)
  assert.match(session.branch, /-budingx\//)
  assert.match(message, /已进入隔离工作树/)
  assert.match(message, new RegExp(session.branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  // 主工作区未受进入影响：用户改动仍在，且没有新增文件。
  assert.equal(existsSync(join(fixture.repo, 'dirty.txt')), true)
  const status = git(fixture.repo, ['status', '--porcelain=v1', '-z'])
  assert.match(status, /dirty\.txt/)
})

test('T25-2 参数校验：未知字段、非法 name 与非法 action 均拒绝且不建目录', async (t) => {
  const fixture = makeRepo()
  t.after(() => fixture.cleanup())
  const toolset = createWorktreeTools({ cwd: fixture.repo, root: fixture.root })
  const enter = toolNamed(toolset, 'EnterWorktree')
  const exit = toolNamed(toolset, 'ExitWorktree')

  await assert.rejects(
    () => enter.execute({ name: 'ok', extra: true }, contextOf()),
    /未知参数：extra/
  )
  await assert.rejects(() => enter.execute({ name: '   ' }, contextOf()), /name 必须是非空字符串/)
  await assert.rejects(
    () => exit.execute({ action: 'delete' }, contextOf()),
    /action 只能是 keep 或 remove/
  )
  await assert.rejects(
    () => exit.execute({ discard_changes: 'yes' }, contextOf()),
    /discard_changes 必须是布尔值/
  )
  assert.equal(toolset.session(), undefined)
})

test('T25-3 退出 keep：保留 worktree 与分支并回到原目录（GW-06）', async (t) => {
  const fixture = makeRepo()
  t.after(() => fixture.cleanup())
  const toolset = createWorktreeTools({ cwd: fixture.repo, root: fixture.root })
  await enterOf(toolset, 'keep-me')
  const session = toolset.session()

  const message = await toolNamed(toolset, 'ExitWorktree').execute({}, contextOf())

  assert.match(message, /已退出隔离工作树（保留）/)
  assert.match(message, new RegExp(fixture.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.equal(existsSync(session.path), true)
  const branches = git(fixture.repo, ['branch', '--list', session.branch])
  assert.match(branches, new RegExp(session.branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.equal(toolset.session(), undefined)
})

test('T25-4 删除必须宿主授权：未获批准时拒绝且目录与分支保留（GW-06）', async (t) => {
  const fixture = makeRepo()
  t.after(() => fixture.cleanup())
  const toolset = createWorktreeTools({ cwd: fixture.repo, root: fixture.root })
  await enterOf(toolset, 'no-auth')
  const session = toolset.session()

  await assert.rejects(
    () => toolNamed(toolset, 'ExitWorktree').execute({ action: 'remove' }, contextOf({ approved: false })),
    /需要宿主单次授权/
  )
  assert.equal(existsSync(session.path), true)
  assert.match(git(fixture.repo, ['branch', '--list', session.branch]), new RegExp(session.branch))
  assert.ok(toolset.session())
})

test('T25-5 残留确认：未提供 discard_changes 拒绝并列出残留，补齐后删除并回执计数（GW-06）', async (t) => {
  const fixture = makeRepo()
  t.after(() => fixture.cleanup())
  const toolset = createWorktreeTools({ cwd: fixture.repo, root: fixture.root })
  await enterOf(toolset, 'residue')
  const session = toolset.session()
  writeFileSync(join(session.path, 'leftover.txt'), 'agent residue\n', 'utf8')

  await assert.rejects(
    () =>
      toolNamed(toolset, 'ExitWorktree').execute(
        { action: 'remove', discard_changes: false },
        contextOf({ approved: true })
      ),
    /未提交文件 1 个/
  )
  assert.equal(existsSync(session.path), true)

  const message = await toolNamed(toolset, 'ExitWorktree').execute(
    { action: 'remove', discard_changes: true },
    contextOf({ approved: true })
  )
  assert.match(message, /已退出并删除隔离工作树/)
  assert.match(message, /丢弃未提交文件：1 个/)
  assert.match(message, /丢弃未合并提交：0 个/)
  assert.equal(existsSync(session.path), false)
  assert.equal(git(fixture.repo, ['branch', '--list', session.branch]).trim(), '')
  assert.equal(toolset.session(), undefined)
})

test('T25-6 无残留的 remove：授权后删除并回执 0 计数（GW-06）', async (t) => {
  const fixture = makeRepo()
  t.after(() => fixture.cleanup())
  const toolset = createWorktreeTools({ cwd: fixture.repo, root: fixture.root })
  await enterOf(toolset, 'clean')
  const session = toolset.session()

  const message = await toolNamed(toolset, 'ExitWorktree').execute(
    { action: 'remove', discard_changes: true },
    contextOf({ approved: true })
  )
  assert.match(message, /丢弃未提交文件：0 个/)
  assert.equal(existsSync(session.path), false)
})

test('T25-7 会话级状态：未进入时拒绝退出，重复进入拒绝', async (t) => {
  const fixture = makeRepo()
  t.after(() => fixture.cleanup())
  const toolset = createWorktreeTools({ cwd: fixture.repo, root: fixture.root })

  await assert.rejects(
    () => toolNamed(toolset, 'ExitWorktree').execute({ action: 'keep' }, contextOf()),
    /当前没有进入隔离工作树/
  )
  await enterOf(toolset, 'once')
  await assert.rejects(() => enterOf(toolset, 'twice'), /已在隔离工作树中/)
})

test('T25-8 宿主授权传递：完全权限下 mandatoryApproval 仍强制审批，批准标记进入 ToolContext', async () => {
  const executed = []
  const guarded = {
    name: 'GuardedWrite',
    describe: () => '受保护写入',
    capability: () => 'write',
    target: () => ({ kind: 'none' }),
    mandatoryApproval: () => true,
    execute: async (input, context) => {
      executed.push({ input, approved: context.approved === true })
      return 'executed'
    }
  }
  const policy = {
    decide: () => ({ action: 'allow', reason: 'Full access mode: automatic' }),
    getMode: () => 'full_access',
    setMode: () => {},
    onModeChanged: () => {},
    remember: () => {},
    canRemember: () => false
  }

  async function run(decision) {
    const events = []
    const requests = []
    const script = [
      [
        { type: 'tool_call_delta', index: 0, callId: 'call-guard', nameDelta: 'GuardedWrite', argsDelta: '{}' },
        { type: 'message_completed', finishReason: 'tool_calls' }
      ],
      [{ type: 'message_completed', finishReason: 'stop' }]
    ]
    const session = new Session({
      provider: {
        async *stream() {
          const next = script.shift() ?? [{ type: 'message_completed', finishReason: 'stop' }]
          for (const event of next) yield event
        }
      },
      approval: {
        async request(request) {
          requests.push(request)
          return decision
        }
      },
      resolveSnapshot: () => SNAPSHOT,
      tools: [guarded],
      permissionPolicy: policy,
      onEvent: (event) => events.push(event)
    })
    session.submit('执行受保护写入')
    const deadline = Date.now() + 5000
    while (session.isBusy && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    session.dispose()
    return { events, requests }
  }

  const denied = await run({ outcome: 'deny', via: 'user' })
  assert.equal(denied.requests.length, 1, '完全权限下仍必须走审批通道')
  assert.equal(executed.length, 0)
  assert.equal(denied.events.filter((event) => event.type === 'tool_result').at(-1).isError, true)

  const allowed = await run({ outcome: 'allow', via: 'user' })
  assert.equal(allowed.requests.length, 1)
  assert.deepEqual(executed, [{ input: {}, approved: true }])
  const result = allowed.events.filter((event) => event.type === 'tool_result').at(-1)
  assert.equal(result.isError, false)
  assert.match(result.content, /executed/)
})