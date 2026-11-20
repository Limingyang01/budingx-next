// SP006 §12：发布台账与发布说明一致性（NP-01…NP-05 的静态部分）。
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'src/tui/package.json'), 'utf8'))
const ledger = JSON.parse(readFileSync(join(root, 'release-ledger.json'), 'utf8'))

test('SP006 版本在台账中恰好一条 prepared 记录', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  const entries = ledger.releases.filter((entry) => entry.version === pkg.version)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].iteration, 'SP006')
  assert.equal(entries[0].status, 'prepared')
  assert.match(entries[0].sourceCommit, /^[0-9a-f]{40}$/, 'prepared 记录必须有源码 SHA')
  assert.ok('receipt' in entries[0], 'prepared 记录必须有回执占位字段')
  const prepared = ledger.releases.filter((entry) => entry.status === 'prepared')
  assert.equal(prepared.length, 1, '同时只允许一条 prepared 记录')
})

test('发布说明已写实，不是模板草稿', () => {
  const notes = readFileSync(join(root, 'release-notes', 'v' + pkg.version + '.md'), 'utf8')
  assert.doesNotMatch(notes, /replace this draft/)
  assert.match(notes, /## 验证/)
  assert.match(notes, /## 已知限制/)
})

test('SP006 制品验收脚本与所需入口存在', () => {
  assert.ok(existsSync(join(root, 'scripts/release/sp006-packaging.mjs')))
  for (const file of ['headless.js', 'mcp/client.js', 'hooks/runner.js', 'commands/registry.js']) {
    assert.ok(existsSync(join(root, 'src/tui/dist/tui', file)), '缺少构建产物：' + file)
  }
})
