// SP006 §4：四区骨架 + 外部状态栏命令（帧级证据）。
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'
import { createWorkspace } from '../dist/workspace/paths.js'
import { createPermissionPolicy } from '../dist/workspace/policy.js'
import { freezeCacheStats, resetFreezeCacheStats } from '../dist/tui/render/history-window.js'

function policyFor(root) {
  const workspace = createWorkspace(root)
  const policy = createPermissionPolicy({ mode: 'full_access', workspace })
  return { workspace, policy }
}

const permissionOverrides = (workspace, policy) => ({
  permission: {
    policy,
    setMode: (mode) => policy.setMode(mode),
    store: { save: () => {}, load: () => ({ schemaVersion: 1, rules: [] }) },
    workspace,
    checkpointChanges: () => [],
    undo: () => ({ ok: true }),
    denials: () => [],
    modes: {
      order: ['read_only', 'workspace_edit', 'full_access'],
      zh: { read_only: '仅可查看', workspace_edit: '允许编辑', full_access: '全自动' },
      en: { read_only: 'Read-only', workspace_edit: 'Allow edits', full_access: 'Full auto' }
    }
  }
})

test('TU-01 四区骨架：页脚在最后一行且保留权限模式与提示', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'budingx-sp006-frames-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { workspace, policy } = policyFor(root)
  const provider = { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } }
  const ui = await mountTty(t, {
    fullScreen: true, columns: 100, rows: 40, provider, permissionPolicy: policy,
    config: { model: 'fixture' },
    commandOverrides: permissionOverrides(workspace, policy)
  })
  await ui.send('hi\r')
  await ui.waitFor((frame) => !ui.session.isBusy && frame.includes('全自动'), 5000)
  const frame = ui.last()
  const rows = frame.split('\n').filter((line) => line.trim().length > 0)
  // 输入区在页脚之上，页脚（元信息行 + 可选提示）在最后。
  const inputIndex = rows.findIndex((line) => line.trimStart().startsWith('>'))
  assert.ok(inputIndex >= 0, 'input region must be visible')
  assert.ok(inputIndex < rows.length - 1, 'footer must sit below the input region')
  const footer = rows.slice(inputIndex + 1).join('\n')
  assert.match(footer, /全自动/)
  assert.doesNotMatch(footer, /^>\s*$/m)
})

test('TU-10 外部状态栏命令：stdin 收到 JSON，stdout 显示在页脚', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'budingx-sp006-statusline-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { workspace, policy } = policyFor(root)
  const seen = join(root, 'payload.json')
  const provider = { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } }
  const script = [
    "let d='';process.stdin.on('data',(c)=>d+=c).on('end',()=>{",
    'const j=JSON.parse(d);',
    `require('fs').writeFileSync(${JSON.stringify(seen)},d);`,
    "process.stdout.write('SL ' + j.model.display_name + ' ' + j.context_window.context_window_size + '\\n')",
    '})'
  ].join('')
  const ui = await mountTty(t, {
    fullScreen: true, columns: 100, rows: 40, provider, permissionPolicy: policy,
    config: { model: 'fixture' },
    commandOverrides: {
      ...permissionOverrides(workspace, policy),
      configStore: {
        path: join(root, 'config.json'),
        load: () => ({
          version: 1,
          models: [],
          statusLine: { type: 'command', command: process.execPath, args: ['-e', script] }
        })
      },
      contextUsage: { usage: () => ({ usedTokens: 2000, maxTokens: 200000, percentUsed: 1, source: 'provider' }) }
    }
  })
  await ui.waitFor((frame) => frame.includes('SL fixture'), 5000)
  const payload = JSON.parse(readFileSync(seen, 'utf8'))
  assert.equal(payload.model.display_name, 'fixture')
  assert.equal(typeof payload.context_window.context_window_size, 'number')
  assert.equal(typeof payload.session_id, 'string')
  // 外部文本与内置元信息同时存在：外部命令不替换权限模式行。
  const frame = ui.last()
  assert.match(frame, /SL fixture/)
  assert.match(frame, /全自动/)
})

test('TU-10 外部命令失败静默回落，不中断会话', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'budingx-sp006-statusline-fail-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { workspace, policy } = policyFor(root)
  const provider = { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } }
  const ui = await mountTty(t, {
    fullScreen: true, columns: 100, rows: 40, provider, permissionPolicy: policy,
    config: { model: 'fixture' },
    commandOverrides: {
      ...permissionOverrides(workspace, policy),
      configStore: {
        path: join(root, 'config.json'),
        load: () => ({
          version: 1,
          models: [],
          statusLine: { type: 'command', command: process.execPath, args: ['-e', 'process.exit(3)'] }
        })
      }
    }
  })
  await ui.send('hi\r')
  await ui.waitFor((frame) => !ui.session.isBusy && frame.includes('全自动'), 5000)
  assert.match(ui.last(), /全自动/)
  // 内置状态栏仍可用（外部失败不弹出错误）。
  assert.doesNotMatch(ui.last(), /statusLine(.*)失败/)
})

test('TU-03 已完成条目复用冻结元素：重渲染只命中缓存，不重建消息节点', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'budingx-sp006-freeze-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { workspace, policy } = policyFor(root)
  const provider = { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } }
  const ui = await mountTty(t, {
    fullScreen: true, columns: 100, rows: 40, provider, permissionPolicy: policy,
    config: { model: 'fixture' },
    commandOverrides: permissionOverrides(workspace, policy)
  })
  await ui.send('hi\r')
  await ui.waitFor((frame) => !ui.session.isBusy && frame.includes('全自动'), 5000)
  resetFreezeCacheStats()
  // 仅输入区变化，历史条目对象与宽度不变。
  await ui.send('x')
  await new Promise((resolve) => setTimeout(resolve, 150))
  const stats = freezeCacheStats()
  assert.ok(stats.hits >= 1, 'expected frozen elements to be reused, got ' + JSON.stringify(stats))
  assert.equal(stats.misses, 0, 'unchanged history must not rebuild message nodes')
})

