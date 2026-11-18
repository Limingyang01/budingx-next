// SP004 T21 · 命令内受限编辑（sed -i）测试（design §4.8；AC CE-20 / GW-02）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspace } from '../../tui/dist/workspace/paths.js'
import { createCheckpointStore } from '../../tui/dist/workspace/checkpoint.js'
import { applySedEdit, parseSedEdit, validateSedEdit } from '../../tui/dist/exec/sed-edit.js'

function makeTree(files = {}) {
  const base = mkdtempSync(join(tmpdir(), 'budingx-sed-'))
  const root = join(base, 'workspace')
  mkdirSync(root)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content)
  return { base, root, workspace: createWorkspace(root) }
}

test('T21-1 简单替换命令被识别为命令内编辑', () => {
  assert.deepEqual(parseSedEdit("sed -i 's/a/b/g' f.txt"), {
    filePath: 'f.txt',
    pattern: 'a',
    replacement: 'b',
    flags: 'g',
    extendedRegex: false
  })
})

test('T21-2 -E / -r 扩展正则与 -i 顺序可识别', () => {
  assert.equal(parseSedEdit("sed -E -i 's/a+/b/' f.txt")?.extendedRegex, true)
  assert.equal(parseSedEdit("sed -i -r 's/a+/b/' f.txt")?.extendedRegex, true)
  assert.deepEqual(parseSedEdit("sed -i 's/a/b/' f.txt"), {
    filePath: 'f.txt',
    pattern: 'a',
    replacement: 'b',
    flags: '',
    extendedRegex: false
  })
})

test('T21-3 非就地编辑或非 sed 命令不识别', () => {
  assert.equal(parseSedEdit("sed 's/a/b/' f.txt"), undefined)
  assert.equal(parseSedEdit('cat f.txt'), undefined)
  assert.equal(parseSedEdit('grep a f.txt'), undefined)
  assert.equal(parseSedEdit(''), undefined)
})

test('T21-4 仅允许 s 命令：a/i/w 等一律拒绝', () => {
  assert.equal(parseSedEdit("sed -i 'a/i' f.txt"), undefined)
  assert.equal(parseSedEdit("sed -i 'w out.txt' f.txt"), undefined)
  assert.equal(parseSedEdit("sed -i 'd' f.txt"), undefined)
  assert.equal(parseSedEdit("sed -i 's/a/b/;w out.txt' f.txt"), undefined)
})

test('T21-5 危险组合与多文件/备份后缀拒绝', () => {
  assert.equal(parseSedEdit("sed -n -i 's/a/b/' f.txt"), undefined)
  assert.equal(parseSedEdit("sed -i -n 's/a/b/' f.txt"), undefined)
  assert.equal(parseSedEdit("sed -i 's/a/b/' a.txt b.txt"), undefined)
  assert.equal(parseSedEdit("sed -i.bak 's/a/b/' f.txt"), undefined)
  assert.equal(parseSedEdit("sed -i 's/a/b/'"), undefined)
})

test('T21-6 应用替换：文件内容更新、diff 与 checkpoint 登记可撤销', () => {
  const tree = makeTree({ 'f.txt': 'hello world\nsecond world\n' })
  try {
    const info = parseSedEdit("sed -i 's/world/there/' f.txt")
    assert.ok(info !== undefined)
    const store = createCheckpointStore()
    const result = applySedEdit(info, tree.workspace, { checkpoint: store, turnId: 'turn-1' })
    assert.equal(result.ok, true)
    assert.equal(readFileSync(join(tree.root, 'f.txt'), 'utf8'), 'hello there\nsecond there\n')
    // 未加 g：每行只替换首个匹配（sed 逐行语义）。
    assert.ok(result.diff.length > 0)
    assert.ok(result.diff.some((hunk) => hunk.lines.some((line) => line.type === 'add')))
    assert.ok(result.diff.some((hunk) => hunk.lines.some((line) => line.type === 'remove')))
    const records = store.changes()
    assert.equal(records.length, 1)
    assert.equal(records[0].path, 'f.txt')
    assert.equal(records[0].operation, 'update')
    assert.equal(records[0].before, 'hello world\nsecond world\n')
    assert.equal(records[0].after, 'hello there\nsecond there\n')
    assert.equal(records[0].turnId, 'turn-1')
    const undo = store.undoPath(tree.workspace, 'f.txt')
    assert.equal(undo.undone, true)
    assert.equal(readFileSync(join(tree.root, 'f.txt'), 'utf8'), 'hello world\nsecond world\n')
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('T21-7 g 旗标替换全部匹配', () => {
  const tree = makeTree({ 'f.txt': 'a a a\n' })
  try {
    const info = parseSedEdit("sed -i 's/a/b/g' f.txt")
    const result = applySedEdit(info, tree.workspace)
    assert.equal(result.ok, true)
    assert.equal(readFileSync(join(tree.root, 'f.txt'), 'utf8'), 'b b b\n')
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('T21-8 工作区外路径被拒绝且不写盘', () => {
  const tree = makeTree({ 'f.txt': 'x\n' })
  try {
    const info = {
      filePath: '../outside.txt',
      pattern: 'x',
      replacement: 'y',
      flags: '',
      extendedRegex: false
    }
    const verdict = validateSedEdit(info, tree.workspace)
    assert.equal(verdict.ok, false)
    assert.match(verdict.reason ?? '', /工作区|outside|workspace/i)
    const result = applySedEdit(info, tree.workspace)
    assert.equal(result.ok, false)
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})

test('T21-9 目标文件不存在时拒绝且不创建', () => {
  const tree = makeTree({})
  try {
    const info = parseSedEdit("sed -i 's/a/b/' missing.txt")
    const result = applySedEdit(info, tree.workspace)
    assert.equal(result.ok, false)
    assert.match(result.reason ?? '', /不存在|missing|not found/i)
    assert.equal(parseSedEdit("sed -i 's/a/b/' missing.txt")?.filePath, 'missing.txt')
  } finally {
    rmSync(tree.base, { recursive: true, force: true })
  }
})