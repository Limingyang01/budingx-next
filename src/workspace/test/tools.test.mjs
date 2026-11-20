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

test('Read, Write and Edit accept file_path through target and execution', async (t) => {
  const env = makeEnv()
  t.after(() => rmSync(env.base, { recursive: true, force: true }))
  const { ctx } = env.context()
  const file_path = join(env.root, 'two words.txt')
  for (const name of ['Read', 'Write', 'Edit']) {
    assert.deepEqual(env.byName[name].target({ file_path }), { path: file_path, kind: 'file' })
  }
  assert.throws(() => env.byName.Read.target({ file_path, path: 'different.txt' }), /same file/)
  await env.byName.Write.execute({ file_path, content: 'say “hello” now\r\n' }, ctx)
  assert.equal(readFileSync(file_path, 'utf8'), 'say “hello” now\r\n')
  assert.match(await env.byName.Read.execute({ file_path, limit: '1' }, ctx), /say “hello”/)
  await env.byName.Edit.execute({
    file_path,
    old_string: 'say "hello" now',
    new_string: 'say "hi" now',
    replace_all: 'false'
  }, ctx)
  assert.equal(readFileSync(file_path, 'utf8'), 'say “hi” now\r\n')
})

test('Read reports empty files and reads Jupyter notebook cells with textual output', async (t) => {
  const env = makeEnv({
    'empty.txt': '',
    'short.txt': 'one',
    'notebook.ipynb': JSON.stringify({
      cells: [
        { cell_type: 'markdown', source: ['# Analysis\n', 'Markdown'] },
        {
          cell_type: 'code',
          source: ['print(12)'],
          outputs: [{ output_type: 'stream', name: 'stdout', text: ['12\n'] }]
        }
      ]
    })
  })
  t.after(() => rmSync(env.base, { recursive: true, force: true }))
  const { ctx } = env.context()
  assert.match(await env.byName.Read.execute({ path: 'empty.txt' }, ctx), /contents are empty/)
  assert.match(await env.byName.Read.execute({ path: 'short.txt', offset: 8 }, ctx), /shorter than the provided offset \(8\)/)
  const notebook = await env.byName.Read.execute({ path: 'notebook.ipynb' }, ctx)
  assert.match(notebook, /Cell 1 \(markdown\)\n# Analysis\nMarkdown/)
  assert.match(notebook, /Cell 2 \(code\)\nprint\(12\)\nstdout:\n12/)
})

test('Grep defaults to file paths and accepts reference flags, context and glob lists', async (t) => {
  const env = makeEnv({
    'a.ts': 'too-far\nbefore\nNEEDLE\nafter\ntoo-far\n',
    'nested/b.md': 'Needle\n',
    'nested/c.txt': 'needle\n'
  })
  t.after(() => rmSync(env.base, { recursive: true, force: true }))
  const { ctx } = env.context()
  const files = await env.byName.Grep.execute({ pattern: '(?i)needle', glob: '*.ts,*.md' }, ctx)
  assert.match(files, /^Found 2 files/m)
  assert.match(files, /^a\.ts$/m)
  assert.match(files, /^nested\/b\.md$/m)
  assert.doesNotMatch(files, /NEEDLE|c\.txt/)
  const content = await env.byName.Grep.execute({
    pattern: 'needle',
    output_mode: 'content',
    path: 'a.ts',
    '-i': 'true',
    context: 1,
    '-C': 2,
    '-A': 2,
    '-B': 2
  }, ctx)
  assert.match(content, /before[\s\S]*NEEDLE[\s\S]*after/)
  assert.doesNotMatch(content, /too-far/)
})

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

test('Write 到嵌套缺失目录自动建父目录后成功（T18b，对齐参考）', async () => {
  const env = makeEnv()
  try {
    const { ctx } = env.context()
    const result = await env.byName.Write.execute(
      { path: 'no/deep/a.ts', content: 'x\n' },
      ctx
    )
    assert.match(result, /Wrote 2 bytes to no\/deep\/a\.ts \(new file\)/)
    assert.equal(readFileSync(join(env.root, 'no/deep/a.ts'), 'utf8'), 'x\n')
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('Grep 工具面透传 output_mode 与分页参数（T18d）', async () => {
  const env = makeEnv({ 'a.txt': 'x\nx\n', 'b.md': 'x\n' })
  try {
    const { ctx } = env.context()
    const count = await env.byName.Grep.execute({ pattern: 'x', output_mode: 'count' }, ctx)
    assert.match(count, /a\.txt:2/)
    assert.match(count, /Found 3 total occurrences across 2 files\./)
    const files = await env.byName.Grep.execute(
      { pattern: 'x', output_mode: 'files_with_matches', type: 'md' },
      ctx
    )
    assert.match(files, /^Found 1 file/)
    assert.match(files, /b\.md/)
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

test('Edit 精确替换并记录 update 检查点（需先 Read，T18a）', async () => {
  const env = makeEnv({ 'a.ts': 'const y = 2;\n' })
  try {
    const { ctx, changes } = env.context()
    await env.byName.Read.execute({ path: 'a.ts' }, ctx)
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
    await env.byName.Read.execute({ path: 'a.ts' }, ctx)
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
    const result = await env.byName.Grep.execute({ pattern: 'needle', output_mode: 'content' }, ctx)
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

test('读后编辑门：未读过的既有文件拒绝 Write，提示先 Read（T18a）', async () => {
  const env = makeEnv({ 'a.txt': 'existing\n' })
  try {
    const { ctx } = env.context()
    await assert.rejects(
      () => env.byName.Write.execute({ path: 'a.txt', content: 'blind overwrite' }, ctx),
      (error) =>
        error.code === 'BUDINGX_WORKSPACE_010' &&
        /has not been read yet/.test(error.message)
    )
    assert.equal(readFileSync(join(env.root, 'a.txt'), 'utf8'), 'existing\n')
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('读后编辑门：读后被外部修改则拒绝并提示重读，重读后放行（T18a）', async () => {
  const env = makeEnv({ 'a.txt': 'original\n' })
  try {
    const { ctx } = env.context()
    await env.byName.Read.execute({ path: 'a.txt' }, ctx)
    writeFileSync(join(env.root, 'a.txt'), 'changed by user\n')
    await assert.rejects(
      () => env.byName.Write.execute({ path: 'a.txt', content: 'ours' }, ctx),
      (error) => error.code === 'BUDINGX_WORKSPACE_011' && /modified since read/.test(error.message)
    )
    assert.equal(readFileSync(join(env.root, 'a.txt'), 'utf8'), 'changed by user\n')
    await env.byName.Read.execute({ path: 'a.txt' }, ctx)
    await env.byName.Write.execute({ path: 'a.txt', content: 'ours\n' }, ctx)
    assert.equal(readFileSync(join(env.root, 'a.txt'), 'utf8'), 'ours\n')
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('新建文件不受读门限制；同一会话连续 Write 依赖写后状态更新（T18a）', async () => {
  const env = makeEnv({})
  try {
    const { ctx } = env.context()
    await env.byName.Write.execute({ path: 'born.txt', content: 'v1\n' }, ctx)
    await env.byName.Write.execute({ path: 'born.txt', content: 'v2\n' }, ctx)
    assert.equal(readFileSync(join(env.root, 'born.txt'), 'utf8'), 'v2\n')
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
