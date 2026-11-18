// SP004 T1 · 命令执行 core 端口契约（设计 §4.1 / §4.3）。
// 类型契约由 TS 编译期检查；本文件断言运行期常量、枚举与纯函数。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COMMAND_OUTCOMES,
  EXEC_DEFAULT_TIMEOUT_MS,
  EXEC_MAX_TIMEOUT_MS,
  EXEC_HARD_TIMEOUT_MS,
  EXEC_BLOCKING_BUDGET_MS,
  EXEC_OUTPUT_CAP,
  EXEC_PERSIST_THRESHOLD,
  isCommandResult,
  resolveTimeoutConfig
} from '../../tui/dist/core/exec.js'
import { ERROR_CODES } from '../../tui/dist/core/constants.js'

test('CommandOutcome 枚举固定为六值', () => {
  assert.deepEqual([...COMMAND_OUTCOMES], [
    'completed',
    'failed',
    'timeout',
    'cancelled',
    'blocked',
    'running'
  ])
})

test('执行常量与设计 §4.3 数值一致', () => {
  assert.equal(EXEC_DEFAULT_TIMEOUT_MS, 120000)
  assert.equal(EXEC_MAX_TIMEOUT_MS, 600000)
  assert.equal(EXEC_HARD_TIMEOUT_MS, 900000)
  assert.equal(EXEC_BLOCKING_BUDGET_MS, 15000)
  assert.equal(EXEC_OUTPUT_CAP, 32768)
  assert.equal(EXEC_PERSIST_THRESHOLD, 1048576)
})

test('BUDINGX_EXEC_* 错误码登记完整且唯一', () => {
  const expected = {
    execInterpreterUnavailable: 'BUDINGX_EXEC_001',
    execTimeout: 'BUDINGX_EXEC_002',
    execInteractiveUnsupported: 'BUDINGX_EXEC_003',
    execBlockingCommand: 'BUDINGX_EXEC_004',
    execSandboxUnavailable: 'BUDINGX_EXEC_005',
    execHardTimeoutExceeded: 'BUDINGX_EXEC_006',
    execCancelled: 'BUDINGX_EXEC_007'
  }
  for (const [key, code] of Object.entries(expected)) {
    assert.equal(ERROR_CODES[key], code, `ERROR_CODES.${key}`)
  }
  const codes = Object.values(ERROR_CODES)
  assert.equal(new Set(codes).size, codes.length, '错误码不得重复')
})

test('isCommandResult 校验必填字段形状', () => {
  const minimal = {
    outcome: 'completed',
    exitCode: 0,
    stdout: 'ok',
    stderr: '',
    output: 'ok',
    truncated: false,
    bytes: 2,
    durationMs: 5
  }
  assert.equal(isCommandResult(minimal), true)
  assert.equal(isCommandResult({ ...minimal, outcome: 'running', taskId: 'task-1' }), true)
  assert.equal(isCommandResult({ ...minimal, outcome: 'done' }), false, '未知 outcome 拒绝')
  assert.equal(isCommandResult({ ...minimal, stdout: 1 }), false, 'stdout 必须是字符串')
  assert.equal(isCommandResult({ ...minimal, truncated: 'no' }), false, 'truncated 必须是布尔')
  assert.equal(isCommandResult({ ...minimal, bytes: '2' }), false, 'bytes 必须是数字')
  const { durationMs: _drop, ...missing } = minimal
  assert.equal(isCommandResult(missing), false, '缺必填字段拒绝')
  assert.equal(isCommandResult(null), false)
  assert.equal(isCommandResult('completed'), false)
})

test('resolveTimeoutConfig 默认值与环境变量覆盖', () => {
  const base = resolveTimeoutConfig({})
  assert.equal(base.defaultMs, EXEC_DEFAULT_TIMEOUT_MS)
  assert.equal(base.maxMs, EXEC_MAX_TIMEOUT_MS)
  assert.equal(base.hardMs, EXEC_HARD_TIMEOUT_MS)

  const overridden = resolveTimeoutConfig({
    BUDINGX_EXEC_DEFAULT_TIMEOUT_MS: '5000',
    BUDINGX_EXEC_MAX_TIMEOUT_MS: '60000'
  })
  assert.equal(overridden.defaultMs, 5000)
  assert.equal(overridden.maxMs, 60000)
  assert.equal(overridden.hardMs, EXEC_HARD_TIMEOUT_MS, '硬上限不可覆盖')

  const invalid = resolveTimeoutConfig({
    BUDINGX_EXEC_DEFAULT_TIMEOUT_MS: 'abc',
    BUDINGX_EXEC_MAX_TIMEOUT_MS: '-1'
  })
  assert.equal(invalid.defaultMs, EXEC_DEFAULT_TIMEOUT_MS, '非法覆盖回落默认')
  assert.equal(invalid.maxMs, EXEC_MAX_TIMEOUT_MS)
})