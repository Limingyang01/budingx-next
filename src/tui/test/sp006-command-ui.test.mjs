// SP006 §6.3：命令面在真实 Ink 帧中的接线（/mcp 列表、/btw 旁路回显）。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'
import { createWorkspace } from '../dist/workspace/paths.js'
import { createPermissionPolicy } from '../dist/workspace/policy.js'

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

test('CMD-09 /mcp 在帧中打开只读列表，Esc 关闭且输入区被模态占用', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'budingx-cmd-ui-mcp-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { workspace, policy } = policyFor(root)
  const provider = { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } }
  const ui = await mountTty(t, {
    fullScreen: true, columns: 100, rows: 40, provider, permissionPolicy: policy,
    config: { model: 'fixture' },
    commandOverrides: {
      ...permissionOverrides(workspace, policy),
      cwd: root,
      home: root,
      mcp: { statuses: [
        { name: 'alpha', connected: true, tools: 3, serverName: 'srv', serverVersion: '1.0' },
        { name: 'beta', connected: false, tools: 0, error: 'boom' }
      ] }
    }
  })
  await ui.send('/mcp\r')
  await ui.waitFor((frame) => frame.includes('MCP 服务器') && frame.includes('alpha'), 5000)
  const open = ui.last()
  assert.match(open, /alpha · 已连接 · 工具 3 个/)
  assert.match(open, /beta · 未连接 · boom/)
  assert.match(open, /Esc 关闭/)
  assert.equal(ui.session.history.length, 0)
  await ui.send('\x1b')
  await ui.waitFor((frame) => !frame.includes('MCP 服务器'), 5000)
})

test('CMD-06 /btw 在帧中回显旁路回答且不写入主会话历史', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'budingx-cmd-ui-btw-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { workspace, policy } = policyFor(root)
  const calls = []
  const provider = {
    async *stream(request) {
      calls.push(request)
      yield { type: 'text_delta', text: '旁路答案' }
      yield { type: 'message_completed', finishReason: 'stop' }
    }
  }
  const ui = await mountTty(t, {
    fullScreen: true, columns: 100, rows: 40, provider, permissionPolicy: policy,
    config: { model: 'fixture' },
    commandOverrides: { ...permissionOverrides(workspace, policy), cwd: root, home: root }
  })
  await ui.send('/btw 主循环是什么\r')
  await ui.waitFor((frame) => frame.includes('旁路回答（未写入会话）') && frame.includes('旁路答案'), 5000)
  assert.equal(calls.length, 1)
  assert.equal(ui.session.history.length, 0, '旁路问答不得进入主历史')
  assert.match(ui.last(), /旁路答案/)
})
