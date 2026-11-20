// 0.5.4 命令菜单：/ 唤起全部、短描述、单一 permissions。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'
import { commandCandidates } from '../dist/tui/render/completion.js'
import { createPermissionPolicy } from '../dist/workspace/policy.js'
import { createWorkspace } from '../dist/workspace/paths.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('0.5.4 commandCandidates 不再截断为 5', () => {
  const names = ['help','models','permissions','rules','diff','undo','rewind','clear','new','resume','context','compact','cost','plan','exit']
  const all = commandCandidates('', names)
  assert.equal(all.length, names.length)
})

test('0.5.4 / 菜单显示全部命令+短描述，无[命令]文案，单一 permissions', async (t) => {
  const ui = await mountTty(t, { fullScreen: true, columns: 90, rows: 40, config: { model: 'fixture' }, provider: { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } } })
  await ui.send('/')
  await ui.waitFor((f) => f.includes('/permissions') && f.includes('权限白名单'), 3000)
  const frame = ui.last()
  assert.doesNotMatch(frame, /\[命令\]|\[cmd\]/)
  // 别名不出现在菜单（避免 /new /reset /continue 等重复项）
  assert.doesNotMatch(frame, /\/new\b|\/reset\b|\/continue\b|\/usage\b/)
  // 向下导航可到达更多命令（超过旧的 5 条上限）
  for (let i = 0; i < 12; i++) await ui.send('\x1b[B')
  await ui.waitFor((f) => /\/cost|\/plan|\/exit|\/memory/.test(f), 3000)
  await ui.send('\x1b')
})

test('0.5.4 Shift+Tab 三档完整轮播回到仅可查看', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'budingx-cycle-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const workspace = createWorkspace(dir)
  const policy = createPermissionPolicy({ mode: 'read_only', workspace })
  const permission = { policy, workspace, setMode: (m) => policy.setMode(m), store: { save() {}, load: () => ({ schemaVersion: 1, rules: [] }) }, checkpointChanges: () => [], undo: () => ({ undone: false, paths: [] }), denials: () => [], modes: { order: ['read_only', 'workspace_edit', 'full_access'], zh: { read_only: '仅可查看', workspace_edit: '允许编辑', full_access: '全自动' }, en: { read_only: 'Read-only', workspace_edit: 'Allow edits', full_access: 'Full auto' } } }
  const ui = await mountTty(t, { fullScreen: true, columns: 90, rows: 24, config: { model: 'fixture' }, permissionPolicy: policy, commandOverrides: { permission }, provider: { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } } })
  await ui.waitFor((f) => f.includes('仅可查看'), 3000)
  await ui.send('\x1b[Z')
  await ui.waitFor((f) => f.includes('允许编辑'), 2000)
  await ui.send('\x1b[Z')
  await ui.waitFor((f) => f.includes('全自动'), 2000)
  await ui.send('\x1b[Z')
  await ui.waitFor((f) => f.includes('仅可查看'), 2000)
})
