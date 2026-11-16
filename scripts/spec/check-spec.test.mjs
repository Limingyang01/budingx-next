import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { checkForbiddenClaims, checkInventory, checkManifest, checkSpec, INVENTORY, MANIFEST, ROOT } from './check-spec.mjs'

const read = (file) => readFileSync(path.join(ROOT, file), 'utf8')

test('the capability manifest and task inventory are internally consistent', () => {
  const result = checkSpec()
  assert.deepEqual(result.failures, [])
  assert.equal(result.manifest.total, result.manifest.必交 + result.manifest.建议 + result.manifest.可选 + result.manifest.范围外)
  assert.equal(result.inventory.blind, 20)
})

test('a silently demoted mandatory capability is reported', () => {
  const text = read(MANIFEST).replace('| CAP-L2-15 |', '| CAP-L2-15 |')
  const demoted = text.replace(
    /\n(\| CAP-L2-15 \|[^\n]*)\n/,
    '\n$1\n'
  )
  const broken = demoted.replace(
    '| CAP-L2-15 | 浏览器操作 | 浏览器工具 + 原生宿主 | 导航、定位、点击、输入、等待、截图 | SP014 | 真实进程 | 必交 |',
    '| CAP-L2-15 | 浏览器操作 | 浏览器工具 + 原生宿主 | 导航、定位、点击、输入、等待、截图 | SP014 | 真实进程 | 可选 |'
  )
  assert.notEqual(broken, demoted, 'demotion fixture did not apply')
  const result = checkManifest(broken)
  assert.ok(result.failures.some((f) => f.includes('CAP-L2-15')))
})

test('statistics that disagree with the rows are reported', () => {
  const broken = read(MANIFEST).replace('- 总条目：85', '- 总条目：87')
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
