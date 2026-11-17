// Glob and Grep tests (SP003 AC WT-09/WT-10/WT-13, plan T6).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspace } from '../../tui/dist/workspace/paths.js'
import { globWorkspace, grepWorkspace } from '../../tui/dist/workspace/search.js'

function makeTree(files = {}, gitignore = '') {
  const base = mkdtempSync(join(tmpdir(), 'budingx-search-'))
  const root = join(base, 'workspace')
  mkdirSync(root)
  if (gitignore) writeFileSync(join(root, '.gitignore'), gitignore)
  for (const [name, content] of Object.entries(files)) {
    const full = join(root, name)
    mkdirSync(join(full, '..'), { recursive: true })
    if (typeof content === 'string') writeFileSync(full, content)
    else writeFileSync(full, content)
  }
  return { base, root, workspace: createWorkspace(root) }
}

test('a recursive glob finds files in any depth in stable order', () => {
  const tree = makeTree({ 'src/a.ts': 'x', 'src/deep/b.ts': 'x', 'readme.md': 'x' })
  try {
    const result = globWorkspace(tree.workspace, { pattern: '**/*.ts' })
    assert.deepEqual(result.text.split('\n').slice(0, 2), ['src/a.ts', 'src/deep/b.ts'])
    assert.equal(result.total, 2)
    assert.match(result.text, /\[2 matches\]/)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a top level pattern does not cross directories', () => {
  const tree = makeTree({ 'a.ts': 'x', 'src/b.ts': 'x' })
  try {
    const result = globWorkspace(tree.workspace, { pattern: '*.ts' })
    assert.equal(result.total, 1)
    assert.match(result.text, /^a\.ts/)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('ignored files never appear in glob results', () => {
  const tree = makeTree(
    { 'keep.ts': 'x', 'skip.log': 'x', 'node_modules/pkg/i.ts': 'x' },
    '*.log\n'
  )
  try {
    const result = globWorkspace(tree.workspace, { pattern: '**/*' })
    assert.match(result.text, /keep\.ts/)
    assert.doesNotMatch(result.text, /skip\.log/)
    assert.doesNotMatch(result.text, /node_modules/)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('glob truncates with a count summary', () => {
  const files = {}
  for (let index = 0; index < 250; index++) files[`f${String(index).padStart(3, '0')}.txt`] = 'x'
  const tree = makeTree(files)
  try {
    const result = globWorkspace(tree.workspace, { pattern: '*.txt' })
    assert.equal(result.shown, 200)
    assert.equal(result.total, 250)
    assert.match(result.text, /\[250 matches, showing 200\]/)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('grep returns file, line number and content', () => {
  const tree = makeTree({ 'src/a.ts': 'first\nneedle here\nthird\n', 'src/b.ts': 'nothing\n' })
  try {
    const result = grepWorkspace(tree.workspace, { pattern: 'needle' })
    assert.match(result.text, /src\/a\.ts:2:needle here/)
    assert.equal(result.total, 1)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('grep honours case_insensitive and the glob filter', () => {
  const tree = makeTree({ 'a.ts': 'Needle\n', 'b.md': 'Needle\n' })
  try {
    const ci = grepWorkspace(tree.workspace, { pattern: 'needle', caseInsensitive: true })
    assert.equal(ci.total, 2)
    const filtered = grepWorkspace(tree.workspace, {
      pattern: 'needle',
      caseInsensitive: true,
      glob: '**/*.ts'
    })
    assert.equal(filtered.total, 1)
    assert.match(filtered.text, /a\.ts:1:Needle/)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('grep skips binary files and reports the skip count', () => {
  const tree = makeTree({
    'text.txt': 'needle\n',
    'data.bin': Buffer.from([0x00, 0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65])
  })
  try {
    const result = grepWorkspace(tree.workspace, { pattern: 'needle' })
    assert.equal(result.total, 1)
    assert.match(result.text, /1 binary files skipped/)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('an invalid regular expression is a readable tool error', () => {
  const tree = makeTree({ 'a.txt': 'x' })
  try {
    assert.throws(
      () => grepWorkspace(tree.workspace, { pattern: '[unclosed' }),
      (error) => /Invalid regular expression/.test(error.message)
    )
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('an aborted signal stops the search promptly', () => {
  const tree = makeTree({ 'a.ts': 'needle\n' })
  try {
    const controller = new AbortController()
    controller.abort()
    assert.throws(
      () => globWorkspace(tree.workspace, { pattern: '**/*.ts', signal: controller.signal }),
      (error) => /cancelled/i.test(error.message)
    )
    assert.throws(
      () => grepWorkspace(tree.workspace, { pattern: 'needle', signal: controller.signal }),
      (error) => /cancelled/i.test(error.message)
    )
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})
