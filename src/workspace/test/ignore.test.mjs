// Ignore rule tests (SP003 AC WT-12, plan T2).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createIgnoreMatcher } from '../../tui/dist/workspace/ignore.js'

function makeTree(files = {}) {
  const base = mkdtempSync(join(tmpdir(), 'budingx-ignore-'))
  const root = join(base, 'workspace')
  mkdirSync(root)
  for (const [name, content] of Object.entries(files)) {
    const full = join(root, name)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return { base, root }
}

test('a root level pattern ignores the matching file', () => {
  const tree = makeTree({ '.gitignore': '*.log\n', 'debug.log': 'x', 'keep.txt': 'y' })
  try {
    const matcher = createIgnoreMatcher(tree.root)
    assert.equal(matcher.isIgnored(join(tree.root, 'debug.log')), true)
    assert.equal(matcher.isIgnored(join(tree.root, 'keep.txt')), false)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a negation pattern brings a file back', () => {
  const tree = makeTree({ '.gitignore': '*.log\n!keep.log\n', 'a.log': 'x', 'keep.log': 'y' })
  try {
    const matcher = createIgnoreMatcher(tree.root)
    assert.equal(matcher.isIgnored(join(tree.root, 'a.log')), true)
    assert.equal(matcher.isIgnored(join(tree.root, 'keep.log')), false)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a directory only pattern ignores directories', () => {
  const tree = makeTree({ '.gitignore': 'build/\n' })
  try {
    mkdirSync(join(tree.root, 'build'))
    writeFileSync(join(tree.root, 'build', 'out.js'), 'x')
    const matcher = createIgnoreMatcher(tree.root)
    assert.equal(matcher.isIgnoredDirectory(join(tree.root, 'build')), true)
    assert.equal(matcher.isIgnored(join(tree.root, 'build', 'out.js')), true)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('an anchored pattern only matches at the root', () => {
  const tree = makeTree({ '.gitignore': '/only-root.txt\n' })
  try {
    mkdirSync(join(tree.root, 'nested'))
    writeFileSync(join(tree.root, 'nested', 'only-root.txt'), 'x')
    writeFileSync(join(tree.root, 'only-root.txt'), 'x')
    const matcher = createIgnoreMatcher(tree.root)
    assert.equal(matcher.isIgnored(join(tree.root, 'only-root.txt')), true)
    assert.equal(matcher.isIgnored(join(tree.root, 'nested', 'only-root.txt')), false)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a nested gitignore applies to its own directory only', () => {
  const tree = makeTree({
    '.gitignore': '*.tmp\n',
    'nested/.gitignore': 'local.txt\n'
  })
  try {
    writeFileSync(join(tree.root, 'nested', 'local.txt'), 'x')
    writeFileSync(join(tree.root, 'nested', 'other.tmp'), 'x')
    writeFileSync(join(tree.root, 'local.txt'), 'x')
    const matcher = createIgnoreMatcher(tree.root)
    assert.equal(matcher.isIgnored(join(tree.root, 'nested', 'local.txt')), true)
    assert.equal(matcher.isIgnored(join(tree.root, 'nested', 'other.tmp')), true)
    assert.equal(matcher.isIgnored(join(tree.root, 'local.txt')), false)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('the ignore file is honoured as well as gitignore', () => {
  const tree = makeTree({ '.ignore': 'secret.txt\n' })
  try {
    writeFileSync(join(tree.root, 'secret.txt'), 'x')
    const matcher = createIgnoreMatcher(tree.root)
    assert.equal(matcher.isIgnored(join(tree.root, 'secret.txt')), true)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('version control and dependency directories are ignored by default', () => {
  const tree = makeTree({})
  try {
    mkdirSync(join(tree.root, 'node_modules'))
    mkdirSync(join(tree.root, '.git'))
    const matcher = createIgnoreMatcher(tree.root)
    assert.equal(matcher.isIgnored(join(tree.root, 'node_modules')), true)
    assert.equal(matcher.isIgnored(join(tree.root, '.git')), true)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a double star pattern matches across directories', () => {
  const tree = makeTree({ '.gitignore': 'src/**/generated/*.ts\n' })
  try {
    mkdirSync(join(tree.root, 'src', 'deep', 'generated'), { recursive: true })
    writeFileSync(join(tree.root, 'src', 'deep', 'generated', 'a.ts'), 'x')
    writeFileSync(join(tree.root, 'src', 'a.ts'), 'x')
    const matcher = createIgnoreMatcher(tree.root)
    assert.equal(matcher.isIgnored(join(tree.root, 'src', 'deep', 'generated', 'a.ts')), true)
    assert.equal(matcher.isIgnored(join(tree.root, 'src', 'a.ts')), false)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('comments and blank lines are skipped', () => {
  const tree = makeTree({ '.gitignore': '# a comment\n\n   \n*.tmp\n' })
  try {
    writeFileSync(join(tree.root, 'a.tmp'), 'x')
    const matcher = createIgnoreMatcher(tree.root)
    assert.equal(matcher.isIgnored(join(tree.root, 'a.tmp')), true)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})
