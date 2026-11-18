// SP004 T12 · 追问工具与回合挂起（design §6.4，AC TP-06/TP-07/TP-08、CT-05/CT-06）。
// Session 用脚本化 provider 驱动；追问工具通过 createAskUserQuestionTool 注入。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Session } from '../../tui/dist/core/session.js'
import { createAskUserQuestionTool } from '../../tui/dist/core/questions.js'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: true }
}

const QUESTION = '用 TypeScript 还是 JavaScript 实现？'

function scriptProvider(script) {
  const requests = []
  return {
    requests,
    provider: {
      async *stream(request) {
        requests.push(request)
        const events = script.shift() ?? [{ type: 'message_completed', finishReason: 'stop' }]
        for (const event of events) yield event
      }
    }
  }
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('等待条件超时')
}

function questionTurn(callId, questions) {
  return [
    [
      {
        type: 'tool_call_delta',
        index: 0,
        callId,
        nameDelta: 'AskUserQuestion',
        argsDelta: JSON.stringify({ questions })
      },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ],
    [{ type: 'message_completed', finishReason: 'stop' }]
  ]
}

const ONE_QUESTION = [
  {
    question: QUESTION,
    header: '语言',
    options: [
      { label: 'TypeScript', description: '与现有代码一致' },
      { label: 'JavaScript', description: '无需构建步骤' }
    ]
  }
]

function makeSession({ script }) {
  const events = []
  const { provider, requests } = scriptProvider(script)
  const tools = []
  const session = new Session({
    provider,
    approval: {
      async request() {
        throw new Error('追问不应走审批通道')
      }
    },
    resolveSnapshot: () => SNAPSHOT,
    tools,
    onEvent: (event) => events.push(event)
  })
  tools.push(createAskUserQuestionTool(session))
  return { session, events, requests }
}

async function startQuestion(session, events, expectedCallId = 'call-q1') {
  session.submit('先确认实现语言')
  await waitFor(() => events.some((event) => event.type === 'question_requested'))
  const event = events.find((entry) => entry.type === 'question_requested')
  assert.equal(event.callId, expectedCallId)
  return event
}

test('T12-1 AskUserQuestion：回合进入挂起态并发 question_requested', async () => {
  const { session, events } = makeSession({
    script: questionTurn('call-q1', ONE_QUESTION)
  })
  const event = await startQuestion(session, events)
  assert.equal(session.currentState, 'awaiting_approval')
  assert.equal(event.question.callId, 'call-q1')
  assert.equal(event.question.allowFreeText, true)
  assert.equal(event.question.questions.length, 1)
  assert.equal(event.question.questions[0].header, '语言')
  assert.equal(event.question.questions[0].options.length, 2)
  assert.equal(event.question.questions[0].multiSelect, false)
  assert.equal(session.pendingQuestion?.questionId, event.question.questionId)
  session.cancelQuestion()
  await waitFor(() => events.some((entry) => entry.type === 'turn_finalized'))
  session.dispose()
})

test('T12-2 选项少于 2 个：工具拒绝且不产生挂起', async () => {
  const bad = [
    {
      question: QUESTION,
      header: '语言',
      options: [{ label: 'TypeScript', description: '唯一选项' }]
    }
  ]
  const { session, events } = makeSession({ script: questionTurn('call-q1', bad) })
  session.submit('先确认实现语言')
  await waitFor(() => events.some((event) => event.type === 'tool_result'))
  const results = events.filter((event) => event.type === 'tool_result')
  assert.equal(results.length, 1)
  assert.equal(results[0].isError, true)
  assert.match(results[0].content, /2–4/)
  assert.equal(events.some((event) => event.type === 'question_requested'), false)
  assert.equal(session.currentState, 'idle')
  session.dispose()
})

test('T12-3 回答注入：原 call ID 的单一 tool_result 进入历史与下一次请求', async () => {
  const { session, events, requests } = makeSession({
    script: questionTurn('call-q1', ONE_QUESTION)
  })
  const event = await startQuestion(session, events)
  const accepted = session.answerQuestion(
    event.question.questionId,
    { [QUESTION]: 'TypeScript' },
    { [QUESTION]: { notes: '按现有约定' } }
  )
  assert.equal(accepted.ok, true)
  await waitFor(() => events.some((entry) => entry.type === 'turn_finalized'))
  const results = events.filter((entry) => entry.type === 'tool_result')
  assert.equal(results.length, 1, '回答后只允许一个终态工具结果')
  assert.equal(results[0].callId, 'call-q1')
  assert.equal(results[0].isError, false)
  assert.match(results[0].content, new RegExp(QUESTION))
  assert.match(results[0].content, /TypeScript/)
  assert.match(results[0].content, /备注：按现有约定/)
  const answered = events.find((entry) => entry.type === 'question_answered')
  assert.deepEqual(answered.answers, { [QUESTION]: 'TypeScript' })
  assert.deepEqual(answered.annotations, { [QUESTION]: { notes: '按现有约定' } })
  assert.equal(requests.length, 2, '回答后回合继续发起下一次模型请求')
  assert.ok(JSON.stringify(requests[1].messages).includes('TypeScript'))
  assert.ok(
    requests[1].messages.some((message) => message.role === 'tool'),
    'tool_result 以工具角色进入下一次请求'
  )
  const finalized = events.find((entry) => entry.type === 'turn_finalized')
  assert.equal(finalized.outcome, 'completed')
  session.dispose()
})

test('T12-4 取消追问：发 question_cancelled 并以原 call ID 返回取消结果', async () => {
  const { session, events } = makeSession({
    script: questionTurn('call-q1', ONE_QUESTION)
  })
  const event = await startQuestion(session, events)
  assert.equal(session.cancelQuestion(event.question.questionId), true)
  await waitFor(() => events.some((entry) => entry.type === 'question_cancelled'))
  await waitFor(() => events.some((entry) => entry.type === 'turn_finalized'))
  const cancelled = events.find((entry) => entry.type === 'question_cancelled')
  assert.equal(cancelled.callId, 'call-q1')
  const results = events.filter((entry) => entry.type === 'tool_result')
  assert.equal(results.length, 1)
  assert.equal(results[0].callId, 'call-q1')
  assert.match(results[0].content, /cancelled/)
  assert.equal(session.currentState, 'idle')
  session.dispose()
})

test('T12-5 重复、过期与错误标识的回答无效', async () => {
  const { session, events } = makeSession({
    script: questionTurn('call-q1', ONE_QUESTION)
  })
  const event = await startQuestion(session, events)
  const wrongId = session.answerQuestion('not-the-id', { [QUESTION]: 'TypeScript' })
  assert.equal(wrongId.ok, false)
  assert.match(wrongId.reason, /不匹配|过期/)
  const missing = session.answerQuestion(event.question.questionId, {})
  assert.equal(missing.ok, false)
  assert.match(missing.reason, /缺少答案/)
  const accepted = session.answerQuestion(event.question.questionId, { [QUESTION]: 'TypeScript' })
  assert.equal(accepted.ok, true)
  const again = session.answerQuestion(event.question.questionId, { [QUESTION]: 'JavaScript' })
  assert.equal(again.ok, false)
  assert.match(again.reason, /没有待回答的追问/)
  assert.equal(session.cancelQuestion(event.question.questionId), false)
  await waitFor(() => events.some((entry) => entry.type === 'turn_finalized'))
  session.dispose()
})

test('T12-6 回合中断：挂起追问被取消，不无限等待', async () => {
  const { session, events } = makeSession({
    script: questionTurn('call-q1', ONE_QUESTION)
  })
  await startQuestion(session, events)
  session.interrupt('user')
  await waitFor(() => events.some((entry) => entry.type === 'question_cancelled'), 15000)
  await waitFor(() => events.some((entry) => entry.type === 'turn_finalized'), 15000)
  const finalized = events.find((entry) => entry.type === 'turn_finalized')
  assert.equal(finalized.outcome, 'cancelled')
  assert.equal(session.currentState, 'idle')
  assert.equal(session.pendingQuestion, undefined)
  session.dispose()
})

test('T12-7 多题与多选：答案按题目文本回传并保留备注', async () => {
  const questions = [
    {
      question: QUESTION,
      header: '语言',
      options: [
        { label: 'TypeScript', description: '与现有代码一致' },
        { label: 'JavaScript', description: '无需构建步骤' }
      ]
    },
    {
      question: '需要同时支持哪些端？',
      header: '范围',
      multiSelect: true,
      options: [
        { label: 'TUI', description: '当前交付' },
        { label: 'Desktop', description: '范围外' },
        { label: 'VS Code', description: '范围外' }
      ]
    }
  ]
  const { session, events } = makeSession({ script: questionTurn('call-q1', questions) })
  const event = await startQuestion(session, events)
  assert.equal(event.question.questions.length, 2)
  assert.equal(event.question.questions[1].multiSelect, true)
  const answers = {
    [QUESTION]: 'TypeScript',
    '需要同时支持哪些端？': 'TUI,Desktop'
  }
  const annotations = { [QUESTION]: { preview: 'ts', notes: '沿用现有构建' } }
  assert.equal(session.answerQuestion(event.question.questionId, answers, annotations).ok, true)
  await waitFor(() => events.some((entry) => entry.type === 'turn_finalized'))
  const results = events.filter((entry) => entry.type === 'tool_result')
  assert.equal(results.length, 1)
  assert.match(results[0].content, /TUI,Desktop/)
  assert.match(results[0].content, /沿用现有构建/)
  session.dispose()
})