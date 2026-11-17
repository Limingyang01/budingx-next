import assert from 'node:assert/strict'
import { test } from 'node:test'
import { auditReport, scanOutgoingPaths } from './cross-validate.mjs'

test('outgoing 路径扫描拦截依赖/产物/凭据/异源 lockfile', () => {
  const violations = scanOutgoingPaths([
    'src/tui/app.tsx',
    'node_modules/ink/package.json',
    'src/tui/dist/tui/cli.js',
    'artifacts/merge-gate/x.json',
    '.env',
    '.env.local',
    'home/credentials.json',
    'secrets/server.pem',
    'pnpm-lock.yaml',
    'src/tui/tsconfig.tsbuildinfo',
    'package-lock.json',
    'SP/SP002/test-report.md'
  ])
  assert.deepEqual(violations, [
    'node_modules/ink/package.json',
    'src/tui/dist/tui/cli.js',
    'artifacts/merge-gate/x.json',
    '.env',
    '.env.local',
    'home/credentials.json',
    'secrets/server.pem',
    'pnpm-lock.yaml',
    'src/tui/tsconfig.tsbuildinfo'
  ])
})

test('报告审计：FAIL 行阻断，UNVERIFIED 需恢复条件节', () => {
  const bad = auditReport('| AC-01 | x | FAIL |\n## 4. 未验证项与恢复条件\nUNVERIFIED')
  assert.equal(bad.fails.length, 1)
  assert.equal(bad.hasRecovery, true)
  const ok = auditReport('| AC-01 | x | PASS |\nUNVERIFIED（缺凭据）\n## 4. 未验证项与恢复条件\n恢复条件＝提供凭据')
  assert.equal(ok.fails.length, 0)
  assert.equal(ok.unverified, 1)
  assert.equal(ok.hasRecovery, true)
  const noRecovery = auditReport('UNVERIFIED')
  assert.equal(noRecovery.hasRecovery, false)
})

test('报告审计不误伤 PASS 与 NOT_APPLICABLE', () => {
  const result = auditReport('| AC-01 | PASS |\n| AC-02 | NOT_APPLICABLE |\n| AC-03 | PASS 9 / N/A 1 |')
  assert.equal(result.fails.length, 0)
})
