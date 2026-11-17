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

test('glob truncates with a count summary at the reference cap of 100', () => {
  const files = {}
  for (let index = 0; index < 250; index++) files[`f${String(index).padStart(3, '0')}.txt`] = 'x'
  const tree = makeTree(files)
  try {
    const result = globWorkspace(tree.workspace, { pattern: '*.txt' })
    assert.equal(result.shown, 100)
    assert.equal(result.total, 250)
    assert.match(result.text, /\[250 matches, showing 100\]/)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('grep output_mode files_with_matches sorts newest first', () => {
  const tree = makeTree({ 'old.txt': 'needle\n', 'new.txt': 'needle\n' })
  try {
    // Bump new.txt mtime so the order is deterministic.
    const future = new Date(Date.now() + 5000)
    writeFileSync(join(tree.root, 'new.txt'), 'needle\n', { mtime: future })
    const result = grepWorkspace(tree.workspace, {
      pattern: 'needle',
      outputMode: 'files_with_matches'
    })
    assert.match(result.text, /^Found 2 files/)
    assert.ok(result.text.indexOf('new.txt') < result.text.indexOf('old.txt'))
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('grep count mode summarizes occurrences across files', () => {
  const tree = makeTree({ 'a.txt': 'x\nx\n', 'b.txt': 'x\n' })
  try {
    const result = grepWorkspace(tree.workspace, { pattern: 'x', outputMode: 'count' })
    assert.match(result.text, /a\.txt:2/)
    assert.match(result.text, /b\.txt:1/)
    assert.match(result.text, /Found 3 total occurrences across 2 files\./)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('grep context lines -A/-B merge and paginate with head_limit/offset', () => {
  const lines = Array.from({ length: 10 }, (_, i) => `l${i}`)
  lines[2] = 'hit-a'
  lines[7] = 'hit-b'
  const tree = makeTree({ 'f.txt': lines.join('\n') })
  try {
    const withContext = grepWorkspace(tree.workspace, { pattern: 'hit', after: 1, before: 1 })
    assert.match(withContext.text, /f\.txt:2:l1/)
    assert.match(withContext.text, /f\.txt:3:hit-a/)
    assert.match(withContext.text, /f\.txt:4:l3/)
    assert.match(withContext.text, /--/)
    const firstPage = grepWorkspace(tree.workspace, { pattern: 'hit', maxResults: 1 })
    assert.equal(firstPage.shown, 1)
    assert.match(firstPage.text, /\[Showing 1 of 2 matching lines\]/)
    const secondPage = grepWorkspace(tree.workspace, { pattern: 'hit', offset: 1 })
    assert.match(secondPage.text, /hit-b/)
    assert.doesNotMatch(secondPage.text, /hit-a/)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('grep type filter and multiline matching', () => {
  const tree = makeTree({ 'a.ts': 'start\nend\n', 'b.md': 'start\nend\n' })
  try {
    const typed = grepWorkspace(tree.workspace, {
      pattern: 'start',
      outputMode: 'files_with_matches',
      type: 'ts'
    })
    assert.match(typed.text, /^Found 1 file/)
    assert.match(typed.text, /a\.ts/)
    const multiline = grepWorkspace(tree.workspace, {
      pattern: 'start\\s+end',
      multiline: true
    })
    // content mode reports matched display lines: both files match over
    // their two-line spans; without multiline the same pattern finds none.
    assert.equal(multiline.total, 4)
    assert.match(multiline.text, /a\.ts:1/)
    assert.match(multiline.text, /b\.md:1/)
    const notMultiline = grepWorkspace(tree.workspace, { pattern: 'start\\s+end' })
    assert.match(notMultiline.text, /No matches found/)
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
    assert.match(result.text, /Note: 1 binary file skipped\./)
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
