// SP007 T9 — /agents 面板、/agent 派发、代理卡片、/tasks 分组与命令补全。
// 纯渲染/命令逻辑单测＋mount-tty 真实 Ink 帧级功能用例（参考仓 UI.tsx/AgentsMenu 行为对照）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentCardLines, agentTreeLines, agentColor, formatDuration } from '../dist/tui/render/agent-card.js'
import { AGENT_COLORS } from '../dist/core/agent-definitions.js'
import { listAgentEntries, invalidateAgentCache } from '../dist/tui/agents.js'
import { AGENTS_COMMANDS, agentListLines } from '../dist/tui/commands/builtin-agents.js'
import { createCommandRegistry } from '../dist/tui/commands/registry.js'
import { registerBuiltinCommands } from '../dist/tui/commands/index.js'
import { COMMAND_NAMES } from '../dist/tui/app.js'
import { mountTty } from './helpers/mount-tty.mjs'

const agentsCommand = AGENTS_COMMANDS.find((c) => c.name === 'agents')
const agentCommand = AGENTS_COMMANDS.find((c) => c.name === 'agent')

function card(overrides = {}) {
  return {
    agentId: 'agent-1', agentType: 'Explore', description: '查找文件',
    state: 'running', background: false, toolUses: 0, tokens: 0,
    lastTools: [], startedAt: 1000, ...overrides
  }
}

test('SA-16 卡片：无进度显示 Initializing…', () => {
  const view = agentCardLines(card(), { now: 1500 })
  assert.equal(view.title, '查找文件')
  assert.ok(view.lines.some((l) => l.includes('Initializing…')))
})

test('SA-16 卡片：运行中仅显最后 3 条工具＋+N more (ctrl+o expand)', () => {
  const view = agentCardLines(card({ toolUses: 5, tokens: 120, lastTools: ['Read a', 'Read b', 'Read c', 'Read d', 'Read e'] }), { now: 1500 })
  const joined = view.lines.join('\n')
  assert.ok(joined.includes('Read c'))
  assert.ok(joined.includes('Read e'))
  assert.ok(!joined.includes('Read a'))
  assert.ok(joined.includes('+2 more tool uses (ctrl+o expand)'))
})

test('SA-16 卡片：高度不足 compact 单行 In progress…', () => {
  const view = agentCardLines(card({ toolUses: 5, tokens: 120 }), { now: 1500, compact: true })
  assert.equal(view.lines.length, 1)
  assert.match(view.lines[0], /In progress… · 5 tool uses · 120 tokens/)
})

test('SA-16 卡片：≥2s 显 ctrl+b to background；后台化 footer', () => {
  const running = agentCardLines(card({ toolUses: 1, lastTools: ['Read x'] }), { now: 4000 })
  assert.ok((running.footer ?? '').includes('ctrl+b to background'))
  const bg = agentCardLines(card({ state: 'backgrounded', background: true, toolUses: 1, lastTools: ['Read x'] }), { now: 4000 })
  assert.ok((bg.footer ?? '').includes('Backgrounded agent (↓ manage)'))
})

test('SA-16 卡片：完成 Done (N tool uses · X tokens · 时长)；失败/取消红色', () => {
  const done = agentCardLines(card({ state: 'completed', toolUses: 3, tokens: 100, finishedAt: 5000 }), { now: 5000 })
  assert.ok(done.lines.some((l) => /Done \(3 tool uses · 100 tokens · /.test(l)))
  assert.equal(agentCardLines(card({ state: 'failed' })).color, 'red')
  assert.equal(agentCardLines(card({ state: 'cancelled' })).color, 'red')
})

test('SA-16 颜色：general-purpose 无色；其他 8 色；显式色优先', () => {
  assert.equal(agentColor('general-purpose'), undefined)
  assert.ok(AGENT_COLORS.includes(agentColor('Explore')))
  assert.equal(agentColor('Explore', 'pink'), 'pink')
  assert.equal(AGENT_COLORS.length, 8)
})

test('SA-15 并行树：≥2 running → Running N agents…＋├─/└─', () => {
  const lines = agentTreeLines([card({ agentId: 'a', description: '任务A' }), card({ agentId: 'b', description: '任务B', toolUses: 1, lastTools: ['Read x'] })], { now: 1500 })
  assert.ok(lines[0].includes('Running 2 agents…'))
  assert.ok(lines.some((l) => l.startsWith('├─')))
  assert.ok(lines.some((l) => l.startsWith('└─')))
  assert.deepEqual(agentTreeLines([card()], { now: 1500 }), [])
})

test('formatDuration：<60s Ns；≥60s Xm Ys', () => {
  assert.equal(formatDuration(5000), '5s')
  assert.equal(formatDuration(65000), '1m 5s')
})

test('SA-01 列表来源：user 覆盖 built-in 标 overridden；内置 Explore/Plan 在列', () => {
  const home = mkdtempSync(join(tmpdir(), 'sp007-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'sp007-cwd-'))
  mkdirSync(join(home, '.budingx', 'agents'), { recursive: true })
  writeFileSync(join(home, '.budingx', 'agents', 'general-purpose.md'), '---\nname: general-purpose\ndescription: 我的通用代理\n---\n正文')
  invalidateAgentCache()
  const { entries } = listAgentEntries({ cwd, home })
  const gp = entries.filter((e) => e.name === 'general-purpose')
  assert.equal(gp.length, 2)
  assert.ok(gp.some((e) => e.source === 'built-in' && e.overridden === true))
  assert.ok(gp.some((e) => e.source === 'user' && e.overridden === false))
  assert.ok(entries.some((e) => e.name === 'Explore' && e.source === 'built-in' && !e.overridden))
  assert.ok(entries.some((e) => e.name === 'Plan'))
  invalidateAgentCache()
})

test('SA-11 /agents：交互→openAgents＋清单；无头→仅文本', async () => {
  const home = mkdtempSync(join(tmpdir(), 'sp007-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'sp007-cwd-'))
  const interactive = await agentsCommand.run('', { interactive: true, cwd, home, lang: 'zh' })
  assert.equal(interactive.outcome.openAgents, true)
  assert.ok(interactive.value.includes('general-purpose'))
  assert.ok(interactive.value.includes('内置'))
  const headless = await agentsCommand.run('', { interactive: false, cwd, home, lang: 'zh' })
  assert.equal(headless.outcome.openAgents, undefined)
  assert.ok(headless.value.includes('general-purpose'))
})

test('SA-12 /agent：缺参给用法；完整→prompt 注入 subagent_type', async () => {
  const usage = await agentCommand.run('', { lang: 'zh' })
  assert.ok(usage.value.includes('用法'))
  const noPrompt = await agentCommand.run('Explore', { lang: 'zh' })
  assert.ok(noPrompt.value.includes('用法'))
  const ok = await agentCommand.run('Explore 找出所有 ts 文件', { lang: 'zh' })
  assert.ok(ok.outcome.prompt.text.includes('subagent_type="Explore"'))
  assert.ok(ok.outcome.prompt.text.includes('找出所有 ts 文件'))
})

test('SA-14 /tasks：子代理分组与 shell 分离', async () => {
  const registry = createCommandRegistry()
  registerBuiltinCommands(registry)
  const tasks = registry.get('tasks')
  const record = { agentId: 'abcdef123456', agentType: 'Explore', description: '查找文件', state: 'running', toolUses: 2, tokens: 50 }
  const withAgents = await tasks.run('', { lang: 'zh', tasks: { list: () => [] }, agents: { list: () => [record], stop: () => ({ ok: true }), background: () => true } })
  assert.ok(withAgents.value.includes('子代理（1）：'))
  assert.ok(withAgents.value.includes('查找文件'))
  assert.ok(withAgents.value.includes('TaskStop'))
  const noAgents = await tasks.run('', { lang: 'zh', tasks: { list: () => [] } })
  assert.ok(!noAgents.value.includes('子代理'))
})

test('SA-11 命令注册＋COMMAND_NAMES 补全（修 SP006 缺口）', () => {
  const registry = createCommandRegistry()
  registerBuiltinCommands(registry)
  assert.ok(registry.get('agents'))
  assert.ok(registry.get('agent'))
  assert.ok(registry.resolve('/agents'))
  assert.ok(registry.resolve('/agent Explore 任务'))
  for (const name of ['agents', 'agent', 'status', 'stats', 'doctor', 'init', 'btw', 'worktree', 'tasks', 'mcp', 'skills', 'export']) {
    assert.ok(COMMAND_NAMES.includes(name), 'COMMAND_NAMES 缺 ' + name)
  }
})

test('SA-11/SA-16 功能：/agents 真实 Ink 面板列表→新建向导→内置只读→关闭汇总', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'sp007-tty-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'sp007-tty-cwd-'))
  const tty = await mountTty(t, {
    provider: { async *stream() {} },
    commandOverrides: {
      interactive: true, cwd, home, lang: 'zh',
      agents: { list: () => [], stop: () => ({ ok: true }), background: () => true }
    }
  })
  await tty.send('/agents\r')
  await tty.waitFor((f) => f.includes('子代理') && f.includes('general-purpose') && f.includes('内置'))
  // n → 创建向导（仅 Manual，Generate 延期）
  await tty.send('n')
  await tty.waitFor((f) => f.includes('创建子代理（手动配置）') && f.includes('保存位置') && f.includes('项目 (.budingx/agents/)'))
  assert.ok(tty.last().includes('Generate with budingX 暂未提供'))
  // Enter 选位置 → 名称步；Esc 回位置；Esc 回列表
  await tty.send('\r')
  await tty.waitFor((f) => f.includes('名称'))
  await tty.send('\x1b')
  await tty.waitFor((f) => f.includes('保存位置'))
  await tty.send('\x1b')
  await tty.waitFor((f) => f.includes('↑↓ 选择'))
  // Enter 查看内置 → 只读；e → 不可编辑提示
  await tty.send('\r')
  await tty.waitFor((f) => f.includes('来源：内置') && f.includes('不可编辑/删除'))
  await tty.send('e')
  await tty.waitFor((f) => f.includes('内置代理不可编辑'))
  // Esc 回列表 → Esc 关闭，宿主 hint 汇总
  await tty.send('\x1b')
  await tty.waitFor((f) => f.includes('↑↓ 选择'))
  await tty.send('\x1b')
  await tty.waitFor((f) => f.includes('没有代理变更'))
})
