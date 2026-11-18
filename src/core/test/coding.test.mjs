// SP004 T1 · 编码任务完成证据判定（设计 §5.2 判定表，纯函数）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { TASK_PHASES, isTestCommand, canClaimDone } from '../../tui/dist/core/coding.js'

test('TaskPhase 枚举固定为七值', () => {
  assert.deepEqual([...TASK_PHASES], [
    'orienting',
    'editing',
    'testing',
    'fixing',
    'awaiting_user',
    'done',
    'failed'
  ])
})

test('isTestCommand 启发式识别测试类命令', () => {
  const positives = [
    'npm run test:unit',
    'npm test',
    'pnpm test',
    'node --test src/core/test/exec.test.mjs',
    'pytest -q',
    'go test ./...',
    'cargo test',
    'make test',
    'vitest run',
    'jest',
    'mocha',
    'python -m unittest',
    'tox'
  ]
  for (const command of positives) {
    assert.equal(isTestCommand(command), true, command)
  }
  const negatives = ['echo hello', 'node build.mjs', 'git status', 'ls -la', 'npm run build']
  for (const command of negatives) {
    assert.equal(isTestCommand(command), false, command)
  }
})

const baseState = {
  taskId: 'task-1',
  goal: '修复缺陷',
  phase: 'testing',
  iterations: 1
}

test('canClaimDone：无命令证据不通过', () => {
  assert.deepEqual(canClaimDone(undefined), {
    ok: false,
    reason: '未执行过任何命令，无法证明任务完成'
  })
  assert.deepEqual(canClaimDone(baseState), {
    ok: false,
    reason: '未执行过任何命令，无法证明任务完成'
  })
})

test('canClaimDone：最近命令失败/超时/阻塞不通过', () => {
  for (const outcome of ['failed', 'timeout', 'blocked']) {
    const state = {
      ...baseState,
      lastTest: { command: 'npm test', exitCode: 1, outcome, at: 1 },
      testEvidence: { command: 'npm test', exitCode: 0, at: 0 }
    }
    const verdict = canClaimDone(state)
    assert.equal(verdict.ok, false, outcome)
    assert.ok(verdict.reason.includes('最近一次命令未成功'), verdict.reason)
  }
})

test('canClaimDone：成功但非测试类且无测试证据不通过', () => {
  const state = {
    ...baseState,
    lastTest: { command: 'echo hello', exitCode: 0, outcome: 'completed', at: 1 }
  }
  assert.deepEqual(canClaimDone(state), { ok: false, reason: '未运行测试' })
})

test('canClaimDone：测试类命令成功后通过', () => {
  const state = {
    ...baseState,
    lastTest: { command: 'npm test', exitCode: 0, outcome: 'completed', at: 1 },
    testEvidence: { command: 'npm test', exitCode: 0, at: 1 }
  }
  assert.deepEqual(canClaimDone(state), { ok: true })
})

test('canClaimDone：曾有测试成功但最近命令失败仍不通过', () => {
  const state = {
    ...baseState,
    lastTest: { command: 'npm test', exitCode: 2, outcome: 'failed', at: 2 },
    testEvidence: { command: 'npm test', exitCode: 0, at: 1 }
  }
  const verdict = canClaimDone(state)
  assert.equal(verdict.ok, false)
  assert.ok(verdict.reason.includes('需继续修复'), verdict.reason)
})