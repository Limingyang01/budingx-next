// Edit tool tests (SP003 AC WT-07/WT-08, plan T5).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspace } from '../../tui/dist/workspace/paths.js'
import { editWorkspaceFile } from '../../tui/dist/workspace/edit.js'

function makeTree(files = {}) {
  const base = mkdtempSync(join(tmpdir(), 'budingx-edit-'))
  const root = join(base, 'workspace')
  mkdirSync(root)
  for (const [name, content] of Object.entries(files)) {
    const full = join(root, name)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return { base, root, workspace: createWorkspace(root) }
}

test('a unique literal string is replaced once', () => {
  const tree = makeTree({ 'a.ts': 'const x = 1;\nconst y = 2;\n' })
  try {
    const result = editWorkspaceFile(tree.workspace, {
      path: 'a.ts',
      oldString: 'const y = 2;',
      newString: 'const y = 3;'
    })
    assert.equal(result.replacements, 1)
    assert.equal(readFileSync(join(tree.root, 'a.ts'), 'utf8'), 'const x = 1;\nconst y = 3;\n')
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('multiple matches without replace_all are refused and the file is untouched', () => {
  const tree = makeTree({ 'a.ts': 'dup\ndup\ndup\n' })
  try {
    assert.throws(
      () => editWorkspaceFile(tree.workspace, { path: 'a.ts', oldString: 'dup', newString: 'x' }),
      (error) => error.code === 'BUDINGX_WORKSPACE_007'
    )
    assert.equal(readFileSync(join(tree.root, 'a.ts'), 'utf8'), 'dup\ndup\ndup\n')
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('replace_all replaces every match and reports the count', () => {
  const tree = makeTree({ 'a.ts': 'dup\ndup\ndup\n' })
  try {
    const result = editWorkspaceFile(tree.workspace, {
      path: 'a.ts',
      oldString: 'dup',
      newString: 'x',
      replaceAll: true
    })
    assert.equal(result.replacements, 3)
    assert.equal(readFileSync(join(tree.root, 'a.ts'), 'utf8'), 'x\nx\nx\n')
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a missing match is refused with a hint, not a silent no-op', () => {
  const tree = makeTree({ 'a.ts': 'hello\n' })
  try {
    assert.throws(
      () => editWorkspaceFile(tree.workspace, { path: 'a.ts', oldString: 'goodbye', newString: 'x' }),
      (error) => error.code === 'BUDINGX_WORKSPACE_006' && /verify the exact text/.test(error.message)
    )
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('old_string identical to new_string is refused', () => {
  const tree = makeTree({ 'a.ts': 'same\n' })
  try {
    assert.throws(
      () => editWorkspaceFile(tree.workspace, { path: 'a.ts', oldString: 'same', newString: 'same' }),
      (error) => error.code === 'BUDINGX_WORKSPACE_007'
    )
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('an empty old_string creates a file', () => {
  const tree = makeTree({})
  try {
    const result = editWorkspaceFile(tree.workspace, {
      path: 'fresh.txt',
      oldString: '',
      newString: 'created\n'
    })
    assert.equal(result.created, true)
    assert.equal(readFileSync(join(tree.root, 'fresh.txt'), 'utf8'), 'created\n')
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('an empty old_string never overwrites an existing file', () => {
  const tree = makeTree({ 'a.ts': 'keep me\n' })
  try {
    assert.throws(
      () => editWorkspaceFile(tree.workspace, { path: 'a.ts', oldString: '', newString: 'gone' }),
      (error) => error.code === 'BUDINGX_WORKSPACE_007'
    )
    assert.equal(readFileSync(join(tree.root, 'a.ts'), 'utf8'), 'keep me\n')
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('an LF old_string still matches a CRLF file and the ending is kept', () => {
  const tree = makeTree({})
  try {
    writeFileSync(join(tree.root, 'crlf.txt'), 'alpha\r\nbeta\r\n')
    const result = editWorkspaceFile(tree.workspace, {
      path: 'crlf.txt',
      oldString: 'alpha\nbeta',
      newString: 'alpha\ngamma'
    })
    assert.equal(result.replacements, 1)
    assert.equal(readFileSync(join(tree.root, 'crlf.txt'), 'utf8'), 'alpha\r\ngamma\r\n')
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('弯引号容错：直引号 old_string 能命中弯引号文件，其他位置保持原样（T18h）', () => {
  const tree = makeTree({})
  try {
    writeFileSync(join(tree.root, 'q.txt'), 'other “kept” text\nsay “hello” now\n')
    const result = editWorkspaceFile(tree.workspace, {
      path: 'q.txt',
      oldString: 'say "hello" now',
      newString: 'say "hi" now'
    })
    assert.equal(result.replacements, 1)
    const disk = readFileSync(join(tree.root, 'q.txt'), 'utf8')
    assert.match(disk, /“kept”/)
    assert.match(disk, /say "hi" now/)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('editing a missing file reports not found', () => {
  const tree = makeTree({})
  try {
    assert.throws(
      () =>
        editWorkspaceFile(tree.workspace, {
          path: 'nope.txt',
          oldString: 'x',
          newString: 'y'
        }),
      (error) => error.code === 'BUDINGX_WORKSPACE_002'
    )
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})
