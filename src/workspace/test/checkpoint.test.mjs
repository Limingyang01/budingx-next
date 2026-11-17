// Checkpoint and undo tests (SP003 AC CP-05/CP-06, plan T8).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspace } from '../../tui/dist/workspace/paths.js'
import { writeWorkspaceFile } from '../../tui/dist/workspace/write.js'
import { diffLines } from '../../tui/dist/workspace/diff.js'
import { createCheckpointStore } from '../../tui/dist/workspace/checkpoint.js'

function makeTree(files = {}) {
  const base = mkdtempSync(join(tmpdir(), 'budingx-cp-'))
  const root = join(base, 'workspace')
  mkdirSync(root)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content)
  return { base, root, workspace: createWorkspace(root) }
}

function recordWrite(store, workspace, path, content, turnId) {
  const before = workspace.resolve(path).existed ? readFileSync(join(workspace.root, path), 'utf8') : undefined
  const written = writeWorkspaceFile(workspace, { path, content })
  store.record({
    path,
    operation: before === undefined ? 'create' : 'update',
    ...(before !== undefined ? { before } : {}),
    after: content,
    diff: diffLines(before ?? '', content),
    fingerprintAfter: written.fingerprint,
    ...(turnId ? { turnId } : {})
  })
  return written
}

test('undo restores an updated file when nothing else touched it', () => {
  const tree = makeTree({ 'a.txt': 'original\n' })
  try {
    const store = createCheckpointStore()
    recordWrite(store, tree.workspace, 'a.txt', 'ours\n')
    const outcome = store.undoPath(tree.workspace, 'a.txt')
    assert.equal(outcome.undone, true)
    assert.equal(readFileSync(join(tree.root, 'a.txt'), 'utf8'), 'original\n')
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('undo of a created file removes it', () => {
  const tree = makeTree({})
  try {
    const store = createCheckpointStore()
    recordWrite(store, tree.workspace, 'fresh.txt', 'brand new\n')
    assert.equal(store.undoPath(tree.workspace, 'fresh.txt').undone, true)
    assert.equal(existsSync(join(tree.root, 'fresh.txt')), false)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('automatic undo stops when the user changed the file after us', () => {
  const tree = makeTree({ 'a.txt': 'original\n' })
  try {
    const store = createCheckpointStore()
    recordWrite(store, tree.workspace, 'a.txt', 'ours\n')
    // The user edits on top of our change.
    writeFileSync(join(tree.root, 'a.txt'), 'ours plus user note\n')
    const outcome = store.undoPath(tree.workspace, 'a.txt')
    assert.equal(outcome.undone, false)
    assert.match(outcome.reason, /automatic undo stopped/)
    // The user's work is kept.
    assert.equal(readFileSync(join(tree.root, 'a.txt'), 'utf8'), 'ours plus user note\n')
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a turn touching several files undoes as a group', () => {
  const tree = makeTree({ 'a.txt': 'A0\n', 'b.txt': 'B0\n' })
  try {
    const store = createCheckpointStore()
    recordWrite(store, tree.workspace, 'a.txt', 'A1\n', 't1')
    recordWrite(store, tree.workspace, 'b.txt', 'B1\n', 't1')
    recordWrite(store, tree.workspace, 'a.txt', 'A2\n', 't2')
    const outcome = store.undoTurn(tree.workspace, 't2')
    assert.equal(outcome.undone, true)
    assert.equal(readFileSync(join(tree.root, 'a.txt'), 'utf8'), 'A1\n')
    // The first turn is untouched.
    assert.equal(readFileSync(join(tree.root, 'b.txt'), 'utf8'), 'B1\n')
    store.undoTurn(tree.workspace, 't1')
    assert.equal(readFileSync(join(tree.root, 'a.txt'), 'utf8'), 'A0\n')
    assert.equal(readFileSync(join(tree.root, 'b.txt'), 'utf8'), 'B0\n')
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('chained edits to one file roll back in order', () => {
  const tree = makeTree({ 'a.txt': 'v0\n' })
  try {
    const store = createCheckpointStore()
    recordWrite(store, tree.workspace, 'a.txt', 'v1\n', 't1')
    recordWrite(store, tree.workspace, 'a.txt', 'v2\n', 't1')
    const outcome = store.undoTurn(tree.workspace, 't1')
    assert.equal(outcome.undone, true)
    assert.equal(readFileSync(join(tree.root, 'a.txt'), 'utf8'), 'v0\n')
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('undoing a partially foreign turn keeps the already-restored files and reports why', () => {
  const tree = makeTree({ 'a.txt': 'A0\n', 'b.txt': 'B0\n' })
  try {
    const store = createCheckpointStore()
    recordWrite(store, tree.workspace, 'a.txt', 'A1\n', 't1')
    recordWrite(store, tree.workspace, 'b.txt', 'B1\n', 't1')
    writeFileSync(join(tree.root, 'b.txt'), 'B1 plus user\n')
    const outcome = store.undoTurn(tree.workspace, 't1')
    // b.txt is newest and blocked; a.txt was not attempted.
    assert.equal(outcome.undone, false)
    assert.match(outcome.reason, /automatic undo stopped/)
    assert.equal(readFileSync(join(tree.root, 'b.txt'), 'utf8'), 'B1 plus user\n')
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('undo with nothing recorded reports a clear reason', () => {
  const tree = makeTree({})
  try {
    const store = createCheckpointStore()
    const outcome = store.undoTurn(tree.workspace)
    assert.equal(outcome.undone, false)
    assert.match(outcome.reason, /no session changes/)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})
