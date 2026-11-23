// Read tool tests (SP003 AC WT-01 … WT-03, WT-14, plan T3).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspace } from '../../tui/dist/workspace/paths.js'
import { readWorkspaceFile } from '../../tui/dist/workspace/read.js'

function makeTree(files = {}) {
  const base = mkdtempSync(join(tmpdir(), 'budingx-read-'))
  const root = join(base, 'workspace')
  mkdirSync(root)
  for (const [name, content] of Object.entries(files)) {
    const full = join(root, name)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return { base, root, workspace: createWorkspace(root) }
}

test('a plain read returns numbered lines and the total', () => {
  const tree = makeTree({ 'a.ts': 'one\ntwo\nthree\n' })
  try {
    const result = readWorkspaceFile(tree.workspace, { path: 'a.ts' })
    assert.equal(result.kind, 'text')
    assert.equal(result.totalLines, 4)
    assert.match(result.text, /^1→one$/m)
    assert.match(result.text, /3→three/)
    assert.equal(result.truncated, false)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('offset and limit select exactly the requested range', () => {
  const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n')
  const tree = makeTree({ 'b.ts': lines })
  try {
    const result = readWorkspaceFile(tree.workspace, { path: 'b.ts', offset: 3, limit: 2 })
    assert.match(result.text, /^3→line 3$/m)
    assert.match(result.text, /^4→line 4$/m)
    assert.doesNotMatch(result.text, /line 5/)
    assert.equal(result.truncated, true)
    assert.match(result.text, /\[truncated: showing lines 3-4 of 10\]/)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('an offset past the end is a clear error, not an empty result', () => {
  const tree = makeTree({ 'c.ts': 'one\ntwo\n' })
  try {
    assert.throws(
      () => readWorkspaceFile(tree.workspace, { path: 'c.ts', offset: 99 }),
      (error) => error.code === 'BUDINGX_WORKSPACE_002'
    )
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('CRLF is normalised for display and the file on disk is untouched', () => {
  const tree = makeTree({})
  try {
    const bytes = Buffer.from('one\r\ntwo\r\n', 'utf8')
    writeFileSync(join(tree.root, 'd.txt'), bytes)
    const result = readWorkspaceFile(tree.workspace, { path: 'd.txt' })
    assert.match(result.text, /1→one/)
    assert.match(result.text, /2→two/)
    assert.deepEqual(readFileSync(join(tree.root, 'd.txt')), bytes)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a binary file is refused with a readable error', () => {
  const tree = makeTree({})
  try {
    writeFileSync(join(tree.root, 'e.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00]))
    assert.throws(
      () => readWorkspaceFile(tree.workspace, { path: 'e.bin' }),
      (error) => error.code === 'BUDINGX_WORKSPACE_004'
    )
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('UTF-16 content is refused explicitly', () => {
  const tree = makeTree({})
  try {
    writeFileSync(join(tree.root, 'f.txt'), Buffer.from([0xff, 0xfe, 0x61, 0x00]))
    assert.throws(
      () => readWorkspaceFile(tree.workspace, { path: 'f.txt' }),
      (error) => error.code === 'BUDINGX_WORKSPACE_004'
    )
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a whole-file read above the byte cap refuses with a range hint (T18b)', () => {
  const tree = makeTree({ 'big.txt': Array.from({ length: 40 }, (_, i) => `row ${i}` + 'x'.repeat(20)).join('\n') })
  try {
    assert.throws(
      () => readWorkspaceFile(tree.workspace, { path: 'big.txt', maxBytes: 200 }),
      (error) =>
        error.code === 'BUDINGX_WORKSPACE_005' &&
        /Use offset and limit parameters/.test(error.message)
    )
    // Ranged reads are allowed past the whole-file cap (bounded higher).
    const result = readWorkspaceFile(tree.workspace, {
      path: 'big.txt',
      offset: 2,
      limit: 3
    })
    assert.match(result.text, /^2→row 1/m)
    assert.match(result.text, /4→row 3/)
    assert.doesNotMatch(result.text, /5→/)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a PNG file returns a size summary instead of pretending to read it', () => {
  const tree = makeTree({})
  try {
    const png = Buffer.alloc(24)
    png.writeUInt32BE(0x89504e47, 0)
    png.writeUInt32BE(13, 4)
    png.write('IHDR', 8)
    png.writeUInt32BE(640, 16)
    png.writeUInt32BE(480, 20)
    writeFileSync(join(tree.root, 'pic.png'), png)
    const result = readWorkspaceFile(tree.workspace, { path: 'pic.png' })
    assert.equal(result.kind, 'image')
    assert.equal(result.image.mime, 'image/png')
    assert.equal(result.image.width, 640)
    assert.equal(result.image.height, 480)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a directory target is refused as not a file', () => {
  const tree = makeTree({})
  try {
    mkdirSync(join(tree.root, 'dir'))
    assert.throws(
      () => readWorkspaceFile(tree.workspace, { path: 'dir' }),
      (error) => error.code === 'BUDINGX_WORKSPACE_003'
    )
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('a missing file reports not found', () => {
  const tree = makeTree({})
  try {
    assert.throws(
      () => readWorkspaceFile(tree.workspace, { path: 'nope.txt' }),
      (error) => error.code === 'BUDINGX_WORKSPACE_002'
    )
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('全自动档位可以读取工作区外的文件，其他档位仍被边界拒绝（用户 2026-11-23 修正）', () => {
  const base = mkdtempSync(join(tmpdir(), 'budingx-read-outside-'))
  try {
    const root = join(base, 'workspace')
    const outside = join(base, 'outside')
    mkdirSync(root)
    mkdirSync(outside)
    writeFileSync(join(outside, 'mcp-wrapper.json'), 'outside-content\n')
    const closed = createWorkspace(root)
    assert.throws(
      () => readWorkspaceFile(closed, { path: join(outside, 'mcp-wrapper.json') }),
      /outside the workspace/i
    )
    const open = createWorkspace(root, { allowOutside: () => true })
    const result = readWorkspaceFile(open, { path: join(outside, 'mcp-wrapper.json') })
    assert.match(result.text, /outside-content/)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
