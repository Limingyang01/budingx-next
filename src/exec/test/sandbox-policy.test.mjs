// SP004 T20 · 执行隔离门禁（设计 §4.7，CE-19）。
// 无已验证后端 → 普通 Bash/PowerShell 在 spawn 前结构化拒绝；模型不能选取/关闭隔离。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSandboxPolicy } from '../../tui/dist/exec/sandbox-policy.js'
import { ERROR_CODES } from '../../tui/dist/core/constants.js'

function backend(overrides = {}) {
  const { capabilities, ...rest } = overrides
  return {
    id: 'synthetic-backend',
    label: '合成验收后端',
    verified: true,
    capabilities: {
      allowWrite: ['D:/fixture/project'],
      denyWrite: ['D:/fixture/project/.git'],
      allowRead: ['D:/fixture/project'],
      denyRead: ['C:/Users/test/.ssh'],
      networkDomains: [],
      canEnforceNetwork: true,
      ...capabilities
    },
    ...rest
  }
}

test('无后端：普通 Bash/PowerShell 拒绝，错误码 BUDINGX_EXEC_005', () => {
  const policy = createSandboxPolicy({})
  for (const tool of ['Bash', 'PowerShell']) {
    const decision = policy.decide({ tool, command: 'node -e "process.exit(0)"' })
    assert.equal(decision.action, 'deny')
    assert.equal(decision.code, ERROR_CODES.execSandboxUnavailable)
    assert.match(decision.reason, /隔离|后端/)
  }
  assert.equal(policy.backend(), undefined)
})

test('未经真实进程验收的后端同样拒绝', () => {
  const policy = createSandboxPolicy({ backend: backend({ verified: false }) })
  const decision = policy.decide({ tool: 'Bash', command: 'ls' })
  assert.equal(decision.action, 'deny')
  assert.equal(decision.code, ERROR_CODES.execSandboxUnavailable)
})

test('配置网络域名但后端不能强制执行 → 拒绝该执行请求', () => {
  const policy = createSandboxPolicy({
    backend: backend({ capabilities: { networkDomains: ['example.com'], canEnforceNetwork: false } })
  })
  const decision = policy.decide({ tool: 'Bash', command: 'curl https://example.com' })
  assert.equal(decision.action, 'deny')
  assert.match(decision.reason, /网络/)
})

test('已验收后端 + 默认断网 → 放行并携带后端身份', () => {
  const policy = createSandboxPolicy({ backend: backend() })
  const decision = policy.decide({ tool: 'Bash', command: 'node -e "process.exit(0)"' })
  assert.equal(decision.action, 'allow')
  assert.equal(decision.backendId, 'synthetic-backend')
  assert.deepEqual(policy.backend().capabilities.networkDomains, [])
})

test('已验收后端 + 可强制网络策略 → 放行', () => {
  const policy = createSandboxPolicy({
    backend: backend({ capabilities: { networkDomains: ['example.com'], canEnforceNetwork: true } })
  })
  const decision = policy.decide({ tool: 'PowerShell', command: 'Get-ChildItem' })
  assert.equal(decision.action, 'allow')
})

test('模型侧隔离控制字段一律拒绝（即使后端已验收）', () => {
  const policy = createSandboxPolicy({ backend: backend() })
  for (const modelInput of [
    { dangerouslyDisableSandbox: true },
    { sandbox: 'off' },
    { sandbox: { enabled: false } },
    { isolation: 'none' }
  ]) {
    const decision = policy.decide({ tool: 'Bash', command: 'ls', modelInput })
    assert.equal(decision.action, 'deny', JSON.stringify(modelInput))
    assert.match(decision.reason, /模型|隔离/)
  }
})

test('判定为纯同步决策：拒绝路径不产生任何进程（零 spawn 由结构保证）', () => {
  const policy = createSandboxPolicy({})
  const decision = policy.decide({ tool: 'Bash', command: 'rm -rf /' })
  assert.equal(decision.action, 'deny')
  // 策略对象只暴露 decide/backend，没有执行入口；spawn 计数断言在 T3 runner 测试中以注入 spawn 完成。
  assert.deepEqual(Object.keys(policy).sort(), ['backend', 'decide'])
})

test('0.5.4 宿主信任模式：无隔离后端时放行，交由权限档位审批', () => {
  const policy = createSandboxPolicy({ hostTrusted: true })
  const decision = policy.decide({ tool: 'Bash', command: 'node -e "console.log(1)"' })
  assert.equal(decision.action, 'allow')
  assert.equal(decision.backendId, 'host-trusted')
})

test('0.5.4 宿主信任模式仍拒绝模型侧隔离控制字段', () => {
  const policy = createSandboxPolicy({ hostTrusted: true })
  const decision = policy.decide({ tool: 'Bash', command: 'ls', modelInput: { dangerouslyDisableSandbox: true } })
  assert.equal(decision.action, 'deny')
})

test('0.5.4 已验收隔离后端优先于宿主信任（不降级隔离）', () => {
  const policy = createSandboxPolicy({ hostTrusted: true, backend: backend() })
  const decision = policy.decide({ tool: 'Bash', command: 'ls' })
  assert.equal(decision.action, 'allow')
  assert.equal(decision.backendId, 'synthetic-backend')
})

test('0.5.4 未验收后端即使开启宿主信任也拒绝（不能伪装隔离）', () => {
  const policy = createSandboxPolicy({ hostTrusted: true, backend: backend({ verified: false }) })
  const decision = policy.decide({ tool: 'Bash', command: 'ls' })
  assert.equal(decision.action, 'deny')
})
