// 0.5.4：出网能力（联网搜索）的审批规则。
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createWorkspace } from '../../tui/dist/workspace/paths.js'
import { createPermissionPolicy } from '../../tui/dist/workspace/policy.js'

function policyAt(mode) {
  const root = mkdtempSync(join(tmpdir(), 'budingx-net-policy-'))
  const workspace = createWorkspace(root)
  return createPermissionPolicy({ mode, workspace, root })
}

const search = { tool: 'WebSearch', capability: 'network' }

test('0.5.4 完全权限档位下出网工具不再逐次审批', () => {
  const policy = policyAt('full_access')
  const verdict = policy.decide(search)
  assert.equal(verdict.action, 'allow')
  assert.match(verdict.reason, /Full access mode/)
})

test('0.5.4 工作区修改档位下出网工具需要确认，但可本会话记住', () => {
  const policy = policyAt('workspace_edit')
  assert.equal(policy.canRemember(search), true)
  const first = policy.decide(search)
  assert.equal(first.action, 'ask')
  assert.match(first.reason, /Network access for WebSearch/)
  policy.remember(search)
  const second = policy.decide(search)
  assert.equal(second.action, 'allow')
  assert.match(second.reason, /Allowed for this session/)
})

test('0.5.4 仅可查看档位下出网工具也需要确认而不是直接放行', () => {
  const policy = policyAt('read_only')
  assert.equal(policy.canRemember(search), true)
  assert.equal(policy.decide(search).action, 'ask')
})

test('0.5.4 出网规则不影响执行与写入的既有判定', () => {
  const policy = policyAt('workspace_edit')
  assert.equal(policy.decide({ tool: 'Bash', capability: 'execute' }).action, 'ask')
  assert.equal(policy.decide({ tool: 'Write', capability: 'write', path: 'a.txt' }).action, 'ask')
})
