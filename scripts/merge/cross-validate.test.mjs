import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { existsSync } from 'node:fs'
import { auditReport, reportFileForBranch, reportFileForMaster, spDirectories, ROOT, scanOutgoingPaths } from './cross-validate.mjs'

test('报告路径约定：SP 分支读当轮报告，feature 规划分支读 docs/requirements 记录', () => {
  assert.equal(reportFileForBranch('feature/SP002/foo'), path.join(ROOT, 'SP', 'SP002', 'test-report.md'))
  assert.equal(
    reportFileForBranch('feature/tui-first-planning'),
    path.join(ROOT, 'docs', 'requirements', 'tui-first-planning', 'test-report.md')
  )
  assert.equal(reportFileForBranch('master'), null)
  assert.equal(reportFileForBranch('feature/bad slug'), null)
})

test('master 自身复核：审计仓内最新一份 SP 报告，跳过尚无报告的计划轮', () => {
  const dirs = spDirectories()
  assert.ok(dirs.length > 0, '仓内应存在 SP 轮次目录')
  // 契约：审计「最新一份真实存在的报告」。PLANNED 轮次目录可以先于报告存在
  // （2026-11-24 登记 SP011/SP015 需求时即如此），不得因此判缺失或审计空目录。
  const withReport = dirs.filter((dir) => existsSync(path.join(ROOT, 'SP', dir, 'test-report.md')))
  assert.ok(withReport.length > 0, '仓内应至少存在一轮带验证报告的 SP')
  const file = reportFileForMaster(dirs)
  assert.equal(file, path.join(ROOT, 'SP', withReport[withReport.length - 1], 'test-report.md'))
  assert.ok(existsSync(file), 'master 审计目标报告应真实存在')
  assert.equal(reportFileForMaster([]), null)
})

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

test('报告审计跳过汇总表表头与分隔行（列名 FAIL 不算失败）', () => {
  const result = auditReport(
    '| 需求 | AC 数 | PASS | UNVERIFIED | FAIL |\n| --- | --- | --- | --- | --- |\n| provider-streaming | 8 | 7 | 1（PS-08） | 0 |'
  )
  assert.equal(result.fails.length, 0)
})

test('报告审计跳过汇总表零计数行（| FAIL | **0** | 与 | FAIL | 0 | 不是失败）', () => {
  const summary = auditReport(
    '| 指标 | 结果 |\n| --- | --- |\n| PASS | **69** |\n| PARTIAL | **0** |\n| FAIL | **0** |\n| UNVERIFIED | **0** |'
  )
  assert.equal(summary.fails.length, 0)
  const plain = auditReport('| 结论 | 条数 |\n| --- | --- |\n| PASS | 46 |\n| FAIL | 0 |\n| UNVERIFIED | 0 |')
  assert.equal(plain.fails.length, 0)
  const nonZero = auditReport('| 结论 | 条数 |\n| --- | --- |\n| FAIL | 3 |')
  assert.equal(nonZero.fails.length, 1)
})

test('报告审计仍拦截无计数与带说明的失败行', () => {
  assert.equal(auditReport('| AC-01 | x | FAIL |').fails.length, 1)
  assert.equal(auditReport('FAIL：something broke').fails.length, 1)
  assert.equal(auditReport('| FAIL | **2** |').fails.length, 1)
  assert.equal(auditReport('| FAIL | 0（无失败） |').fails.length, 0)
})

test('报告审计按「FAIL 行 N」式计数判定（0 不阻断，非 0 阻断）', () => {
  assert.equal(auditReport('| 报告审计 | FAIL 行 0；UNVERIFIED 行 3 |').fails.length, 0)
  assert.equal(auditReport('| 报告审计 | FAIL 行 2；UNVERIFIED 行 0 |').fails.length, 1)
  assert.equal(auditReport('| 结论 | FAIL 0 条 |').fails.length, 0)
  assert.equal(auditReport('| 结论 | FAIL 3 条 |').fails.length, 1)
})
