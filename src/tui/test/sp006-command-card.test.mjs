// SP006 回归：完成后的命令卡片不得继续占据实时区域，运行中最多一行。
// 证据层级 L2：真实 Ink 全屏帧 + 真实子进程，唯一假件是模型脚本。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session } from '../dist/core/session.js'
import { createWorkspace } from '../dist/workspace/paths.js'
import { createPermissionPolicy } from '../dist/workspace/policy.js'
import { createCommandRunner } from '../dist/exec/runner.js'
import { createExecTools } from '../dist/exec/tools.js'
import { createSandboxPolicy } from '../dist/exec/sandbox-policy.js'
import { mountTty } from './helpers/mount-tty.mjs'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: true }
}

const verifiedBackend = {
  id: 'synthetic-backend',
  label: '合成验收后端',
  verified: true,
  capabilities: {
    allowWrite: [],
    denyWrite: [],
    allowRead: [],
    denyRead: [],
    networkDomains: [],
    canEnforceNetwork: true
  }
}

test('T15-3c 完成后的命令卡片从实时区域消失，输出仍在转录中', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'budingx-card-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const root = join(base, 'project')
  mkdirSync(root)
  mkdirSync(join(base, '.budingx'))
  const workspace = createWorkspace(root)
  const runner = createCommandRunner({
    defaultCwd: root,
    sandboxPolicy: createSandboxPolicy({ backend: verifiedBackend })
  })
  const execTools = createExecTools({
    runner,
    defaultCwd: root,
    platform: process.platform,
    sandboxBackendId: verifiedBackend.id
  })
  const policy = createPermissionPolicy({
    workspace,
    dataRootOverride: join(base, '.budingx'),
    mode: 'full_access'
  })
  const provider = {
    async *stream() {
      const turn = provider.turns.shift()
      for (const event of turn ?? [{ type: 'message_completed', finishReason: 'stop' }]) yield event
    },
    turns: [
      [
        {
          type: 'tool_call_delta',
          index: 0,
          callId: 'call-card',
          nameDelta: 'Bash',
          argsDelta: JSON.stringify({ command: 'echo card-hidden' })
        },
        { type: 'message_completed', finishReason: 'tool_calls' }
      ],
      [
        { type: 'text_delta', text: 'card done' },
        { type: 'message_completed', finishReason: 'stop' }
      ]
    ]
  }
  const ui = await mountTty(t, {
    fullScreen: true,
    rows: 40,
    columns: 100,
    config: { model: 'test-model' },
    sessionFactory: ({ gateway }) =>
      new Session({
        provider,
        approval: gateway,
        resolveSnapshot: () => SNAPSHOT,
        tools: execTools,
        permissionPolicy: policy
      })
  })
  await ui.send('运行 echo 测试')
  await ui.send('\r')
  await ui.waitFor(
    (_last, frames) => !ui.session.isBusy && frames.join('\n').includes('card done'),
    30000
  )
  const frame = ui.last()
  assert.match(frame, /card-hidden/, '命令输出仍应保留在转录工具条目中')
  assert.doesNotMatch(frame, /✓ 命令/, '完成态不应再渲染命令卡片')
  assert.doesNotMatch(frame, /Ctrl\+E 展开\/收起输出/, '完成态不应常驻展开提示')
})
