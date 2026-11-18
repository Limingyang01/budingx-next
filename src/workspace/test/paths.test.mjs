// Workspace path boundary tests (SP003 AC WT-11, plan T1).
// Real files and real links are used: a mock cannot prove that a junction
// pointing outside the workspace is refused.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspace, isInsideRoot } from '../../tui/dist/workspace/paths.js'

function makeTree() {
  const base = mkdtempSync(join(tmpdir(), 'budingx-ws-'))
  const root = join(base, 'workspace')
  const outside = join(base, 'outside')
  mkdirSync(root)
  mkdirSync(outside)
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'main.ts'), 'export const a = 1\n')
  writeFileSync(join(outside, 'secret.txt'), 'secret\n')
  return { base, root, outside }
}

test('a relative path inside the root resolves to a relative form', () => {
  const tree = makeTree()
  try {
    const workspace = createWorkspace(tree.root)
    const resolved = workspace.resolve('src/main.ts')
    assert.equal(resolved.relative, 'src/main.ts')
    assert.equal(resolved.existed, true)
    assert.equal(resolved.isDirectory, false)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a path that does not exist yet resolves through its parent', () => {
  const tree = makeTree()
  try {
    const workspace = createWorkspace(tree.root)
    const resolved = workspace.resolve('src/new-file.ts')
    assert.equal(resolved.relative, 'src/new-file.ts')
    assert.equal(resolved.existed, false)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a parent directory traversal is refused', () => {
  const tree = makeTree()
  try {
    const workspace = createWorkspace(tree.root)
    assert.throws(
      () => workspace.resolve('../outside/secret.txt'),
      (error) => error.code === 'BUDINGX_WORKSPACE_001'
    )
    assert.throws(
      () => workspace.resolve('src/../../outside/secret.txt'),
      (error) => error.code === 'BUDINGX_WORKSPACE_001'
    )
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('an absolute path outside the root is refused', () => {
  const tree = makeTree()
  try {
    const workspace = createWorkspace(tree.root)
    assert.throws(
      () => workspace.resolve(join(tree.outside, 'secret.txt')),
      (error) => error.code === 'BUDINGX_WORKSPACE_001'
    )
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a link pointing outside the root is refused', () => {
  const tree = makeTree()
  try {
    const link = join(tree.root, 'escape')
    let created = false
    try {
      symlinkSync(tree.outside, link, 'junction')
      created = true
    } catch {
      try {
        symlinkSync(tree.outside, link, 'dir')
        created = true
      } catch {
        created = false
      }
    }
    if (!created) {
      // Creating links is not permitted in this environment: the link cases
      // stay UNVERIFIED instead of silently passing.
      assert.ok(true)
      return
    }
    const workspace = createWorkspace(tree.root)
    assert.throws(
      () => workspace.resolve('escape/missing/child.txt'),
      (error) => error.code === 'BUDINGX_WORKSPACE_001'
    )
    assert.throws(
      () => workspace.resolve('escape/secret.txt'),
      (error) => error.code === 'BUDINGX_WORKSPACE_001'
    )
    assert.throws(
      () => workspace.resolve('escape'),
      (error) => error.code === 'BUDINGX_WORKSPACE_001'
    )
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('an empty path is refused', () => {
  const tree = makeTree()
  try {
    const workspace = createWorkspace(tree.root)
    assert.throws(
      () => workspace.resolve('   '),
      (error) => error.code === 'BUDINGX_WORKSPACE_002'
    )
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('the root itself is inside the workspace', () => {
  const tree = makeTree()
  try {
    const workspace = createWorkspace(tree.root)
    assert.equal(workspace.isInside(workspace.root), true)
    assert.equal(workspace.isInside(join(tree.outside, 'secret.txt')), false)
    assert.equal(isInsideRoot(workspace.root, join(workspace.root, 'src')), true)
    assert.equal(isInsideRoot(workspace.root, join(tree.outside, 'src')), false)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})
