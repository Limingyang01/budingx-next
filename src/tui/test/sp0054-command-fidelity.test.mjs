// 0.5.4 命令面复刻：别名/累计/手动压缩/回滚/选择面板/技能清单。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runCommand } from '../dist/tui/commands.js'
import { Session } from '../dist/core/session.js'

function baseCtx(extra = {}) {
  return {
    lang: 'zh', interactive: true,
    session: { clearHistory() {}, usageTotals: { inputTokens: 1000, outputTokens: 200, requests: 2, elapsedMs: 65000 }, planMode: { active: false }, enterPlanMode: () => ({ ok: true }), exitPlanMode: async () => ({ ok: true }), rewindCheckpoints: [], compactNow: () => ({ ok: true, before: 100, after: 10 }) },
    exit() {}, getConfig: () => ({ model: 'm', baseUrl: 'b', apiKey: 'k', timeoutMs: 1, source: 'file' }), setConfig() {},
    configStore: { load: () => ({ models: [] }) },
    ...extra
  }
}

test('0.5.4 /new 与 /reset 为 /clear 别名且保留规则提示', async () => {
  for (const cmd of ['/new', '/reset', '/clear']) {
    const out = await runCommand(cmd, baseCtx())
    assert.match(out.message, /会话已清空/)
  }
})

test('0.5.4 /cost 与 /usage 报累计 token 与时长', async () => {
  const out = await runCommand('/cost', baseCtx())
  assert.match(out.message, /累计输入/)
  assert.match(out.message, /1 分 5 秒/)
  const alias = await runCommand('/usage', baseCtx())
  assert.match(alias.message, /累计输入/)
})

test('0.5.4 /compact 调用手动压缩', async () => {
  const out = await runCommand('/compact 保留架构约束', baseCtx())
  assert.match(out.message, /已压缩/)
})

test('0.5.4 /rewind 与 /undo 无参数交互打开面板', async () => {
  assert.equal((await runCommand('/rewind', baseCtx())).openRewind, true)
})

test('0.5.4 /resume 无参数交互打开面板；/continue 无会话报错', async () => {
  assert.equal((await runCommand('/resume', baseCtx())).openResume, true)
  const out = await runCommand('/continue', baseCtx({ sessions: { list: () => [] } }))
  assert.match(out.error, /没有可恢复/)
})

test('0.5.4 /permissions 与 /allowed-tools 打开规则面板', async () => {
  const perm = { policy: { listRules: () => [], shadowed: () => [] }, store: { save() {} } }
  assert.equal((await runCommand('/permissions', baseCtx({ permission: perm }))).openRules, true)
  assert.equal((await runCommand('/allowed-tools', baseCtx({ permission: perm }))).openRules, true)
})

test('0.5.4 /context 交互打开网格面板', async () => {
  assert.equal((await runCommand('/context', baseCtx())).openContext, true)
})

test('0.5.4 真实 Session：compactNow 释放 token、rewindTo 回滚对话', () => {
  const session = new Session({
    provider: { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } },
    contextBudget: { maxTokens: 2000 }
  })
  const msgs = []
  for (let i = 0; i < 40; i++) {
    msgs.push({ id: 'u' + i, role: 'user', blocks: [{ type: 'text', text: '问题 ' + i + ' ' + 'x'.repeat(200) }] })
    msgs.push({ id: 'a' + i, role: 'assistant', blocks: [{ type: 'text', text: '回答 ' + i + ' ' + 'y'.repeat(200) }] })
  }
  session.restoreHistory(msgs)
  const compact = session.compactNow('保留架构约束')
  assert.equal(compact.ok, true)
  assert.ok(compact.after < compact.before)
  const checkpoints = session.rewindCheckpoints
  assert.ok(checkpoints.length > 0)
  const target = checkpoints[0]
  const rew = session.rewindTo(target.id)
  assert.equal(rew.ok, true)
  assert.ok(rew.removedMessages > 0)
  assert.equal(session.history.length, 0)
  session.dispose()
})

test('0.5.4 /help 列出已加载自定义技能命令', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'budingx-skills-'))
  const prev = process.cwd()
  try {
    mkdirSync(join(dir, '.budingx', 'skills', 'demo'), { recursive: true })
    writeFileSync(
      join(dir, '.budingx', 'skills', 'demo', 'SKILL.md'),
      'name: demo\ndescription: 演示技能\n\n演示技能正文。\n'
    )
    process.chdir(dir)
    const out = await runCommand('/help', baseCtx())
    assert.match(out.message, /\/demo/)
    assert.match(out.message, /演示技能/)
  } finally {
    process.chdir(prev)
    rmSync(dir, { recursive: true, force: true })
  }
})
