// SP004 T15 · 四类 TUI 卡片验收（AC VIS-01…04）。
// 三层次证据：①纯渲染函数逐行断言（命令/计划/待办）；②reducer 事件→Frame 卡片状态机；
// ③伪 TTY 真实 Session 交互（追问作答与取消，单一 tool_result 身份）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rmSync } from 'node:fs'
import { mountTty } from './helpers/mount-tty.mjs'
import { agentFixture, scriptProvider, toolTurn, SNAPSHOT } from './helpers/agent-fixture.mjs'
import { initialFrame } from '../dist/tui/render/types.js'
import { reduceFrame } from '../dist/tui/render/reducer.js'
import {
  commandCardLines,
  planCardLines,
  questionCardLines,
  todoCardLines
} from '../dist/tui/render/cards.js'
import { InkApprovalGateway } from '../dist/tui/approval.js'
import { Session } from '../dist/core/session.js'
import { createAskUserQuestionTool } from '../dist/core/questions.js'

const options = { width: 72, english: false }
const reduce = (frame, event) => reduceFrame(frame, event, options)

function makeFixture(t) {
  const f = agentFixture({ mode: 'full_access' })
  t.after(() => rmSync(f.base, { recursive: true, force: true }))
  return f
}

test('T15-1 VIS-01 命令卡片：运行→截断输出→非零退出，展开显示全部行', () => {
  let frame = initialFrame('full_access')
  frame = reduce(frame, {
    type: 'command_started',
    turnId: 't1',
    callId: 'call-b1',
    command: 'node --test math.test.mjs',
    interpreter: 'Bash',
    cwd: '/repo',
    startedAt: 1000
  })
  let lines = commandCardLines(frame.command, options.width, { zh: true })
  assert.match(lines[0], /◐ 命令 · Bash · 运行中/)
  assert.match(lines[1], /\$ node --test math\.test\.mjs/)
  assert.ok(lines.some((line) => line.includes('Ctrl+E')), '运行中应提示展开快捷键')

  const out = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`)
  frame = reduce(frame, {
    type: 'tool_result',
    turnId: 't1',
    callId: 'call-b1',
    content: `exit_code: 1\n--- stdout ---\n${out.join('\n')}`,
    isError: true
  })
  assert.equal(frame.command.exitCode, 1)
  assert.equal(frame.command.state, 'failed')
  lines = commandCardLines(frame.command, options.width, { zh: true })
  // 未展开：只保留尾部 6 行，并给出省略行数。
  assert.ok(lines.some((line) => line.includes('省略 16 行')), lines.join('\n'))
  assert.ok(!lines.some((line) => line.trim() === 'line 1'), '首行应被截断')
  assert.ok(lines.some((line) => line.trim() === 'line 20'))
  const expanded = commandCardLines(frame.command, options.width, { zh: true, expanded: true })
  assert.ok(expanded.some((line) => line.trim() === 'line 1'), '展开后应包含首行')
  assert.ok(!expanded.some((line) => line.includes('省略')))

  frame = reduce(frame, {
    type: 'command_finished',
    taskId: '',
    callId: 'call-b1',
    outcome: 'completed',
    exitCode: 0,
    finishedAt: 1600
  })
  assert.equal(frame.command.state, 'completed')
  assert.equal(frame.command.exitCode, 0)
  lines = commandCardLines(frame.command, options.width, { zh: true })
  assert.ok(lines.some((line) => line.includes('exit_code: 0')))
  assert.ok(lines.some((line) => line.includes('600ms')))
})

test('T15-2 VIS-01 命令卡片：显式后台回执保持后台态并显示任务/输出路径', () => {
  let frame = initialFrame('full_access')
  frame = reduce(frame, {
    type: 'command_started',
    turnId: 't1',
    callId: 'call-bg',
    command: 'npm run build',
    interpreter: 'Bash',
    cwd: '/repo',
    taskId: 'task-1',
    startedAt: 10
  })
  assert.equal(frame.command.state, 'background')
  frame = reduce(frame, {
    type: 'tool_result',
    turnId: 't1',
    callId: 'call-bg',
    content: 'exit_code: <pending>\nbackground_task_id: task-1\nauto_backgrounded: true',
    isError: false
  })
  assert.equal(frame.command.state, 'background')
  assert.equal(frame.command.taskId, 'task-1')
  const lines = commandCardLines(frame.command, options.width, { zh: true })
  assert.match(lines[0], /▷ 命令 · Bash · 后台运行/)
  assert.ok(lines.some((line) => line.includes('任务完成会推送通知')))

  frame = reduce(frame, {
    type: 'command_finished',
    taskId: 'task-1',
    outcome: 'completed',
    exitCode: 0,
    outputPath: '/home/u/.budingx/sessions/s1/tasks/task-1.out',
    finishedAt: 20_000
  })
  assert.equal(frame.command.state, 'completed')
  assert.match(frame.command.outputPath, /task-1\.out$/)
})

test('T15-3 VIS-01 命令卡片：取消态使用 ⊘ 且不计为失败', () => {
  let frame = initialFrame('read_only')
  frame = reduce(frame, {
    type: 'command_started',
    turnId: 't1',
    callId: 'call-c',
    command: 'sleep 30',
    interpreter: 'Bash',
    cwd: '/repo',
    startedAt: 0
  })
  frame = reduce(frame, {
    type: 'command_finished',
    taskId: '',
    callId: 'call-c',
    outcome: 'cancelled',
    finishedAt: 500
  })
  assert.equal(frame.command.state, 'cancelled')
  const lines = commandCardLines(frame.command, options.width, { zh: true })
  assert.match(lines[0], /⊘ 命令 · Bash · 已取消/)
})

test('T15-4 VIS-02 计划卡片：调研→待审批模式、步骤符号与阻塞位置、焦点移动', () => {
  const plan = {
    id: 'plan-1',
    goal: '修复 add 的失败测试',
    steps: [
      { id: 'step-1', title: '定位失败原因', status: 'completed' },
      { id: 'step-2', title: '修改 src/app.mjs', status: 'in_progress', blockedBy: ['step-1'] },
      { id: 'step-3', title: '复测并确认', status: 'pending' }
    ],
    approval: 'pending',
    createdAt: 1,
    updatedAt: 1000
  }
  let frame = reduce(initialFrame('workspace_edit'), { type: 'plan_updated', plan })
  assert.equal(frame.plan.mode, 'pending')
  let lines = planCardLines(frame.plan, options.width, { zh: true, focusIndex: 0 })
  assert.match(lines[0], /◆ 计划 · 待审批/)
  assert.match(lines[1], /目标: 修复 add 的失败测试/)
  assert.match(lines[2], /❯ 1\. ✓ 定位失败原因/)
  assert.match(lines[3], / {2}2\. ◐ 修改 src\/app\.mjs \(阻塞: step-1\)/)
  assert.match(lines[4], / {2}3\. ○ 复测并确认/)
  assert.ok(lines.some((line) => line.includes('1 允许 · 3/Esc 拒绝 · e 编辑正文')))
  const focused = planCardLines(frame.plan, options.width, { zh: true, focusIndex: 1 })
  assert.match(focused[3], /❯ 2\./)

  frame = reduce(frame, { type: 'plan_mode_changed', active: true, phase: 'research' })
  assert.equal(frame.plan.mode, 'research')
  frame = reduce(frame, { type: 'plan_mode_changed', active: false })
  assert.equal(frame.plan.mode, 'idle')
})

test('T15-5 VIS-03 待办卡片：由计划派生、状态符号、阻塞位置与 TTL 隐藏/展开', () => {
  const plan = {
    id: 'plan-2',
    goal: '交付 SP004',
    steps: [
      { id: 'step-1', title: '写完测试', status: 'completed' },
      { id: 'step-2', title: '实现逻辑', status: 'completed' },
      { id: 'step-3', title: '回归全量', status: 'in_progress' },
      { id: 'step-4', title: '提交', status: 'blocked', blockedBy: ['step-3'] }
    ],
    approval: 'approved',
    createdAt: 1,
    updatedAt: 1000
  }
  const frame = reduce(initialFrame('workspace_edit'), { type: 'plan_updated', plan })
  assert.equal(frame.todos.items.length, 4)
  assert.equal(frame.todos.completedAt['step-1'], 1000)
  let lines = todoCardLines(frame.todos, options.width, { zh: true, now: 2000, ttlMs: 60_000 })
  assert.match(lines[0], /◆ 待办 2\/4/)
  assert.ok(lines.some((line) => line.includes('✓ 写完测试')))
  assert.ok(lines.some((line) => line.includes('◐ 回归全量')))
  assert.ok(lines.some((line) => line.includes('⊘ 提交 (阻塞: step-3)')))

  // 固定假时钟越过 TTL：完成项隐藏，展开后恢复。
  lines = todoCardLines(frame.todos, options.width, { zh: true, now: 1000 + 60_001, ttlMs: 60_000 })
  assert.ok(!lines.some((line) => line.includes('写完测试')))
  assert.ok(lines.some((line) => line.includes('隐藏 2 项已完成（TTL）')))
  const expanded = todoCardLines(frame.todos, options.width, {
    zh: true,
    now: 1000 + 60_001,
    ttlMs: 60_000,
    expanded: true
  })
  assert.ok(expanded.some((line) => line.includes('写完测试')))
  assert.equal(
    todoCardLines({ items: [], updatedAt: 0, completedAt: {} }, options.width, { zh: true })[1].includes('（空列表）'),
    true
  )
})

test('T15-6 VIS-04 追问卡片：单题/多题、多选标记、Other 行与作答结果展示', () => {
  const questions = [
    {
      question: '选择哪条路线？',
      header: '路线',
      multiSelect: false,
      options: [
        { label: 'A 路线', description: '先做 A', preview: '预览 A\n第二行' },
        { label: 'B 路线', description: '先做 B' }
      ]
    },
    {
      question: '包含哪些端？',
      header: '端',
      multiSelect: true,
      options: [
        { label: 'TUI', description: '终端' },
        { label: 'Desktop', description: '桌面' }
      ]
    }
  ]
  const card = {
    questionId: 'q-1',
    callId: 'call-q1',
    turnId: 't1',
    questions,
    allowFreeText: true,
    state: 'pending',
    createdAt: 5
  }
  let lines = questionCardLines(card, options.width, {
    zh: true,
    questionIndex: 0,
    cursor: 1,
    selected: { '选择哪条路线？': ['A 路线'] },
    otherDraft: '自定义 C'
  })
  assert.match(lines[0], /◆ 提问 1\/2 · 单选/)
  assert.ok(lines.some((line) => line.includes('❯ ○ B 路线 — 先做 B')))
  assert.ok(lines.some((line) => line.includes('  ◉ A 路线 — 先做 A · 预览 A')), '预览只取首行')
  assert.ok(lines.some((line) => line.includes('◌ 其他（输入自定义答案）: 自定义 C')))
  assert.ok(lines.some((line) => line.includes('↑↓ 光标 · 空格选择 · Tab 切题')))

  lines = questionCardLines(card, options.width, { zh: true, questionIndex: 1, cursor: 2 })
  assert.match(lines[0], /◆ 提问 2\/2 · 多选/)
  assert.ok(!lines.some((line) => line.includes('A 路线')), '切题后只显示当前题')
  assert.ok(lines.some((line) => line.includes('❯ ◌ 其他')))

  const answered = questionCardLines(
    { ...card, state: 'answered', answers: { '选择哪条路线？': 'A 路线', '包含哪些端？': 'TUI, Desktop' }, annotations: { '选择哪条路线？': { notes: '先做 A' } } },
    options.width,
    { zh: true }
  )
  assert.ok(answered.some((line) => line.includes('✓ 选择哪条路线？ → A 路线 (先做 A)')))
  assert.ok(answered.some((line) => line.includes('✓ 包含哪些端？ → TUI, Desktop')))
  const cancelled = questionCardLines({ ...card, state: 'cancelled' }, options.width, { zh: true })
  assert.ok(cancelled.some((line) => line.includes('已取消')))
})

test('T15-7 审批网关携带用户编辑后的计划正文且一次裁决生效', async () => {
  const gateway = new InkApprovalGateway()
  const decision = gateway.request({
    requestId: 'req-plan',
    turnId: 't1',
    callId: 'call-plan',
    name: 'ExitPlanMode',
    summary: '批准计划：修复失败测试'
  })
  assert.equal(gateway.resolve('req-plan', 'allow', 'user', undefined, '  修复 add 并补测试  '), true)
  const resolved = await decision
  assert.equal(resolved.outcome, 'allow')
  assert.equal(resolved.editedText, '修复 add 并补测试')
  assert.equal(gateway.resolve('req-plan', 'deny'), false, '同一请求只能裁决一次')
})

const questionScript = (questions) => [
  [
    {
      type: 'tool_call_delta',
      index: 0,
      callId: 'call-q1',
      nameDelta: 'AskUserQuestion',
      argsDelta: JSON.stringify({ questions })
    },
    { type: 'message_completed', finishReason: 'tool_calls' }
  ],
  [
    { type: 'text_delta', text: '收到答案' },
    { type: 'message_completed', finishReason: 'stop' }
  ]
]

const twoQuestions = [
  {
    question: '选择哪条路线？',
    header: '路线',
    options: [
      { label: 'A 路线', description: '先做 A' },
      { label: 'B 路线', description: '先做 B' }
    ]
  },
  {
    question: '是否包含测试？',
    header: '测试',
    options: [
      { label: '包含测试', description: '加测试' },
      { label: '暂不测试', description: '跳过' }
    ]
  }
]

async function mountQuestion(t, questions) {
  const f = makeFixture(t)
  const { provider } = scriptProvider(questionScript(questions))
  const tools = [...f.tools]
  const events = []
  const ui = await mountTty(t, {
    provider,
    config: { model: 'test-model' },
    sessionFactory: ({ gateway }) => {
      const session = new Session({
        provider,
        approval: gateway,
        resolveSnapshot: () => SNAPSHOT,
        tools,
        permissionPolicy: f.policy,
        onEvent: (event) => events.push(event)
      })
      tools.push(createAskUserQuestionTool(session))
      return session
    }
  })
  await ui.send('帮我确认方案')
  await ui.send('\r')
  await ui.waitFor((_last, frames) => frames.join('\n').includes('◆ 提问'), 5000)
  return { ui, events }
}

test('T15-8 VIS-04 追问交互：空格选择推进两题，最后一题回车提交单一 tool_result', async (t) => {
  const { ui, events } = await mountQuestion(t, twoQuestions)
  assert.equal(ui.session.pendingQuestion?.questionId !== undefined, true)

  await ui.send(' ') // 选中 A 路线
  await ui.send('\r') // 下一题
  await ui.waitFor((_last, frames) => frames.join('\n').includes('◆ 提问 2/2'), 5000)
  await ui.send('\r') // 选中「包含测试」并提交

  await ui.waitFor(() => !ui.session.isBusy, 8000)
  const results = events.filter((event) => event.type === 'tool_result')
  assert.equal(results.length, 1, '同一调用只产生一个结果')
  assert.equal(results[0].callId, 'call-q1')
  assert.match(results[0].content, /选择哪条路线？/)
  assert.match(results[0].content, /A 路线/)
  assert.match(results[0].content, /包含测试/)
  const answered = events.filter((event) => event.type === 'question_answered')
  assert.equal(answered.length, 1)
  assert.deepEqual(answered[0].answers, {
    '选择哪条路线？': 'A 路线',
    '是否包含测试？': '包含测试'
  })
  const finalFrame = ui.last()
  assert.match(finalFrame, /◆ 提问 1\/2 · 单选|✓ 选择哪条路线？/)
  await ui.waitFor((_last, frames) => frames.join('\n').includes('✓ 选择哪条路线？ → A 路线'), 5000)
})

test('T15-9 VIS-04 追问取消：Esc 发 question_cancelled 并以同一 call ID 返回取消结果', async (t) => {
  const { ui, events } = await mountQuestion(t, twoQuestions)
  await ui.send('\x1b')
  await ui.waitFor(() => !ui.session.isBusy, 8000)
  assert.equal(events.filter((event) => event.type === 'question_cancelled').length, 1)
  const results = events.filter((event) => event.type === 'tool_result')
  assert.equal(results.length, 1)
  assert.equal(results[0].callId, 'call-q1')
  assert.match(results[0].content, /cancelled/i)
  assert.equal(ui.session.pendingQuestion, undefined)
})

test('T15-10 计划审批事件进入 TUI ApprovalCard：携带 planId/planVersion 供编辑正文', () => {
  const frame = reduce(initialFrame('workspace_edit'), {
    type: 'approval_requested',
    turnId: 't1',
    requestId: 'req-1',
    callId: 'call-plan',
    name: 'ExitPlanMode',
    summary: '批准计划：修复失败测试',
    preview: ['# 计划', '1. 修改 src/app.mjs'],
    planId: 'plan-9',
    planVersion: 1234
  })
  assert.equal(frame.approval.planId, 'plan-9')
  assert.equal(frame.approval.planVersion, 1234)
  const resolved = reduce(frame, {
    type: 'approval_resolved',
    requestId: 'req-1',
    turnId: 't1',
    outcome: 'allow',
    via: 'user'
  })
  assert.equal(resolved.approval, undefined)
})

// toolTurn 保持导出被使用，避免测试辅助函数漂移时静默失效。
void toolTurn