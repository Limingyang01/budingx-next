// 0.5.4：/rules 交互管理面板（参照 /models）。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runCommand } from '../dist/tui/commands.js'
import { createPermissionPolicy } from '../dist/workspace/policy.js'
import { createWorkspace } from '../dist/workspace/paths.js'
import { mountTty } from './helpers/mount-tty.mjs'

function context(dir) {
  const workspace = createWorkspace(dir)
  const policy = createPermissionPolicy({ mode: 'workspace_edit', workspace })
  let saved = { schemaVersion: 1, rules: [] }
  const store = { save: (file) => { saved = file }, load: () => saved }
  return {
    policy, store, saved: () => saved,
    permission: { policy, store, workspace, setMode: (m) => policy.setMode(m), checkpointChanges: () => [], undo: () => ({ ok: true }), denials: () => [], modes: { order: ['read_only', 'workspace_edit', 'full_access'], zh: { read_only: '仅可查看', workspace_edit: '允许编辑', full_access: '全自动' }, en: { read_only: 'Read-only', workspace_edit: 'Allow edits', full_access: 'Full auto' } } }
  }
}

test('0.5.4 /rules 交互模式返回 openRules，管道模式仍列出', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'budingx-rules-'))
  try {
    const c = context(dir)
    const base = {
      lang: 'zh', session: { clearHistory() {} }, exit() {}, getConfig: () => ({}), setConfig: () => {},
      configStore: { load: () => ({ models: [] }) }, permission: c.permission, interactive: true
    }
    const open = await runCommand('/rules', base)
    assert.equal(open.openRules, true)
    const pipe = await runCommand('/rules', { ...base, interactive: false })
    assert.match(pipe.message ?? '', /暂无权限规则/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('0.5.4 /rules 面板可新增与删除规则', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'budingx-rules-ui-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const c = context(dir)
  const ui = await mountTty(t, {
    fullScreen: true, columns: 90, rows: 24,
    config: { model: 'fixture' },
    permissionPolicy: c.policy,
    commandOverrides: { permission: c.permission }
  })
  await ui.send('/rules\r')
  await ui.waitFor((frame) => frame.includes('权限') && frame.includes('允许'), 4000)
  await ui.send('a')
  await ui.waitFor((frame) => frame.includes('新增规则'), 2000)
  await ui.send('allow Bash')
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('Bash'), 3000)
  assert.equal(c.policy.listRules().length, 1)
  await ui.send('d')
  await ui.waitFor((frame) => frame.includes('（空）'), 3000)
  assert.equal(c.policy.listRules().length, 0)
  await ui.send('\x1b')
})
