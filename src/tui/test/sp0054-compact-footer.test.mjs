// 0.5.4：底部元信息合并为一行，减少占据行数。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'
import { createWorkspace } from '../dist/workspace/paths.js'
import { createPermissionPolicy } from '../dist/workspace/policy.js'

test('0.5.4 底部元信息合并：模式/上下文/推理强度同区，不再单独占行', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'budingx-footer-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const workspace = createWorkspace(root)
  const policy = createPermissionPolicy({ mode: 'full_access', workspace })
  const provider = { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } }
  const ui = await mountTty(t, {
    fullScreen: true, columns: 100, rows: 40, provider,
    permissionPolicy: policy,
    config: { model: 'fixture' },
    commandOverrides: {
      permission: {
        policy, setMode: (mode) => policy.setMode(mode), store: { save: () => {}, load: () => ({ schemaVersion: 1, rules: [] }) },
        workspace, checkpointChanges: () => [], undo: () => ({ ok: true }), denials: () => [],
        modes: { order: ['read_only', 'workspace_edit', 'full_access'], zh: { read_only: '仅可查看', workspace_edit: '允许编辑', full_access: '全自动' }, en: { read_only: 'Read-only', workspace_edit: 'Allow edits', full_access: 'Full auto' } }
      },
      contextUsage: { usage: () => ({ usedTokens: 2900, maxTokens: 200000, percentUsed: 1.5, source: 'provider' }) },
      effort: { current: () => 'medium', set: () => {}, choices: ['low', 'medium', 'high'] }
    }
  })
  await ui.send('hi\r')
  await ui.waitFor((frame) => !ui.session.isBusy && frame.includes('tokens') && frame.includes('全自动'), 5000)
  const frame = ui.last()
  assert.match(frame, /全自动/)
  assert.match(frame, /⊙ 中 · \/effort/)
  assert.match(frame, /2\.9k|2900/)
  // 不再有单独的「可获准的写入免审批」行。
  assert.doesNotMatch(frame, /可获准的写入免审批/)
})
