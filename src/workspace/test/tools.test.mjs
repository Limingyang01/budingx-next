// Workspace tool assembly tests (SP003 plan T16; AC WT-01…14 通道,
// PC-01…11 端到端接线由 wire-e2e 与 policy 用例分_layer_覆盖).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspace } from '../../tui/dist/workspace/paths.js'
import { createWorkspaceTools } from '../../tui/dist/workspace/tools.js'

function makeEnv(files = {}) {
  const base = mkdtempSync(join(tmpdir(), 'budingx-tools-'))
  const root = join(base, 'workspace')
  mkdirSync(root)
  for (const [name, content] of Object.entries(files)) {
    const full = join(root, name)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  const workspace = createWorkspace(root)
  const { tools, checkpoint } = createWorkspaceTools(workspace)
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]))
  const context = () => {
    const changes = []
    return {
      changes,
      ctx: {
        signal: new AbortController().signal,
        changes: (records) => changes.push(...records)
      }
    }
  }
  return { base, root, workspace, tools, byName, checkpoint, context }
}

test('五个工具注册且名称稳定', () => {
  const env = makeEnv()
  try {
    assert.deepEqual(
      env.tools.map((tool) => tool.name),
      ['Read', 'Write', 'Edit', 'Glob', 'Grep']
    )
    assert.equal(env.byName.Read.capability({}), 'read')
    assert.equal(env.byName.Write.capability({ path: 'a', content: 'b' }), 'write')
    assert.equal(env.byName.Glob.capability({ pattern: '*' }), 'read')
    assert.equal(env.byName.Write.target({ path: 'a.ts', content: 'x' }).path, 'a.ts')
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('Write 成功返回摘要、记录检查点并发出 change_set', async () => {
  const env = makeEnv()
  try {
    const { ctx, changes } = env.context()
    const result = await env.byName.Write.execute(
      { path: 'a.ts', content: 'hello\n' },
      ctx
    )
    assert.match(result, /Wrote \d+ bytes to a\.ts \(new file\) \+1\/-0/)
    assert.equal(readFileSync(join(env.root, 'a.ts'), 'utf8'), 'hello\n')
    assert.equal(changes.length, 1)
    assert.equal(changes[0].path, 'a.ts')
    assert.equal(changes[0].operation, 'create')
    assert.equal(env.checkpoint.open().length, 1)
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('Write 到嵌套缺失目录返回带稳定错误码的失败且不落盘', async () => {
  const env = makeEnv()
  try {
    const { ctx } = env.context()
    await assert.rejects(
      () => env.byName.Write.execute({ path: 'no/deep/a.ts', content: 'x' }, ctx),
      (error) => error.code === 'BUDINGX_WORKSPACE_002'
    )
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('Read 返回行号文本，图片只返回摘要', async () => {
  const env = makeEnv({ 'a.txt': 'one\ntwo\n' })
  try {
    const { ctx } = env.context()
    const text = await env.byName.Read.execute({ path: 'a.txt' }, ctx)
    assert.match(text, /1→one/)
    const png = Buffer.alloc(24)
    png.writeUInt32BE(0x89504e47, 0)
    png.writeUInt32BE(13, 4)
    png.write('IHDR', 8)
    png.writeUInt32BE(320, 16)
    png.writeUInt32BE(200, 20)
    writeFileSync(join(env.root, 'b.png'), png)
    const image = await env.byName.Read.execute({ path: 'b.png' }, ctx)
    assert.match(image, /\[image image\/png, 320x200, \d+ bytes\]/)
    assert.match(image, /not sent to the model yet/)
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('Edit 精确替换并记录 update 检查点', async () => {
  const env = makeEnv({ 'a.ts': 'const y = 2;\n' })
  try {
    const { ctx, changes } = env.context()
    const result = await env.byName.Edit.execute(
      { path: 'a.ts', old_string: 'const y = 2;', new_string: 'const y = 3;' },
      ctx
    )
    assert.match(result, /Edited a\.ts: 1 replacement\(s\)/)
    assert.equal(changes[0].operation, 'update')
    assert.deepEqual(
      changes[0].additions + changes[0].removals,
      2
    )
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('Edit 歧义匹配透出稳定错误码（WT-07 → 模型可自我纠正）', async () => {
  const env = makeEnv({ 'a.ts': 'dup\ndup\n' })
  try {
    const { ctx } = env.context()
    await assert.rejects(
      () => env.byName.Edit.execute({ path: 'a.ts', old_string: 'dup', new_string: 'x' }, ctx),
      (error) => error.code === 'BUDINGX_WORKSPACE_007'
    )
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('Glob 遵守忽略规则并给出计数摘要', async () => {
  const env = makeEnv({ 'src/a.ts': 'x', 'skip.log': 'x', 'node_modules/n/i.ts': 'x' })
  try {
    writeFileSync(join(env.root, '.gitignore'), '*.log\n')
    const { ctx } = env.context()
    const result = await env.byName.Glob.execute({ pattern: '**/*.ts' }, ctx)
    assert.match(result, /src\/a\.ts/)
    assert.doesNotMatch(result, /node_modules|skip\.log/)
    assert.match(result, /\[1 matches\]/)
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('Grep 返回 文件:行:内容 且非法正则为可读错误', async () => {
  const env = makeEnv({ 'a.ts': 'needle here\n' })
  try {
    const { ctx } = env.context()
    const result = await env.byName.Grep.execute({ pattern: 'needle' }, ctx)
    assert.match(result, /a\.ts:1:needle here/)
    await assert.rejects(
      () => env.byName.Grep.execute({ pattern: '[bad(' }, ctx),
      (error) => /Invalid regular expression/.test(error.message)
    )
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('缺少必填参数是稳定的可读工具错误', async () => {
  const env = makeEnv()
  try {
    const { ctx } = env.context()
    await assert.rejects(
      () => env.byName.Read.execute({ }, ctx),
      (error) => error.code === 'BUDINGX_CORE_002' && /path/.test(error.message)
    )
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('signal 已中止时搜索立即停止', async () => {
  const env = makeEnv({ 'a.ts': 'x' })
  try {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      () => env.byName.Glob.execute({ pattern: '*.ts' }, { signal: controller.signal }),
      /cancelled/
    )
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})
