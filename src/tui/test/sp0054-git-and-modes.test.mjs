// 0.5.4：Git 命令不再被只读白名单硬拦，按权限档位审批；三档轮播。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createExecTools } from '../dist/exec/tools.js'
import { nextMode } from '../dist/workspace/policy.js'

const verifiedBackend = {
  id: 'synthetic-backend',
  label: '合成验收后端',
  verified: true,
  capabilities: { allowWrite: [], denyWrite: [], allowRead: [], denyRead: [], networkDomains: [], canEnforceNetwork: true }
}

function makeTool() {
  const run = []
  const runner = {
    async run(spec) {
      run.push(spec.command)
      return { outcome: 'completed', exitCode: 0, stdout: 'ok', stderr: '', output: 'ok', truncated: false, bytes: 2, durationMs: 1 }
    }
  }
  const [bash] = createExecTools({
    runner,
    defaultCwd: process.cwd(),
    platform: process.platform,
    sandboxBackendId: verifiedBackend.id,
    sandboxPolicy: { decide: () => ({ action: 'allow', backendId: verifiedBackend.id }), backend: () => verifiedBackend }
  })
  return { bash, run }
}

test('0.5.4 Git 写命令归为执行能力而不是被白名单拒绝', () => {
  const { bash } = makeTool()
  assert.equal(bash.capability({ command: 'git add .' }), 'execute')
  assert.equal(bash.capability({ command: 'git commit -m x' }), 'execute')
  // 只读 git 仍免审批。
  assert.equal(bash.capability({ command: 'git status' }), 'read')
})

test('0.5.4 Git 命令不再抛「不在只读白名单」并真实进入执行器', async () => {
  const { bash, run } = makeTool()
  // 预览不再因白名单报错（此前 prepareApproval 会抛）。
  const prepared = bash.prepareApproval({ command: 'git add .' })
  assert.ok(Array.isArray(prepared.preview))
  const output = await bash.execute({ command: 'git add .' }, { signal: new AbortController().signal })
  assert.match(output, /exit_code: 0/)
  assert.deepEqual(run, ['git add .'])
})

test('0.5.4 Shift+Tab 三档完整轮播：仅可查看 → 工作区内修改 → 完全权限 → 仅可查看', () => {
  assert.equal(nextMode('read_only'), 'workspace_edit')
  assert.equal(nextMode('workspace_edit'), 'full_access')
  assert.equal(nextMode('full_access'), 'read_only')
})
