// @ file reference tests (SP003 AC FC-04 … FC-07, plan T14).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspace } from '../../tui/dist/workspace/paths.js'
import {
  buildContextBlocks,
  extractFileReferences,
  resolveFileReferences
} from '../../tui/dist/workspace/context.js'
import { MAX_CONTEXT_LINES } from '../../tui/dist/workspace/constants.js'

function makeTree(files = {}) {
  const base = mkdtempSync(join(tmpdir(), 'budingx-ctx-'))
  const root = join(base, 'workspace')
  mkdirSync(root)
  for (const [name, content] of Object.entries(files)) {
    const full = join(root, name)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return { base, root, workspace: createWorkspace(root) }
}

test('extract finds plain and quoted @ tokens and skips escaped ones', () => {
  const refs = extractFileReferences(
    'explain @src/a.ts and @"my file.ts", also \\@not-a-path, dup @src/a.ts'
  )
  assert.deepEqual(
    refs.map((ref) => ref.path),
    ['src/a.ts', 'my file.ts']
  )
})

test('an existing file becomes a context block with its content', () => {
  const tree = makeTree({ 'a.ts': 'export const a = 1\n' })
  try {
    const build = resolveFileReferences(tree.workspace, 'look at @a.ts')
    assert.equal(build.blocks.length, 1)
    assert.equal(build.blocks[0].source, 'a.ts')
    assert.match(build.blocks[0].content, /export const a = 1/)
    assert.deepEqual(build.errors, [])
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('missing, outside and unreadable references get readable errors', () => {
  const tree = makeTree({})
  try {
    const build = resolveFileReferences(
      tree.workspace,
      '@nope.ts and @../outside.ts'
    )
    assert.equal(build.blocks.length, 0)
    assert.equal(build.errors.length, 2)
    assert.match(build.errors[0].message, /not found/i)
    assert.match(build.errors[1].message, /outside the workspace/i)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('an image reference becomes a placeholder, never fake content', () => {
  const tree = makeTree({})
  try {
    const png = Buffer.alloc(24)
    png.writeUInt32BE(0x89504e47, 0)
    png.writeUInt32BE(13, 4)
    png.write('IHDR', 8)
    png.writeUInt32BE(64, 16)
    png.writeUInt32BE(32, 20)
    writeFileSync(join(tree.root, 'icon.png'), png)
    const build = resolveFileReferences(tree.workspace, '@icon.png')
    assert.equal(build.blocks.length, 1)
    assert.equal(build.blocks[0].content, '')
    assert.match(build.blocks[0].notice, /image placeholder only \(64x32/)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('long files are truncated at the context line cap', () => {
  const lines = Array.from({ length: MAX_CONTEXT_LINES + 500 }, (_, i) => `l${i}`)
  const tree = makeTree({ 'long.txt': lines.join('\n') })
  try {
    const build = resolveFileReferences(tree.workspace, '@long.txt')
    assert.equal(build.blocks.length, 1)
    assert.match(build.blocks[0].notice, /truncated to 2000 lines/)
    assert.ok(build.blocks[0].content.split('\n').length <= MAX_CONTEXT_LINES)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('references read fresh content each build (FC-07)', () => {
  const tree = makeTree({ 'a.txt': 'first\n' })
  try {
    const before = buildContextBlocks(tree.workspace, [{ raw: 'a.txt', path: 'a.txt' }])
    writeFileSync(join(tree.root, 'a.txt'), 'second\n')
    const after = buildContextBlocks(tree.workspace, [{ raw: 'a.txt', path: 'a.txt' }])
    assert.match(before.blocks[0].content, /first/)
    assert.match(after.blocks[0].content, /second/)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('total budget overflow reports the skipped file instead of dropping it silently', () => {
  const big = 'x'.repeat(70 * 1024)
  const tree = makeTree({ 'a.txt': big, 'b.txt': big, 'c.txt': big })
  try {
    const build = resolveFileReferences(tree.workspace, '@a.txt @b.txt @c.txt')
    assert.ok(build.blocks.length >= 1)
    assert.ok(build.errors.some((entry) => /budget/.test(entry.message)))
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})
