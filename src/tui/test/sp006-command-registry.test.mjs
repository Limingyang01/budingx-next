// SP006 CMD-01…CMD-04/CMD-12：命令注册表三型契约与 22 条既有命令迁移。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCommandRegistry, parseCommandInput } from '../dist/tui/commands/registry.js'
import { getDefaultRegistry } from '../dist/tui/commands/index.js'
import { runCommand } from '../dist/tui/commands.js'

const ALL = [
  'help', 'exit', 'clear', 'config', 'models', 'model', 'permission', 'rules',
  'diff', 'undo', 'rewind', 'denials', 'sessions', 'resume', 'continue',
  'context', 'compact', 'cost', 'plan', 'permissions', 'memory', 'effort'
]

function baseCtx(extra = {}) {
  return {
    lang: 'zh',
    interactive: true,
    session: {
      clearHistory() {},
      usageTotals: { inputTokens: 1000, outputTokens: 200, requests: 2, elapsedMs: 65000 },
      compactNow: () => ({ ok: true, before: 100, after: 10 })
    },
    exit() {},
    getConfig: () => ({ model: 'm', baseUrl: 'b', apiKey: 'k', timeoutMs: 1, source: 'file' }),
    setConfig() {},
    configStore: { load: () => ({ models: [], defaultModelId: undefined }) },
    ...extra
  }
}

test('CMD-01 解析 /命令 与参数，未知名返回 undefined', () => {
  assert.deepEqual(parseCommandInput(' /new  extra   args '), { name: 'new', args: 'extra   args' })
  assert.equal(parseCommandInput('new'), undefined)
  assert.equal(parseCommandInput('/'), undefined)
  const registry = getDefaultRegistry()
  const resolved = registry.resolve('/new extra args')
  assert.equal(resolved.command, 'new')
  assert.equal(resolved.args, 'extra args')
  assert.equal(registry.resolve('/nope'), undefined)
  assert.equal(registry.resolve('not-a-command'), undefined)
})

test('CMD-02 别名解析到正式命令，正式名优先', () => {
  const registry = getDefaultRegistry()
  assert.equal(registry.resolve('/quit').definition.name, 'exit')
  assert.equal(registry.resolve('/quit').alias, true)
  assert.equal(registry.resolve('/new').definition.name, 'clear')
  assert.equal(registry.resolve('/reset').definition.name, 'clear')
  assert.equal(registry.resolve('/usage').definition.name, 'cost')
  assert.equal(registry.resolve('/allowed-tools').definition.name, 'permissions')
  assert.equal(registry.resolve('/clear').definition.name, 'clear')
  assert.equal(registry.resolve('/clear').alias, false)
})

test('CMD-02 重名与别名冲突注册直接抛错', () => {
  const registry = createCommandRegistry()
  const base = { kind: 'local', summary: 'x', async run() { return { kind: 'text', value: '' } } }
  registry.register({ ...base, name: 'alpha' })
  assert.throws(() => registry.register({ ...base, name: 'alpha' }), /命令重复注册/)
  assert.throws(() => registry.register({ ...base, name: 'beta', aliases: ['alpha'] }), /命令重复注册/)
  registry.register({ ...base, name: 'gamma', aliases: ['delta'] })
  assert.throws(() => registry.register({ ...base, name: 'delta' }), /命令重复注册/)
})

test('CMD-03 三型 kind 保留，hidden 不进默认清单', () => {
  const registry = createCommandRegistry()
  const run = async () => ({ kind: 'text', value: 'ok' })
  registry.register({ name: 'local-one', kind: 'local', summary: 'a', run })
  registry.register({ name: 'jsx-one', kind: 'local-jsx', summary: 'b', run })
  registry.register({ name: 'prompt-one', kind: 'prompt', summary: 'c', run })
  registry.register({ name: 'secret-one', kind: 'local', summary: 'd', hidden: true, run })
  assert.deepEqual(registry.list().map((entry) => entry.name), ['local-one', 'jsx-one', 'prompt-one'])
  assert.equal(registry.list({ includeHidden: true }).length, 4)
  assert.deepEqual(
    registry.list().map((entry) => entry.kind),
    ['local', 'local-jsx', 'prompt']
  )
})

const EXTENDED = ['init', 'btw', 'worktree', 'tasks', 'mcp', 'skills', 'reload-skills', 'export', 'status', 'stats', 'doctor', 'agents', 'agent', 'image']

test('CMD-12 注册表覆盖 22 条既有命令与 7 条新增命令且可直接解析', () => {
  const registry = getDefaultRegistry()
  const listed = new Set(registry.list({ includeHidden: true }).map((entry) => entry.name))
  for (const name of ALL) {
    assert.ok(registry.get(name), `missing /${name}`)
    assert.ok(listed.has(name), `/${name} 未列出`)
    assert.ok(registry.get(name).summary.length > 0)
    assert.ok(registry.get(name).run.length >= 1)
  }
  for (const name of EXTENDED) {
    assert.ok(registry.get(name), `missing /${name}`)
    assert.ok(listed.has(name), `/${name} 未列出`)
  }
  for (const name of ['branch', 'rename']) assert.ok(listed.has(name))
  assert.equal(listed.size, ALL.length + EXTENDED.length + 2)
})

test('CMD-12 runCommand 委派注册表后行为不变（清理/退出/配置/帮助/未知）', async () => {
  const cleared = baseCtx()
  assert.match((await runCommand('/clear', cleared)).message, /会话已清空/)
  const exited = { called: false, ...baseCtx() }
  exited.exit = () => { exited.called = true }
  const exitOut = await runCommand('/quit', exited)
  assert.equal(exitOut.exit, true)
  assert.equal(exited.called, true)
  assert.match((await runCommand('/config', baseCtx())).message, /端点：b/)
  assert.match((await runCommand('/cost', baseCtx())).message, /累计输入/)
  assert.match((await runCommand('/help', baseCtx())).message, /compact/)
  const unknown = await runCommand('/nope-xyz', baseCtx())
  assert.match(unknown.error, /未知命令/)
  assert.equal((await runCommand('plain text', baseCtx())).handled, false)
})

test('CMD-12 runCommand 保留宿主副作用（面板/退出码形状）', async () => {
  const perm = { policy: { listRules: () => [], shadowed: () => [] }, store: { save() {} } }
  assert.equal((await runCommand('/resume', baseCtx())).openResume, true)
  assert.equal((await runCommand('/context', baseCtx())).openContext, true)
  assert.equal((await runCommand('/models', baseCtx())).openModels, true)
  assert.equal((await runCommand('/effort', baseCtx())).openEffort, true)
  assert.equal((await runCommand('/permissions', baseCtx({ permission: perm }))).openRules, true)
  assert.equal((await runCommand('/rewind', baseCtx())).openRewind, true)
  assert.equal((await runCommand('/config extra', baseCtx())).handled, true)
})
