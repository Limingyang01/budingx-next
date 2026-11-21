// SP006 §12：发布台账与发布说明一致性（NP-01…NP-05 的静态部分）。
// 版本准备会把当前源码版本从 published 推进到 prepared，因此这里的断言按「当前版本状态」
// 分支校验：published 必须有完整回执证据，prepared 必须有发行说明且不得与该版本已发布记录并存。
// 0.6.0 的历史发布记录仍单独校验，防止放宽到「什么都不断言」。
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'src/tui/package.json'), 'utf8'))
const ledger = JSON.parse(readFileSync(join(root, 'release-ledger.json'), 'utf8'))
const notesPath = join(root, 'release-notes', 'v' + pkg.version + '.md')

// 0.1.0 是引导发布（authMode: session，手工首次发布），早于 GitHub Actions + OIDC 流水线：
// 它只有 validationRun、sourceCommit 为 null。其余已发布记录都必须有 workflowRun 与源码 SHA。
function assertPublished(entry, label) {
  if (entry.authMode === 'session') {
    assert.equal(entry.sourceCommit, null)
  } else {
    assert.match(entry.sourceCommit, /^[0-9a-f]{40}$/, label + ' 发布记录必须有源码 SHA')
  }
  assert.match(entry.integrity, /^sha512-/, label + ' 发布记录必须有 registry integrity')
  assert.equal(entry.tag, 'latest', label + ' 发布记录的 dist-tag')
  const run = entry.workflowRun ?? entry.validationRun
  assert.match(run, /\/actions\/runs\/\d+$/, label + ' 发布记录必须有工作流或校验运行地址')
}

test('当前源码版本在台账中恰好一条记录且状态自洽', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  const entries = ledger.releases.filter((entry) => entry.version === pkg.version)
  assert.equal(entries.length, 1, '当前版本在台账中只能有一条记录')
  const [entry] = entries
  assert.match(entry.iteration, /^SP\d{3}$/)
  if (entry.status === 'published') {
    assertPublished(entry, pkg.version)
    assert.equal(ledger.releases.filter((item) => item.status === 'prepared').length, 0, '发布后不得残留 prepared 记录')
  } else {
    assert.equal(entry.status, 'prepared', '当前版本状态只能是 published 或 prepared')
    assert.equal(ledger.releases.filter((item) => item.status === 'prepared').length, 1, '同一时刻最多一条 prepared 记录')
    assert.ok(existsSync(notesPath), 'prepared 版本必须有发行说明')
  }
})

test('全部已发布记录都有完整证据，0.6.0 仍为 SP006 published', () => {
  const published = ledger.releases.filter((entry) => entry.status === 'published')
  assert.ok(published.length > 0, '台账至少要有一条已发布记录')
  for (const entry of published) assertPublished(entry, entry.version)
  const sp006 = ledger.releases.filter((entry) => entry.version === '0.6.0')
  assert.equal(sp006.length, 1)
  assert.equal(sp006[0].iteration, 'SP006')
  assert.equal(sp006[0].status, 'published')
  assert.equal(sp006[0].tag, 'latest')
  assert.ok('receipt' in sp006[0], '0.6.0 发布记录必须保留回执占位字段')
})

test('当前版本发行说明已写实，不是模板草稿', () => {
  const notes = readFileSync(notesPath, 'utf8')
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
