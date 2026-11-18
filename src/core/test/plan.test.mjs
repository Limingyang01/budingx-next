// SP004 T1 · 计划/待办/追问 core 端口契约（设计 §6.1 / §6.4）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PLAN_MAX_STEPS,
  PLAN_STEP_STATUSES,
  TODO_STATUSES,
  PLAN_APPROVAL_STATES,
  planProgress,
  nextPlanStepId,
  validateQuestions
} from '../../tui/dist/core/plan.js'

test('计划与待办枚举固定', () => {
  assert.equal(PLAN_MAX_STEPS, 50)
  assert.deepEqual([...PLAN_STEP_STATUSES], ['pending', 'in_progress', 'completed', 'blocked'])
  assert.deepEqual([...TODO_STATUSES], ['pending', 'in_progress', 'completed'])
  assert.deepEqual([...PLAN_APPROVAL_STATES], ['none', 'pending', 'approved', 'rejected'])
})

test('planProgress 按步骤状态计数', () => {
  const steps = [
    { id: 'step-1', title: 'a', status: 'completed' },
    { id: 'step-2', title: 'b', status: 'in_progress' },
    { id: 'step-3', title: 'c', status: 'blocked', blockedBy: ['step-2'] },
    { id: 'step-4', title: 'd', status: 'pending' },
    { id: 'step-5', title: 'e', status: 'pending' }
  ]
  assert.deepEqual(planProgress(steps), {
    total: 5,
    completed: 1,
    inProgress: 1,
    blocked: 1,
    pending: 2
  })
  assert.deepEqual(planProgress([]), { total: 0, completed: 0, inProgress: 0, blocked: 0, pending: 0 })
})

test('nextPlanStepId 生成稳定序号且不复用已有 id', () => {
  assert.equal(nextPlanStepId([]), 'step-1')
  const steps = [
    { id: 'step-1', title: 'a', status: 'completed' },
    { id: 'step-2', title: 'b', status: 'pending' }
  ]
  assert.equal(nextPlanStepId(steps), 'step-3')
})

const validQuestion = {
  question: '选择哪种方案？',
  header: '方案',
  options: [
    { label: '方案 A', description: '保守方案' },
    { label: '方案 B', description: '激进方案' }
  ],
  multiSelect: false
}

test('validateQuestions 接受合法多题输入', () => {
  const result = validateQuestions({ questions: [validQuestion] })
  assert.equal(result.ok, true)
  assert.equal(result.questions.length, 1)
  assert.equal(result.questions[0].multiSelect, false)
  const multi = validateQuestions({
    questions: [validQuestion, { ...validQuestion, question: '第二个问题？', multiSelect: true }]
  })
  assert.equal(multi.ok, true)
  assert.equal(multi.questions[1].multiSelect, true)
})

test('validateQuestions 拒绝非法输入并说明原因', () => {
  const cases = [
    [{ questions: [] }, '题数'],
    [{ questions: [validQuestion, validQuestion, validQuestion, validQuestion, validQuestion] }, '题数'],
    [{ questions: [validQuestion, validQuestion] }, '唯一'],
    [{ questions: [{ ...validQuestion, header: '' }] }, 'header'],
    [{ questions: [{ ...validQuestion, question: '没有问号' }] }, '问号'],
    [{ questions: [{ ...validQuestion, options: [{ label: '仅一项', description: 'x' }] }] }, '选项'],
    [
      {
        questions: [
          {
            ...validQuestion,
            options: [
              { label: '重复', description: 'x' },
              { label: '重复', description: 'y' }
            ]
          }
        ]
      },
      '唯一'
    ],
    [{ questions: [{ ...validQuestion, options: [{ label: '缺说明' }, { label: '另一项', description: 'y' }] }] }, 'description'],
    [null, 'questions'],
    [{}, 'questions']
  ]
  for (const [input, keyword] of cases) {
    const result = validateQuestions(input)
    assert.equal(result.ok, false, JSON.stringify(input))
    assert.ok(result.reason.includes(keyword), `原因应含「${keyword}」：${result.reason}`)
  }
})

test('validateQuestions 缺省 multiSelect 归一为 false', () => {
  const { multiSelect: _drop, ...withoutFlag } = validQuestion
  const result = validateQuestions({ questions: [withoutFlag] })
  assert.equal(result.ok, true)
  assert.equal(result.questions[0].multiSelect, false)
})