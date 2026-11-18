import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { checkForbiddenClaims, checkInventory, checkManifest, checkRoadmap, checkSpec, INVENTORY, MANIFEST, ROOT } from './check-spec.mjs'

const read = (file) => readFileSync(path.join(ROOT, file), 'utf8')

test('the capability manifest and task inventory are internally consistent', () => {
  const result = checkSpec()
  assert.deepEqual(result.failures, [])
  assert.equal(result.manifest.total, result.manifest.必交 + result.manifest.建议 + result.manifest.可选 + result.manifest.范围外)
  assert.equal(result.inventory.blind, 20)
})

test('a removed capability cannot acquire a delivery iteration', () => {
  const original = read(MANIFEST)
  const broken = original.replace(
    '| CAP-L4-13 | Desktop 工作台 | 桌面端约 11.9 万行 | 独立安装可用、崩溃不重复执行 | — | — | 范围外 |',
    '| CAP-L4-13 | Desktop 工作台 | 桌面端约 11.9 万行 | 独立安装可用、崩溃不重复执行 | SP010 | 真实进程+UI | 范围外 |'
  )
  assert.notEqual(broken, original, 'out-of-scope fixture did not apply')
  const result = checkManifest(broken)
  assert.ok(result.failures.some((f) => f.includes('CAP-L4-13')))
})

test('an active capability cannot use an iteration outside the current roadmap', () => {
  const original = read(MANIFEST)
  const broken = original.replace(
    /(^\| CAP-L4-09 \|[^\n]*\| )SP008( \|)/m,
    '$1SP019$2'
  )
  assert.notEqual(broken, original, 'retired iteration fixture did not apply')
  assert.ok(checkManifest(broken).failures.some((f) => f.includes('SP019') && f.includes('CAP-L4-09')))
})

test('the current roadmap rejects a gap after SP015', () => {
  const original = read('docs/iteration-plan.md')
  const broken = original.replace(
    /(^\| )SP016( \| 当前范围完整替代验收)/m,
    '$1SP019$2'
  )
  assert.notEqual(broken, original, 'roadmap gap fixture did not apply')
  assert.ok(checkRoadmap(broken).some((failure) => failure.includes('SP016')))
})

test('a silently deleted out-of-scope baseline capability is reported', () => {
  const original = read(MANIFEST)
  const broken = original
    .split('\n')
    .filter((line) => !line.startsWith('| CAP-L4-15 '))
    .join('\n')
  assert.notEqual(broken, original, 'deletion fixture did not apply')
  const result = checkManifest(broken)
  assert.ok(result.failures.some((f) => f.includes('CAP-L4-15')))
})

test('a silently demoted mandatory capability is reported', () => {
  const original = read(MANIFEST)
  const broken = original.replace(/^(\| CAP-L2-15 \|[^\n]*)\| 必交 \|$/m, '$1| 可选 |')
  assert.notEqual(broken, original, 'demotion fixture did not apply')
  assert.ok(checkManifest(broken).failures.some((f) => f.includes('CAP-L2-15')))
})

test('statistics that disagree with the rows are reported', () => {
  const broken = read(MANIFEST).replace(/- 总条目：\d+$/m, '- 总条目：999')
  const result = checkManifest(broken)
  assert.ok(result.failures.some((f) => f.includes('总条目')))
})

test('a task inventory with a broken blind-test count is reported', () => {
  const original = read(INVENTORY)
  const broken = original.replace('| true |', '| false |')
  assert.notEqual(broken, original, 'blind fixture did not apply')
  const result = checkInventory(broken)
  assert.ok(result.failures.some((f) => f.includes('盲测')))
})

test('an incomplete task inventory is reported', () => {
  const broken = read(INVENTORY)
    .split('\n')
    .filter((line) => !line.startsWith('| TASK-B30 '))
    .join('\n')
  const result = checkInventory(broken)
  assert.ok(result.failures.some((f) => f.includes('TASK-B')))
})

test('an unqualified alignment claim is reported', () => {
  const failures = checkForbiddenClaims([
    { file: 'x.md', text: '本轮已对齐原 Agent 的水平。' }
  ])
  assert.ok(failures.some((f) => f.includes('已对齐')))
})

test('a line that bans the alignment wording is allowed', () => {
  const failures = checkForbiddenClaims([
    { file: 'x.md', text: '禁用「已对齐」措辞。' }
  ])
  assert.deepEqual(failures, [])
})
