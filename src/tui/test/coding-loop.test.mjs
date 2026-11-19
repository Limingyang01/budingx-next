// SP004 T14 · 隔离项目端到端闭环（design §5、§6.3、§7.2；AC CT-01、CT-08、GW-02、GW-03）。
// 证据层级 L2：真实 Ink 帧 + 真实 workspace 文件 + 真实子进程，唯一假件是模型脚本。
// 场景：临时项目内置一个失败测试，模型走「定位→修改→运行测试→读失败→修复→复测通过」，
// 完成声明必须携带真实测试证据；全程用户预置的无关文件逐字节不变。
import { createHostProcessFixture } from '../../exec/test/helpers/host-process.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session } from '../dist/core/session.js'
import { createWorkspace } from '../dist/workspace/paths.js'
import { createWorkspaceTools } from '../dist/workspace/tools.js'
import { createPermissionPolicy } from '../dist/workspace/policy.js'
import { createCommandRunner } from '../dist/exec/runner.js'
import { createExecTools } from '../dist/exec/tools.js'
import { createSandboxPolicy } from '../dist/exec/sandbox-policy.js'
import { createCodingTaskTracker } from '../dist/core/coding.js'
import { mountTty } from './helpers/mount-tty.mjs'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: true }
}

// 合成验收后端：隔离决策层与真实进程解耦，行为与 T20 验收一致。
const verifiedBackend = createHostProcessFixture()

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

function cleanup(root) {
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}

const BUGGY = 'export function add(a, b) {\n  return a * b\n}\n'
const FIXED = 'export function add(a, b) {\n  return a + b\n}\n'

test('T14-1 伪 TTY 中完成定位→修改→测试失败→读失败→修复→复测通过', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'budingx-coding-loop-'))
  t.after(() => cleanup(base))
  // 本用例本身跑在 node --test 里；子进程继承 NODE_TEST_CONTEXT 会被 node:test
  // 判定为「递归运行」而跳过测试文件（退出码 0）。e2e 要的是真实子进程结果，
  // 因此只在本用例期间摘掉这个宿主测试环境变量。
  const savedTestContext = process.env.NODE_TEST_CONTEXT
  delete process.env.NODE_TEST_CONTEXT
  t.after(() => {
    if (savedTestContext === undefined) delete process.env.NODE_TEST_CONTEXT
    else process.env.NODE_TEST_CONTEXT = savedTestContext
  })
  const root = join(base, 'project')
  mkdirSync(root)
  mkdirSync(join(base, '.budingx'))
  writeFileSync(join(root, 'math.mjs'), BUGGY)
  writeFileSync(
    join(root, 'math.test.mjs'),
    [
      "import test from 'node:test'",
      "import assert from 'node:assert/strict'",
      "import { add } from './math.mjs'",
      '',
      "test('adds', () => {",
      '  assert.equal(add(2, 3), 5)',
      '})',
      ''
    ].join('\n')
  )
  // 用户预置的无关文件：一个已跟踪候选、一个仍在编辑中的草稿。
  writeFileSync(join(root, 'notes.txt'), '用户笔记：修复时不要改动这个文件\n')
  writeFileSync(join(root, 'draft.md'), '用户正在写的草稿\n')
  const userNotes = readFileSync(join(root, 'notes.txt'))
  const userDraft = readFileSync(join(root, 'draft.md'))

  const workspace = createWorkspace(root)
  const { tools: workspaceTools } = createWorkspaceTools(workspace)
  const runner = createCommandRunner({
    defaultCwd: root,
    sandboxPolicy: createSandboxPolicy({ backend: verifiedBackend })
  })
  const execTools = createExecTools({
    runner,
    defaultCwd: root,
    platform: process.platform,
    sandboxBackendId: verifiedBackend.id
  })
  // full_access 让端到端场景聚焦「真实文件+真实进程」闭环；审批语义由 T5/T11 覆盖。
  const policy = createPermissionPolicy({
    workspace,
    dataRootOverride: join(base, '.budingx'),
    mode: 'full_access'
  })
  const tracker = createCodingTaskTracker({})
  tracker.start('修复 math.mjs 中 add 的失败测试')

  const provider = scriptProvider([
    toolCallTurn('call-read', 'Read', { path: 'math.mjs' }),
    toolCallTurn('call-edit-wrong', 'Edit', {
      path: 'math.mjs',
      old_string: 'return a * b',
      new_string: 'return a - b'
    }),
    toolCallTurn('call-test-fail', 'Bash', { command: 'node --test math.test.mjs' }),
    toolCallTurn('call-read-again', 'Read', { path: 'math.mjs' }),
    toolCallTurn('call-edit-fix', 'Edit', {
      path: 'math.mjs',
      old_string: 'return a - b',
      new_string: 'return a + b'
    }),
    toolCallTurn('call-test-pass', 'Bash', { command: 'node --test math.test.mjs' }),
    textTurn('测试已通过，修复完成。')
  ])

  const ui = await mountTty(t, {
    config: { model: 'test-model' },
    sessionFactory: ({ gateway }) =>
      new Session({
        provider,
        approval: gateway,
        resolveSnapshot: () => SNAPSHOT,
        tools: [...workspaceTools, ...execTools],
        permissionPolicy: policy,
        codingTask: tracker
      }),
    commandOverrides: {
      permission: { workspace, policy, checkpointChanges: () => [] }
    }
  })

  await ui.send('修复 math.mjs 的失败测试')
  await ui.send('\r')
  await ui.waitFor(
    (_last, frames) => !ui.session.isBusy && frames.join('\n').includes('修复完成'),
    30000
  )

  const transcript = ui.frames().join('\n')
  assert.match(transcript, /Bash\(/, '帧里应出现真实命令调用')
  assert.match(transcript, /Read\(/, '帧里应出现文件读取')
  assert.match(transcript, /exit_code: 1/, '首次改动后测试必须真实失败并回传退出码')
  assert.match(transcript, /exit_code: 0/, '修复后复测必须真实通过')

  assert.equal(readFileSync(join(root, 'math.mjs'), 'utf8'), FIXED, '磁盘文件应被真实修复')
  assert.deepEqual(readFileSync(join(root, 'notes.txt')), userNotes, '用户文件不得被改动')
  assert.deepEqual(readFileSync(join(root, 'draft.md')), userDraft, '用户草稿不得被改动')

  const task = tracker.get()
  assert.equal(task?.testEvidence?.command, 'node --test math.test.mjs')
  assert.equal(tracker.canClaimDone().ok, true, '完成声明必须由真实测试证据支撑')
})