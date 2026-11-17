// Write tool tests (SP003 AC WT-04 … WT-06, CP-04, plan T4).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspace } from '../../tui/dist/workspace/paths.js'
import { contentFingerprint, writeWorkspaceFile } from '../../tui/dist/workspace/write.js'

function makeTree(files = {}) {
  const base = mkdtempSync(join(tmpdir(), 'budingx-write-'))
  const root = join(base, 'workspace')
  mkdirSync(root)
  for (const [name, content] of Object.entries(files)) {
    const full = join(root, name)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return { base, root, workspace: createWorkspace(root) }
}

test('a new file is created and reads back byte identical', () => {
  const tree = makeTree({})
  try {
    const result = writeWorkspaceFile(tree.workspace, {
      path: 'new.txt',
      content: 'héllo 世界\n'
    })
    assert.equal(result.created, true)
    assert.equal(result.path, 'new.txt')
    assert.deepEqual(readFileSync(join(tree.root, 'new.txt'), 'utf8'), 'héllo 世界\n')
    // No temporary files may survive a successful write.
    assert.deepEqual(
      readdirSync(tree.root).filter((name) => name.includes('.tmp') || name.includes('budingx-')),
      []
    )
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a missing parent directory is refused and creates nothing', () => {
  const tree = makeTree({})
  try {
    assert.throws(
      () => writeWorkspaceFile(tree.workspace, { path: 'deep/nest/a.txt', content: 'x' }),
      (error) => error.code === 'BUDINGX_WORKSPACE_002'
    )
    assert.equal(readdirSync(tree.root).length, 0)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a directory target is refused', () => {
  const tree = makeTree({})
  try {
    mkdirSync(join(tree.root, 'dir'))
    assert.throws(
      () => writeWorkspaceFile(tree.workspace, { path: 'dir', content: 'x' }),
      (error) => error.code === 'BUDINGX_WORKSPACE_003'
    )
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('an existing file is overwritten atomically', () => {
  const tree = makeTree({ 'a.txt': 'old content' })
  try {
    const result = writeWorkspaceFile(tree.workspace, { path: 'a.txt', content: 'new content' })
    assert.equal(result.created, false)
    assert.equal(readFileSync(join(tree.root, 'a.txt'), 'utf8'), 'new content')
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a stale fingerprint refuses the write and keeps the foreign change', () => {
  const tree = makeTree({ 'a.txt': 'original' })
  try {
    const stale = contentFingerprint('original')
    // An external process changes the file after our caller read it.
    writeFileSync(join(tree.root, 'a.txt'), 'changed by user')
    assert.throws(
      () =>
        writeWorkspaceFile(tree.workspace, {
          path: 'a.txt',
          content: 'our overwrite',
          expectedFingerprint: stale
        }),
      (error) => error.code === 'BUDINGX_WORKSPACE_008'
    )
    assert.equal(readFileSync(join(tree.root, 'a.txt'), 'utf8'), 'changed by user')
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a matching fingerprint allows the write', () => {
  const tree = makeTree({ 'a.txt': 'original' })
  try {
    const current = contentFingerprint('original')
    const result = writeWorkspaceFile(tree.workspace, {
      path: 'a.txt',
      content: 'updated',
      expectedFingerprint: current
    })
    assert.equal(result.fingerprint, contentFingerprint('updated'))
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('expecting a fingerprint on a missing file is a conflict', () => {
  const tree = makeTree({})
  try {
    assert.throws(
      () =>
        writeWorkspaceFile(tree.workspace, {
          path: 'gone.txt',
          content: 'x',
          expectedFingerprint: contentFingerprint('whatever')
        }),
      (error) => error.code === 'BUDINGX_WORKSPACE_008'
    )
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('an outside path is refused before any disk change', () => {
  const tree = makeTree({})
  try {
    assert.throws(
      () => writeWorkspaceFile(tree.workspace, { path: '../outside.txt', content: 'x' }),
      (error) => error.code === 'BUDINGX_WORKSPACE_001'
    )
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})
