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

test('验收期修复（m02582）：曾缺描述的命令在菜单中显示中文短描述', async (t) => {
  const ui = await mountTty(t, { fullScreen: true, columns: 90, rows: 40, config: { model: 'fixture' }, provider: { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } } })
  const cases = [
    ['init', '生成项目指令骨架'],
    ['btw', '旁路提问'],
    ['worktree', '管理隔离工作树'],
    ['tasks', '后台任务与子代理'],
    ['mcp', 'MCP 服务器与工具'],
    ['skills', '查看已发现技能'],
    ['export', '导出会话记录'],
    ['agents', '管理子代理'],
    ['agent', '派发子代理任务'],
    ['status', '会话状态与配置来源'],
    ['stats', '用量统计'],
    ['doctor', '安装与配置诊断'],
    ['image', '挂载图片附件']
  ]
  for (const [name, desc] of cases) {
    await ui.send('/' + name)
    await ui.waitFor((f) => f.includes('/' + name) && f.includes(desc), 3000)
    for (let i = 0; i < name.length + 1; i++) await ui.send('\x7f')
  }
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

test('非全屏退化终端 /help 以正文块列出命令而非压成一行状态提示', async (t) => {
  const ui = await mountTty(t, { fullScreen: false, columns: 100, rows: 40, config: { model: 'fixture' }, provider: { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } } })
  await ui.send('/help\r')
  await ui.waitFor((f) => f.includes('/resume') && f.includes('/tasks'), 5000)
  const frame = ui.last()
  assert.match(frame, /命令：/)
  assert.match(frame, /\/resume/)
  assert.doesNotMatch(frame, /— 命令：/)
})
