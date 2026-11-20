import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildStatusLineInput,
  renderStatusLine,
} from '../dist/tui/render/statusline.js'
import { normalizeStatusLineOutput, runStatusLineCommand } from '../dist/tui/statusline-command.js'

const state = {
  sessionId: 'sess-1',
  transcriptPath: '/tmp/sess-1.jsonl',
  cwd: '/work',
  permissionMode: 'workspace_edit',
  model: { id: 'deepseek', displayName: 'DeepSeek' },
  workspace: { currentDir: '/work', projectDir: '/work', addedDirs: ['/work/extra'] },
  version: '0.5.4',
  contextWindow: { usedTokens: 2500, windowSize: 200000 },
  cost: { totalCostUsd: 0, totalDurationMs: 1200, totalApiDurationMs: 800, totalLinesAdded: 3, totalLinesRemoved: 1 },
}

test('TU-09 状态栏载荷 = 基础输入 6 字段 + 状态栏 13 字段', () => {
  const input = buildStatusLineInput(state)
  for (const key of ['session_id', 'transcript_path', 'cwd', 'permission_mode', 'agent_id', 'agent_type']) {
    assert.ok(key in input, '缺少基础字段 ' + key)
  }
  for (const key of ['model', 'workspace', 'version', 'output_style', 'cost', 'context_window', 'exceeds_200k_tokens']) {
    assert.ok(key in input, '缺少状态栏字段 ' + key)
  }
  assert.equal(input.session_id, 'sess-1')
  assert.equal(input.permission_mode, 'workspace_edit')
  assert.equal(input.model.display_name, 'DeepSeek')
  assert.deepEqual(input.workspace.added_dirs, ['/work/extra'])
  assert.equal(input.version, '0.5.4')
})

test('TU-09 上下文窗口百分比与 current_usage 契约', () => {
  const input = buildStatusLineInput(state)
  assert.equal(input.context_window.context_window_size, 200000)
  assert.equal(input.context_window.used_percentage, 1.3)
  assert.equal(input.context_window.remaining_percentage, 98.7)
  assert.equal(input.context_window.current_usage, null)
  assert.equal(input.exceeds_200k_tokens, false)

  const withUsage = buildStatusLineInput({
    ...state,
    contextWindow: {
      usedTokens: 2500,
      windowSize: 250000,
      currentUsage: { inputTokens: 2000, outputTokens: 500, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    },
  })
  assert.deepEqual(withUsage.context_window.current_usage, {
    input_tokens: 2000,
    output_tokens: 500,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  })
  assert.equal(withUsage.exceeds_200k_tokens, true)
})

test('TU-09 rate_limits.resets_at 使用 epoch 秒且可选字段缺失即省略', () => {
  const input = buildStatusLineInput({
    ...state,
    rateLimits: { fiveHour: { usedPercentage: 12, resetsAt: 1735689600 }, sevenDay: { usedPercentage: 40, resetsAt: 1735776000 } },
    sessionName: 'demo',
  })
  assert.equal(input.rate_limits.five_hour.resets_at, 1735689600)
  assert.equal(input.session_name, 'demo')
  assert.equal('vim' in input, false)
  assert.equal('worktree' in input, false)
})

test('TU-10 内置状态栏渲染包含模型、版本与上下文占用', () => {
  const text = renderStatusLine(buildStatusLineInput(state))
  assert.match(text, /DeepSeek/)
  assert.match(text, /0\.5\.4/)
  assert.match(text, /1\.3%/)
})

test('TU-10 stdout 归一化：trim、逐行 trim、丢空行', () => {
  assert.equal(normalizeStatusLineOutput('  hello  \n\n world \n'), 'hello\nworld')
  assert.equal(normalizeStatusLineOutput('   '), '')
})

test('TU-10 外部命令真实进程：stdin JSON、stdout 渲染', async () => {
  const script = 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("  " + j.model.display_name + " | " + j.version + "  ");console.log("");console.log("ctx " + j.context_window.used_percentage + "%")})'
  const result = await runStatusLineCommand({ command: process.execPath, args: ['-e', script] }, buildStatusLineInput(state))
  assert.equal(result.ok, true)
  assert.equal(result.text, 'DeepSeek | 0.5.4\nctx 1.3%')
})

test('TU-10 非 0 退出码静默忽略', async () => {
  const result = await runStatusLineCommand({ command: process.execPath, args: ['-e', 'process.exit(3)'] }, buildStatusLineInput(state))
  assert.equal(result.ok, false)
  assert.match(result.reason, /exit/)
})

test('TU-10 超时终止且不抛出', async () => {
  const result = await runStatusLineCommand(
    { command: process.execPath, args: ['-e', 'setInterval(()=>{}, 1000)'], timeoutMs: 150 },
    buildStatusLineInput(state),
  )
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'timeout')
})
