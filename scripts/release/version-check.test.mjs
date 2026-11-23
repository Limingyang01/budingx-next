import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { runVersionCheck } from './version-check.mjs'

const VERSION = '1.2.3'
const PUBLISHED = '1.2.2'

function fixture(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'budingx-version-'))
  const product = path.join(root, 'src', 'tui')
  mkdirSync(product, { recursive: true })
  mkdirSync(path.join(root, 'release-notes'), { recursive: true })
  mkdirSync(path.join(root, 'docs'), { recursive: true })
  const files = {
    'src/tui/package.json': JSON.stringify(
      {
        name: 'budingx',
        version: VERSION,
        license: 'MIT',
        engines: { node: '>=22.18.0' }
      },
      null,
      2
    ),
    'release-ledger.json': JSON.stringify(
      {
        schemaVersion: 1,
        releases: [
          { version: PUBLISHED, iteration: 'SP008', status: 'published' },
          { version: VERSION, iteration: 'SP009', status: 'prepared' }
        ]
      },
      null,
      2
    ),
    [`release-notes/v${VERSION}.md`]: `# v${VERSION} · SP009\n`,
    'PRODUCT.md': [
      `# budingx 产品说明书`,
      '',
      `> **已发布版本**：${PUBLISHED}（\`latest\`）。`,
      `> **当前源码版本**：${VERSION}`,
      '> 需要 **Node.js ≥ 22.18** 与 npm。',
      ''
    ].join('\n'),
    'src/tui/README.md': [
      '# budingx',
      '',
      `npm \`latest\` is ${PUBLISHED}. This source is ${VERSION}.`,
      'Requires Node.js >= 22.18.',
      ''
    ].join('\n'),
    'docs/current-status.md': [
      '# 当前状态',
      '',
      `当前版本 ${VERSION}，已发布 ${PUBLISHED}。`,
      ''
    ].join('\n'),
    ...overrides
  }
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  return root
}

const ids = (result) => result.checks.filter((check) => !check.ok).map((c) => c.id)

test('a consistent tree passes every check', async () => {
  const root = fixture()
  try {
    const result = await runVersionCheck({ root })
    assert.equal(result.exitCode, 0)
    assert.deepEqual(ids(result), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a version without a ledger entry is reported', async () => {
  const root = fixture({
    'release-ledger.json': JSON.stringify(
      { schemaVersion: 1, releases: [{ version: PUBLISHED, status: 'published' }] },
      null,
      2
    )
  })
  try {
    const result = await runVersionCheck({ root })
    assert.equal(result.exitCode, 1)
    assert.ok(ids(result).includes('ledger'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('missing release notes are reported', async () => {
  const root = fixture()
  try {
    rmSync(path.join(root, 'release-notes', `v${VERSION}.md`))
    const result = await runVersionCheck({ root })
    assert.equal(result.exitCode, 1)
    assert.ok(ids(result).includes('release-notes'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a draft release note is reported', async () => {
  const root = fixture({
    [`release-notes/v${VERSION}.md`]: `# v${VERSION} · SP009\n\nreplace this draft\n`
  })
  try {
    const result = await runVersionCheck({ root })
    assert.equal(result.exitCode, 1)
    assert.ok(ids(result).includes('release-notes'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a product manual that does not mention the version is reported', async () => {
  const root = fixture({
    'PRODUCT.md': '# budingx 产品说明书\n\n> **已发布版本**：1.2.2（`latest`）。\n'
  })
  try {
    const result = await runVersionCheck({ root })
    assert.equal(result.exitCode, 1)
    assert.ok(ids(result).includes('product-manual'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a stale published version in the product manual is reported', async () => {
  const root = fixture({
    'PRODUCT.md': [
      '# budingx 产品说明书',
      '',
      '> **已发布版本**：1.0.0（`latest`）。',
      `> **当前源码版本**：${VERSION}`,
      '> 需要 **Node.js ≥ 22.18** 与 npm。',
      ''
    ].join('\n')
  })
  try {
    const result = await runVersionCheck({ root })
    assert.equal(result.exitCode, 1)
    assert.ok(ids(result).includes('published-version'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a readme that does not mention the version is reported', async () => {
  const root = fixture({
    'src/tui/README.md': '# budingx\n\nRequires Node.js >= 22.18.\n'
  })
  try {
    const result = await runVersionCheck({ root })
    assert.equal(result.exitCode, 1)
    assert.ok(ids(result).includes('readme'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a status document that does not mention the version is reported', async () => {
  const root = fixture({
    'docs/current-status.md': '# 当前状态\n\n没有版本信息。\n'
  })
  try {
    const result = await runVersionCheck({ root })
    assert.equal(result.exitCode, 1)
    assert.ok(ids(result).includes('current-status'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a minimum node version that differs from the manual is reported', async () => {
  const root = fixture({
    'PRODUCT.md': [
      '# budingx 产品说明书',
      '',
      `> **已发布版本**：${PUBLISHED}（\`latest\`）。`,
      `> **当前源码版本**：${VERSION}`,
      '> 需要 **Node.js ≥ 20.0** 与 npm。',
      ''
    ].join('\n')
  })
  try {
    const result = await runVersionCheck({ root })
    assert.equal(result.exitCode, 1)
    assert.ok(ids(result).includes('node-engine'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
