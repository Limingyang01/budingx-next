import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runLiveTask } from '../../../scripts/eval/lib/runner-core.mjs'
import { runCanTask, toolCallSse, textSse } from '../../../scripts/eval/lib/can-runner.mjs'
import { scoreCanTask, summarizeCanEvidence } from '../../../scripts/eval/lib/can-score.mjs'
import { scriptedProvider, textEvents, toolCallEvents } from '../../../scripts/eval/lib/scenarios.mjs'
import { validateCheckpointTasks } from '../../../scripts/eval/lib/tasks.mjs'
import {
  buildSummary,
  collectTaskScores,
  hoeffdingInterval,
  percentile,
  assertReportWording,
  renderMarkdown,
  redactTaskForDisk,
  FORBIDDEN_REPORT_PHRASES
} from '../../../scripts/eval/lib/report.mjs'
import {
  buildRunIdentity,
  compareIdentity,
  identityDigest,
  readIdentity,
  writeIdentity,
  writeRunResult
} from '../../../scripts/eval/lib/run-identity.mjs'

test('CP-SET-v1 validates quotas and exact snapshot bytes', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sp010-task-set-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const quotas = { LOC: 2, FIX: 4, FEAT: 3, TST: 3, REF: 2, CTX: 2, CAN: 1, ADV: 1, PROT: 12 }
  let n = 0
  const tasks = Object.entries(quotas).flatMap(([category, count]) =>
    Array.from({ length: count }, (_, index) => {
      const suffix = String(index + 1).padStart(2, '0')
      const id = 'CP-' + category + '-' + suffix
      const fixture = join(root, 'scripts', 'eval', 'fixtures', id)
      mkdirSync(fixture, { recursive: true })
      writeFileSync(join(fixture, 'input.txt'), 'original')
      const sha256 = createHash('sha256').update('original').digest('hex')
      writeFileSync(join(fixture, 'snapshot.json'), JSON.stringify({ version: 1, files: { 'input.txt': sha256 } }))
      return {
        id, version: 1, group: category === 'PROT' ? 'protection' : 'coding_regression',
        category, language: 'TypeScript', repo_size: 'S', snapshot: 1, instruction: 'Test fixture',
        assertions: 'A', scope: { allow: [] }, deps: [], budget: category === 'PROT' ? 'P' : 'B',
        failure_class: 'assertion', blind: category !== 'PROT' && n++ < 10,
        source: category === 'PROT' ? 'PROT-' + suffix : 'TASK-B01',
        checks: [{ kind: 'file_exists', path: 'input.txt' }]
      }
    })
  )
  assert.deepEqual(validateCheckpointTasks(tasks, root).errors, [])

  const changed = structuredClone(tasks)
  delete changed[0].instruction
  changed[0].category = 'FIX'
  changed[0].blind = false
  changed.pop()
  writeFileSync(join(root, 'scripts', 'eval', 'fixtures', tasks[1].id, 'input.txt'), 'tampered')
  writeFileSync(join(root, 'scripts', 'eval', 'fixtures', tasks[2].id, 'unlisted.txt'), 'unlisted')
  const errors = validateCheckpointTasks(changed, root).errors.join('\\n')
  for (const expected of [/instruction/, /LOC/, /blind/, /CP-PROT-12/, /SHA-256/, /unlisted[.]txt/]) {
    assert.match(errors, expected)
  }
})


test('live evaluation checks workspace files before cleanup', async () => {
  const scenario = {
    id: 'task-b07',
    instruction: 'Inspect the fixture',
    checks: [{ kind: 'file_exists', path: 'src/calc.js' }]
  }
  const options = { provider: scriptedProvider([textEvents('done')]) }
  assert.equal((await runLiveTask(scenario, options)).status, 'passed')
  scenario.checks = [{ kind: 'file_absent', path: 'src/calc.js' }]
  assert.equal((await runLiveTask(scenario, options)).status, 'failed')
})

test('live evaluation fails a token-budget termination despite passing assertions', async () => {
  const result = await runLiveTask({
    id: 'budget-fixture', instruction: 'Complete the task',
    checks: [{ kind: 'scope', allow: [] }]
  }, { provider: scriptedProvider([textEvents('done')]), budget: { maxTokens: 1 } })
  assert.equal(result.status, 'failed')
  assert.equal(result.failureClass, 'BUDGET')
  assert.equal(result.budgetExceeded, 'tokens')
})

test('live evaluation retains the provider outcome when verification exits zero', async () => {
  const result = await runLiveTask({
    id: 'provider-fixture', instruction: 'Complete the task',
    checks: [{ kind: 'scope', allow: [] }],
    verify: { commands: [[process.execPath, '-e', 'process.exit(0)']] }
  }, {
    provider: scriptedProvider([[{
      type: 'failed', error: { class: 'auth', code: 'fixture-auth', message: 'fixture', retryable: false }
    }]])
  })
  assert.equal(result.status, 'failed')
  assert.equal(result.commandExitCode, 0)
  assert.equal(result.outcome, 'error')
  assert.equal(result.error.class, 'auth')
})


test('the live coding budget supports more than eight model iterations', async () => {
  const scenario = {
    id: 'task-b07', instruction: 'Read the fixture',
    checks: [{ kind: 'outcome', outcome: 'completed' }, { kind: 'tool_result', name: 'Read', isError: false, min: 9 }]
  }
  const script = [
    ...Array.from({ length: 9 }, (_, index) =>
      toolCallEvents('read-' + index, 'Read', JSON.stringify({ path: 'src/calc.js' }))),
    textEvents('done')
  ]
  const result = await runLiveTask(scenario, { provider: scriptedProvider(script) })
  assert.equal(result.outcome, 'completed')
  assert.equal(result.requestCount, 10)
  assert.equal(result.status, 'passed')
  for (const [budget, resource] of [[{ maxTurns: 2 }, 'turns'], [{ maxRequests: 2 }, 'requests']]) {
    const limited = await runLiveTask(scenario, { provider: scriptedProvider(script), budget })
    assert.equal(limited.status, 'failed')
    assert.equal(limited.failureClass, 'BUDGET')
    assert.equal(limited.budgetExceeded, resource)
  }
})

test('the live wall-clock deadline aborts a stalled provider', async () => {
  const stopped = Promise.withResolvers()
  const provider = { async *stream({ signal }) {
    if (!signal.aborted) await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
    stopped.resolve()
  } }
  const result = await runLiveTask({
    id: 'timeout-fixture', instruction: 'Complete the task', checks: [{ kind: 'scope', allow: [] }]
  }, { provider, budget: { timeoutMs: 250 } })
  await stopped.promise
  assert.equal(result.status, 'failed')
  assert.equal(result.failureClass, 'BUDGET')
  assert.equal(result.budgetExceeded, 'wall-clock')
})


test('live execution uses task permission and approval without skipping denied turns', async () => {
  const command = 'node -e "console.log(17 * 23)"'
  const run = (permissionMode, approval, checks) => runLiveTask({
    id: 'exec-fixture', instruction: 'Run the fixture command', permissionMode, approval, checks
  }, {
    provider: scriptedProvider([
      toolCallEvents('exec-first', 'Bash', JSON.stringify({ command })),
      toolCallEvents('exec-second', 'Bash', JSON.stringify({ command })),
      textEvents('done')
    ])
  })
  const denied = await run('read_only', 'allow', [
    { kind: 'denial', tool: 'Bash' }
  ])
  assert.equal(denied.status, 'passed')

  const resumed = await run('workspace_edit', 'deny_then_allow', [
    { kind: 'denial', tool: 'Bash' },
    { kind: 'tool_result', name: 'Bash', isError: false, contains: '391' }
  ])
  assert.equal(resumed.status, 'passed', JSON.stringify(resumed.checks))
  assert.equal(resumed.requestCount, 3)
})

// ── SP010 T2：CAN 整题评分（取消 → 恢复 → 续跑）────────────────────────────

const CAN_EVIDENCE = {
  firstTurn: { id: 'turn-1', outcome: 'cancelled' },
  secondTurn: { id: 'turn-2', outcome: 'completed' },
  sideEffectCount: 1,
  resumeReceipt: {
    ok: true,
    sessionId: 'session-can',
    messages: [{ id: 'msg-1', blocks: [{ type: 'text', text: 'CP-CAN-MARKER-9f2a' }] }]
  },
  expectedSessionId: 'session-can',
  expectedMessageId: 'msg-1',
  expectedMarker: 'CP-CAN-MARKER-9f2a',
  assertionsPassed: true,
  budgetExceeded: undefined,
  missingEvidence: []
}

test('CAN scoring passes only when both turns, the resume receipt and the single side effect agree', () => {
  const scored = scoreCanTask(CAN_EVIDENCE)
  assert.equal(scored.status, 'passed')
  assert.deepEqual(scored.reasons, [])
})

test('CAN scoring rejects a first turn that did not end cancelled', () => {
  const scored = scoreCanTask({ ...CAN_EVIDENCE, firstTurn: { id: 'turn-1', outcome: 'completed' } })
  assert.equal(scored.status, 'failed')
  assert.match(scored.reasons.join('\n'), /cancelled/)
})

test('CAN scoring rejects a second turn that did not complete', () => {
  const scored = scoreCanTask({ ...CAN_EVIDENCE, secondTurn: { id: 'turn-2', outcome: 'cancelled' } })
  assert.equal(scored.status, 'failed')
  assert.match(scored.reasons.join('\n'), /completed/)
})

test('CAN scoring rejects a reused turn identity', () => {
  const scored = scoreCanTask({
    ...CAN_EVIDENCE,
    secondTurn: { id: 'turn-1', outcome: 'completed' }
  })
  assert.equal(scored.status, 'failed')
  assert.match(scored.reasons.join('\n'), /新的回合/)
})

test('CAN scoring rejects a failed resume receipt', () => {
  const scored = scoreCanTask({
    ...CAN_EVIDENCE,
    resumeReceipt: { ok: false, sessionId: 'session-can', messages: [] }
  })
  assert.equal(scored.status, 'failed')
  assert.match(scored.reasons.join('\n'), /回执未成功/)
})

test('CAN scoring rejects a receipt that points at another session', () => {
  const scored = scoreCanTask({
    ...CAN_EVIDENCE,
    resumeReceipt: { ...CAN_EVIDENCE.resumeReceipt, sessionId: 'session-other' }
  })
  assert.equal(scored.status, 'failed')
  assert.match(scored.reasons.join('\n'), /sessionId/)
})

test('CAN scoring rejects history without the first-turn message id', () => {
  const scored = scoreCanTask({
    ...CAN_EVIDENCE,
    resumeReceipt: {
      ...CAN_EVIDENCE.resumeReceipt,
      messages: [{ id: 'msg-other', blocks: [{ type: 'text', text: 'CP-CAN-MARKER-9f2a' }] }]
    }
  })
  assert.equal(scored.status, 'failed')
  assert.match(scored.reasons.join('\n'), /首回合消息/)
})

test('CAN scoring rejects history whose content marker does not match', () => {
  const scored = scoreCanTask({
    ...CAN_EVIDENCE,
    resumeReceipt: {
      ...CAN_EVIDENCE.resumeReceipt,
      messages: [{ id: 'msg-1', blocks: [{ type: 'text', text: 'unrelated content' }] }]
    }
  })
  assert.equal(scored.status, 'failed')
  assert.match(scored.reasons.join('\n'), /首回合消息/)
})

test('CAN scoring rejects a replayed or missing side effect', () => {
  for (const count of [0, 2]) {
    const scored = scoreCanTask({ ...CAN_EVIDENCE, sideEffectCount: count })
    assert.equal(scored.status, 'failed')
    assert.match(scored.reasons.join('\n'), /副作用总次数应为 1/)
  }
})

test('CAN scoring treats a budget termination as BUDGET rather than an assertion failure', () => {
  const scored = scoreCanTask({ ...CAN_EVIDENCE, budgetExceeded: 'requests' })
  assert.equal(scored.status, 'failed')
  assert.equal(scored.failureClass, 'BUDGET')
})

test('CAN scoring reports missing infrastructure evidence as unverified', () => {
  const scored = scoreCanTask({
    ...CAN_EVIDENCE,
    missingEvidence: ['恢复入口回执未取得']
  })
  assert.equal(scored.status, 'unverified')
})

test('CAN evidence summary keeps the verdict fields without the message body', () => {
  const summary = summarizeCanEvidence(CAN_EVIDENCE)
  assert.equal(summary.firstTurnMessageMatched, true)
  assert.equal(summary.sideEffectCount, 1)
  assert.equal(JSON.stringify(summary).includes('CP-CAN-MARKER-9f2a'), false)
})

// ── SP010 T2：CAN 整题的端到端路径（真实 runtime + 真实会话存储 + 真实恢复入口）──

const CAN_TASK = {
  id: 'CP-CAN-01',
  version: 1,
  group: 'coding_regression',
  category: 'CAN',
  blind: false
}

const CAN_HANDLERS = [
  toolCallSse('call-write', 'Write', { path: 'side-effect.txt', content: 'side effect' }),
  undefined,
  textSse('剩余任务已完成')
]

test('CAN 整题：取消后经产品恢复入口续跑，目标副作用只发生一次', async () => {
  const result = await runCanTask(CAN_TASK, {
    handlers: CAN_HANDLERS,
    marker: 'CP-CAN-MARKER-e2e'
  })
  assert.equal(result.status, 'passed', JSON.stringify(result.can))
  assert.equal(result.can.firstTurn.outcome, 'cancelled')
  assert.equal(result.can.secondTurn.outcome, 'completed')
  assert.equal(result.can.sideEffectCount, 1)
  assert.equal(result.can.resumeOk, true)
  assert.equal(result.can.resumeSessionMatches, true)
  assert.equal(result.can.firstTurnMessageMatched, true)
  assert.equal(result.can.assertionsPassed, true)
})

test('CAN 整题：跳过恢复入口直接续聊不构成通过', async () => {
  const result = await runCanTask(CAN_TASK, {
    handlers: CAN_HANDLERS,
    marker: 'CP-CAN-MARKER-e2e',
    skipResume: true
  })
  assert.equal(result.status, 'failed')
  assert.match(result.can.reasons.join('\n'), /恢复入口/)
})

test('CAN 整题：恢复回执指向其他会话时整题失败', async () => {
  const result = await runCanTask(CAN_TASK, {
    handlers: CAN_HANDLERS,
    marker: 'CP-CAN-MARKER-e2e',
    resumeOverride: { ok: true, sessionId: 'session-other', messages: [] }
  })
  assert.equal(result.status, 'failed')
  assert.match(result.can.reasons.join('\n'), /sessionId|首回合消息/)
})

test('CAN 整题：恢复回执失败时整题失败', async () => {
  const result = await runCanTask(CAN_TASK, {
    handlers: CAN_HANDLERS,
    marker: 'CP-CAN-MARKER-e2e',
    resumeOverride: { ok: false, sessionId: 'cp-can-session', messages: [] }
  })
  assert.equal(result.status, 'failed')
  assert.match(result.can.reasons.join('\n'), /回执/)
})

test('CAN 整题：副作用被重放时整题失败', async () => {
  const result = await runCanTask(CAN_TASK, {
    marker: 'CP-CAN-MARKER-e2e',
    handlers: [
      toolCallSse('call-write-1', 'Write', { path: 'side-effect.txt', content: 'first' }),
      undefined,
      toolCallSse('call-write-2', 'Write', { path: 'side-effect.txt', content: 'replayed' }),
      textSse('剩余任务已完成')
    ]
  })
  assert.equal(result.status, 'failed')
  assert.match(result.can.reasons.join('\n'), /副作用总次数应为 1/)
})

// ── SP010 T4：任务级统计与报告口径 ────────────────────────────────────────

function scored(id, status, extra = {}) {
  return {
    id,
    version: 1,
    group: 'coding_regression',
    category: 'FIX',
    blind: false,
    status,
    outcome: status === 'passed' ? 'completed' : 'error',
    durationMs: 100,
    requestCount: 1,
    tokens: 10,
    ...extra
  }
}

test('任务等权完成率按独立任务平均，同题重复只形成一个分数', () => {
  const scores = collectTaskScores([
    scored('A', 'passed'),
    scored('A', 'passed'),
    scored('A', 'passed'),
    scored('B', 'passed'),
    scored('B', 'failed'),
    scored('B', 'failed')
  ])
  assert.equal(scores.length, 2)
  assert.equal(scores[0].score, 1)
  assert.equal(scores[1].score, 1 / 3)
  const summary = buildSummary({
    runId: 'weighted',
    mode: 'live',
    results: [scored('A', 'passed'), scored('A', 'passed'), scored('A', 'passed'), scored('B', 'passed'), scored('B', 'failed'), scored('B', 'failed')],
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:01:00Z',
    repeats: 3
  })
  assert.equal(summary.completion.independentTasks, 2)
  assert.equal(Math.round(summary.completion.weightedRate * 1000) / 1000, 0.667)
})

test('预算终止计入分母而不是被排除', () => {
  const summary = buildSummary({
    runId: 'budget-denominator',
    mode: 'live',
    results: [
      scored('A', 'passed', { failureClass: undefined }),
      scored('B', 'failed', { failureClass: 'BUDGET' })
    ],
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:01:00Z'
  })
  assert.equal(summary.completion.independentTasks, 2)
  assert.equal(summary.completion.weightedRate, 0.5)
  assert.equal(summary.budgetFailures, 1)
})

test('缺重复与缺任务被列为证据不足', () => {
  const summary = buildSummary({
    runId: 'missing',
    mode: 'live',
    results: [scored('A', 'passed')],
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:01:00Z',
    repeats: 3,
    planned: ['A', 'B']
  })
  assert.equal(summary.completion.evidenceSufficient, false)
  assert.match(summary.completion.reasons.join('\n'), /缺少计划内任务：B/)
  assert.match(summary.completion.reasons.join('\n'), /重复次数不足：A/)
})

test('完成率区间跨越适用门槛时判证据不足', () => {
  const summary = buildSummary({
    runId: 'threshold',
    mode: 'live',
    results: [scored('A', 'passed'), scored('B', 'failed')],
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:01:00Z',
    threshold: 0.8
  })
  assert.equal(summary.completion.evidenceSufficient, false)
  assert.match(summary.completion.reasons.join('\n'), /跨越适用门槛/)
})

test('Hoeffding 区间半宽按任务数收窄且全部通过也保留宽度', () => {
  const narrow = hoeffdingInterval(1, 100)
  const wide = hoeffdingInterval(1, 4)
  assert.ok(narrow.halfWidth < wide.halfWidth)
  assert.ok(Math.abs(narrow.halfWidth - Math.sqrt(Math.log(40) / 200)) < 1e-12)
  assert.ok(Math.abs(narrow.low - (1 - narrow.halfWidth)) < 1e-12)
  assert.ok(narrow.low < 1, '全部通过也必须保留区间宽度')
  assert.ok(wide.high <= 1 && wide.low >= 0)
})

test('报告给出延迟分位数、token 与费用估算', () => {
  const summary = buildSummary({
    runId: 'latency',
    mode: 'live',
    results: [
      scored('A', 'passed', { durationMs: 100, tokens: 100 }),
      scored('B', 'passed', { durationMs: 200, tokens: 100 }),
      scored('C', 'passed', { durationMs: 300, tokens: 100 })
    ],
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:01:00Z',
    pricePerThousandTokens: 0.01
  })
  assert.equal(summary.latency.p50, 200)
  assert.equal(summary.latency.p95, 300)
  assert.equal(summary.tokens, 300)
  assert.equal(summary.cost, 0.003)
})

test('百分位按最近秩取值', () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2)
  assert.equal(percentile([1, 2, 3, 4], 0.95), 4)
  assert.equal(percentile([], 0.5), 0)
})

test('中期报告标注中期结果并禁止替代性措辞', () => {
  const summary = buildSummary({
    runId: 'wording',
    mode: 'live',
    sp: 'SP010',
    slug: 'coding-parity-checkpoint',
    results: [scored('A', 'passed')],
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:01:00Z'
  })
  const md = renderMarkdown(summary)
  assert.match(md, /中期结果/)
  assert.match(md, /SP010 coding-parity-checkpoint/)
  for (const phrase of FORBIDDEN_REPORT_PHRASES) {
    assert.equal(md.includes(phrase), false)
  }
  assert.throws(() => assertReportWording('# 标题\n' + FORBIDDEN_REPORT_PHRASES[0]))
})

// ── SP010 T5：运行身份、续跑校验与落盘脱敏 ─────────────────────────────────

const BASE_IDENTITY = {
  candidateSha: 'abc1234',
  evaluatorVersion: 'cp-v1',
  taskSetVersion: 'cp-v1',
  snapshotDigest: 'digest-1',
  providerId: 'minimax',
  modelId: 'MiniMax-M3.1-Flash',
  runParams: { temperature: 0 },
  budgetVersion: 'cp-v1',
  budgetLimits: { maxRequests: 35, maxTokens: 20000 },
  plannedRepeats: 3
}

test('身份相同的运行可以续跑', () => {
  const saved = buildRunIdentity(BASE_IDENTITY)
  const current = buildRunIdentity(BASE_IDENTITY)
  assert.equal(compareIdentity(saved, current).resumable, true)
  assert.equal(identityDigest(saved), identityDigest(current))
})

test('源码、题集、模型或预算变化时拒绝续跑', () => {
  const saved = buildRunIdentity(BASE_IDENTITY)
  for (const [field, value] of [
    ['candidateSha', 'def5678'],
    ['evaluatorVersion', 'cp-v2'],
    ['taskSetVersion', 'cp-v2'],
    ['snapshotDigest', 'digest-2'],
    ['modelId', 'other-model'],
    ['budgetVersion', 'cp-v2'],
    ['budgetLimits', { maxRequests: 99 }],
    ['plannedRepeats', 5]
  ]) {
    const current = buildRunIdentity({ ...BASE_IDENTITY, [field]: value })
    const comparison = compareIdentity(saved, current)
    assert.equal(comparison.resumable, false, field + ' 变化后必须拒绝续跑')
    assert.ok(comparison.changed.includes(field))
  }
})

test('缺少身份清单时拒绝续跑', () => {
  const comparison = compareIdentity(undefined, buildRunIdentity(BASE_IDENTITY))
  assert.equal(comparison.resumable, false)
  assert.deepEqual(comparison.changed, ['identity'])
})

test('运行结果落盘时盲测条目被脱敏', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sp010-run-results-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const blind = {
    id: 'CP-FIX-03',
    repeat: 1,
    blind: true,
    status: 'failed',
    outcome: 'error',
    error: { class: 'auth', message: 'secret detail' },
    checks: [{ ok: false, message: 'secret assertion' }]
  }
  const plain = {
    id: 'CP-FIX-01',
    repeat: 1,
    blind: false,
    status: 'failed',
    checks: [{ ok: false, message: 'visible' }]
  }
  writeRunResult(dir, blind, redactTaskForDisk)
  writeRunResult(dir, plain, redactTaskForDisk)
  const files = readdirSync(dir).sort()
  assert.deepEqual(files, ['CP-FIX-01-1.json', 'CP-FIX-03-1.json'])
  const blindText = readFileSync(join(dir, 'CP-FIX-03-1.json'), 'utf8')
  assert.equal(blindText.includes('secret detail'), false)
  assert.equal(blindText.includes('secret assertion'), false)
  assert.match(blindText, /"status": "failed"/)
  const plainText = readFileSync(join(dir, 'CP-FIX-01-1.json'), 'utf8')
  assert.match(plainText, /visible/)
})

test('身份清单写入后可被读回并校验', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sp010-identity-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  assert.equal(readIdentity(dir), undefined)
  const identity = buildRunIdentity(BASE_IDENTITY)
  writeIdentity(dir, identity)
  const restored = readIdentity(dir)
  assert.equal(compareIdentity(restored, identity).resumable, true)
  assert.equal(restored.digest, identityDigest(identity))
})
