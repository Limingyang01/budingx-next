// SP004 T14 · 隔离项目端到端闭环（design §5、§6.3、§7.2；AC CT-01、CT-08、GW-02、GW-03、TP-05）。
// 证据层级 L1/L2：真实 Git 仓库 + 真实 workspace 文件 + 真实子进程；唯一假件是模型脚本。
// 场景一：在预置了用户改动与草稿的隔离仓库内完成「读→改→跑测试→完成声明」，
//         归属分析必须只把 Agent 的文件纳入提交范围，用户文件逐字节不变。
// 场景二：计划批准后目标文件被外部改动，首个副作用调用必须被拒并列出漂移项。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session } from '../../tui/dist/core/session.js'
import { createWorkspace } from '../../tui/dist/workspace/paths.js'
import { createWorkspaceTools } from '../../tui/dist/workspace/tools.js'
import { createPermissionPolicy } from '../../tui/dist/workspace/policy.js'
import { createCommandRunner } from '../../tui/dist/exec/runner.js'
import { createExecTools } from '../../tui/dist/exec/tools.js'
import { createSandboxPolicy } from '../../tui/dist/exec/sandbox-policy.js'
import { createCodingTaskTracker } from '../../tui/dist/core/coding.js'
import { createPlanStore } from '../../tui/dist/plan/store.js'
import { validateBeforeExecute } from '../../tui/dist/plan/validate.js'
import { readGitStatus } from '../../tui/dist/git/status.js'
import { analyzeChanges, ownPathsFromCheckpoints } from '../../tui/dist/git/attribution.js'
import { contentFingerprint } from '../../tui/dist/workspace/write.js'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: true }
}

const verifiedBackend = {
  id: 'synthetic-backend',
  label: '合成验收后端',
  verified: true,
  capabilities: {
    allowWrite: [],
    denyWrite: [],
    allowRead: [],
    denyRead: [],
    networkDomains: [],
    canEnforceNetwork: true
  }
}

const BUGGY = 'export function add(a, b) {\n  return a * b\n}\n'
const FIXED = 'export function add(a, b) {\n  return a + b\n}\n'

function scriptProvider(script) {
  return {
    async *stream() {
      const events = script.shift() ?? [{ type: 'message_completed', finishReason: 'stop' }]
      for (const event of events) yield event
    }
  }
}

function toolCallTurn(callId, name, args) {
  return [
    {
      type: 'tool_call_delta',
      index: 0,
      callId,
      nameDelta: name,
      argsDelta: JSON.stringify(args)
    },
    { type: 'message_completed', finishReason: 'tool_calls' }
  ]
}

function textTurn(text) {
  return [
    { type: 'text_delta', text },
    { type: 'message_completed', finishReason: 'stop' }
  ]
}

async function waitFor(predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('等待条件超时')
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function initRepo(root) {
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'T14 Fixture')
  git(root, 'config', 'user.email', 't14@example.test')
  git(root, 'config', 'commit.gpgsign', 'false')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'fixture: initial state')
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}

function makeExecTools(root) {
  const runner = createCommandRunner({
    defaultCwd: root,
    sandboxPolicy: createSandboxPolicy({ backend: verifiedBackend })
  })
  return {
    runner,
    tools: createExecTools({
      runner,
      defaultCwd: root,
      platform: process.platform,
      sandboxBackendId: verifiedBackend.id
    })
  }
}

// 本文件跑在 node --test 内；子进程继承 NODE_TEST_CONTEXT 会让 node:test
// 判定「递归运行」而跳过测试文件，因此真实子进程证据前需要摘掉该变量。
function detachTestContext(t) {
  const saved = process.env.NODE_TEST_CONTEXT
  delete process.env.NODE_TEST_CONTEXT
  t.after(() => {
    if (saved === undefined) delete process.env.NODE_TEST_CONTEXT
    else process.env.NODE_TEST_CONTEXT = saved
  })
}

test('T14-2 真实进程闭环完成修复，且归属只纳入 Agent 文件、用户改动保持原样', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'budingx-isolated-'))
  t.after(() => cleanup(base))
  detachTestContext(t)
  const root = join(base, 'project')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'test'), { recursive: true })
  mkdirSync(join(base, '.budingx'))
  writeFileSync(join(root, 'src', 'app.mjs'), BUGGY)
  writeFileSync(
    join(root, 'test', 'app.test.mjs'),
    [
      "import test from 'node:test'",
      "import assert from 'node:assert/strict'",
      "import { add } from '../src/app.mjs'",
      '',
      "test('adds', () => {",
      '  assert.equal(add(2, 3), 5)',
      '})',
      ''
    ].join('\n')
  )
  writeFileSync(join(root, 'notes.txt'), '用户笔记：提交时不要包含我\n')
  initRepo(root)
  // 提交后由用户自己产生、与本次任务无关的改动：一个已跟踪文件的修改 + 一个未跟踪草稿。
  writeFileSync(join(root, 'notes.txt'), '用户笔记：提交时不要包含我（用户已改）\n')
  writeFileSync(join(root, 'draft.md'), '用户的草稿内容\n')
  const userNotes = readFileSync(join(root, 'notes.txt'))
  const userDraft = readFileSync(join(root, 'draft.md'))

  const workspace = createWorkspace(root)
  const { tools: workspaceTools, checkpoint } = createWorkspaceTools(workspace)
  const { tools: execTools, runner } = makeExecTools(root)
  const policy = createPermissionPolicy({
    workspace,
    dataRootOverride: join(base, '.budingx'),
    mode: 'full_access'
  })
  const tracker = createCodingTaskTracker({})
  tracker.start('修复 src/app.mjs 中 add 的失败测试')

  const events = []
  const session = new Session({
    provider: scriptProvider([
      toolCallTurn('call-read', 'Read', { path: 'src/app.mjs' }),
      toolCallTurn('call-edit', 'Edit', {
        path: 'src/app.mjs',
        old_string: 'return a * b',
        new_string: 'return a + b'
      }),
      toolCallTurn('call-test', 'Bash', { command: 'node --test test/app.test.mjs' }),
      textTurn('测试已通过，修复完成。')
    ]),
    approval: { async request() { return { outcome: 'allow', via: 'user' } } },
    resolveSnapshot: () => SNAPSHOT,
    tools: [...workspaceTools, ...execTools],
    permissionPolicy: policy,
    codingTask: tracker,
    disposers: [() => runner.dispose()],
    onEvent: (event) => events.push(event)
  })
  t.after(() => session.dispose())

  const before = events.filter((event) => event.type === 'turn_finalized').length
  session.submit('修复 src/app.mjs 的失败测试')
  await waitFor(() => events.filter((event) => event.type === 'turn_finalized').length > before)

  assert.equal(readFileSync(join(root, 'src', 'app.mjs'), 'utf8'), FIXED, '真实文件应被修复')
  assert.deepEqual(readFileSync(join(root, 'notes.txt')), userNotes, '用户已跟踪文件不得被改动')
  assert.deepEqual(readFileSync(join(root, 'draft.md')), userDraft, '用户未跟踪草稿不得被改动')

  const results = events.filter((event) => event.type === 'tool_result')
  assert.equal(results.length, 3)
  assert.match(results[2].content, /exit_code: 0/)
  assert.equal(tracker.canClaimDone().ok, true, '完成声明必须由真实测试证据支撑')

  // §7.2 归属：只把 Agent 改动的文件纳入可提交范围，用户改动保持 userOwned。
  const status = await readGitStatus(root)
  assert.equal(status.isRepository, true)
  const analysis = analyzeChanges({
    status,
    ownPaths: ownPathsFromCheckpoints(checkpoint.changes(), root)
  })
  assert.deepEqual(
    analysis.include.map((change) => [change.path, change.operation]),
    [['src/app.mjs', 'modify']]
  )
  assert.deepEqual([...analysis.userOwned].sort(), ['draft.md', 'notes.txt'])
  assert.deepEqual(analysis.conflicted, [])
})
function makeRealPlanHost({ workspace, root, targetPath, planText }) {
  const snapshotOf = () => {
    const files = {}
    const resolved = workspace.resolve(targetPath)
    if (resolved.existed) {
      files[targetPath] = contentFingerprint(readFileSync(resolved.real))
    }
    let head
    try {
      head = git(root, 'rev-parse', 'HEAD').trim()
    } catch {
      head = undefined
    }
    return { root: workspace.root, ...(head ? { head } : {}), files }
  }
  const store = createPlanStore({ snapshot: snapshotOf, now: () => 1000 })
  const state = { planText }
  return {
    store,
    state,
    async readPlanText() {
      return state.planText
    },
    snapshot: snapshotOf,
    diff(baseline, current) {
      const drift = []
      if (baseline.root !== current.root) {
        drift.push({ item: 'root', expected: baseline.root, actual: current.root })
      }
      if ((baseline.head ?? '') !== (current.head ?? '')) {
        drift.push({ item: 'head', expected: baseline.head ?? '', actual: current.head ?? '' })
      }
      for (const path of Object.keys({ ...baseline.files, ...current.files })) {
        if ((baseline.files[path] ?? '') !== (current.files[path] ?? '')) {
          drift.push({
            item: `files:${path}`,
            expected: baseline.files[path] ?? '',
            actual: current.files[path] ?? ''
          })
        }
      }
      return drift
    },
    validate: (plan) => validateBeforeExecute(plan, snapshotOf())
  }
}

test('T14-3 计划批准后目标文件被外部改动：执行被拒并列出漂移项', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'budingx-isolated-plan-'))
  t.after(() => cleanup(base))
  detachTestContext(t)
  const root = join(base, 'project')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(base, '.budingx'))
  writeFileSync(join(root, 'src', 'app.mjs'), BUGGY)
  initRepo(root)

  const workspace = createWorkspace(root)
  const { tools: workspaceTools } = createWorkspaceTools(workspace)
  const policy = createPermissionPolicy({
    workspace,
    dataRootOverride: join(base, '.budingx'),
    mode: 'full_access'
  })
  const planMode = makeRealPlanHost({
    workspace,
    root,
    targetPath: 'src/app.mjs',
    planText: '# 计划\n1. 修改 src/app.mjs 并运行测试'
  })
  const events = []
  const session = new Session({
    provider: scriptProvider([
      toolCallTurn('call-research-read', 'Read', { path: 'src/app.mjs' }),
      // 调研轮以文本收尾：计划批准前不产生任何写入（CE/TP 边界）。
      textTurn('调研完成，等待计划批准。'),
      toolCallTurn('call-edit', 'Edit', {
        path: 'src/app.mjs',
        old_string: 'return a * b',
        new_string: 'return a + b'
      })
    ]),
    approval: { async request() { return { outcome: 'allow', via: 'user' } } },
    resolveSnapshot: () => SNAPSHOT,
    tools: [...workspaceTools],
    permissionPolicy: policy,
    planMode,
    onEvent: (event) => events.push(event)
  })
  t.after(() => session.dispose())

  assert.equal(session.enterPlanMode().ok, true)
  assert.equal(session.planMode.phase, 'research')

  let before = events.filter((event) => event.type === 'turn_finalized').length
  session.submit('先调研 src/app.mjs')
  await waitFor(() => events.filter((event) => event.type === 'turn_finalized').length > before)
  assert.equal(events.filter((event) => event.type === 'tool_result').at(-1).isError, false)

  // 调研阶段产出的计划文件与计划条目；宿主随后请求退出计划模式。
  planMode.store.create('修复 add 的失败测试', [{ title: '修改 src/app.mjs 并运行测试' }])
  planMode.state.planText = '# 计划\n1. 修改 src/app.mjs 并运行测试\n'
  const approved = await session.exitPlanMode()
  assert.equal(approved.ok, true)
  assert.equal(policy.getMode(), 'full_access', '批准后恢复原权限档位')
  assert.equal(planMode.store.current().approval, 'approved')

  // 批准后、首个副作用之前，外部进程改动了目标文件。
  const external = 'export function add(a, b) {\n  return a - b\n}\n'
  writeFileSync(join(root, 'src', 'app.mjs'), external)

  before = events.filter((event) => event.type === 'turn_finalized').length
  session.submit('按计划执行')
  await waitFor(() => events.filter((event) => event.type === 'turn_finalized').length > before)

  const blocked = events.filter((event) => event.type === 'tool_result').at(-1)
  assert.equal(blocked.isError, true)
  assert.match(blocked.content, /Plan drifted before execution/)
  assert.match(blocked.content, /files:src\/app\.mjs/)
  assert.equal(readFileSync(join(root, 'src', 'app.mjs'), 'utf8'), external, '漂移后不得执行副作用')
  assert.equal(session.planMode.phase, 'pending', '漂移后计划回到待审')
  assert.equal(planMode.store.current().approval, 'pending')
})
