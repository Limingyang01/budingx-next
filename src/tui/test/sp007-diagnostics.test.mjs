// SP007 T10 — 诊断纯逻辑（聚合/缓存/热力图/折线/status 字段/doctor 警告/清理/零网络）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyStats, ingestRecord, computeOverview, computeStreaks, computeModels, modelDailySeries, scanStats, STATS_CACHE_VERSION } from '../dist/tui/diagnostics/stats.js'
import { heatmapGrid, intensityChar } from '../dist/tui/diagnostics/heatmap.js'
import { lineChart, formatCount, renderAnsi } from '../dist/tui/diagnostics/ansi-chart.js'
import { assembleStatusReport } from '../dist/tui/diagnostics/status-report.js'
import { contextWarnings, MAX_INSTRUCTION_CHARS, MAX_AGENT_DESCRIPTION_TOKENS, MAX_MCP_SCHEMA_TOKENS } from '../dist/tui/diagnostics/doctor-warnings.js'
import { buildDoctorReport, cleanupStaleTemp } from '../dist/tui/diagnostics/doctor.js'

function msg(date, model, input, output, role = 'assistant') {
  return { type: 'message', ts: date + 'T10:00:00Z', id: 'm', role, blocks: [], model, usage: { inputTokens: input, outputTokens: output } }
}

test('RD-04 聚合：assistant usage 按模型按日；subagent 计 token 不计会话；unknown 桶', () => {
  const stats = emptyStats()
  ingestRecord(stats, msg('2026-11-20', 'm1', 100, 50), { isSubagent: false, sessionId: 's1' })
  ingestRecord(stats, msg('2026-11-20', 'm1', 10, 5), { isSubagent: false, sessionId: 's1' })
  ingestRecord(stats, msg('2026-11-21', 'm2', 200, 100), { isSubagent: false, sessionId: 's2' })
  ingestRecord(stats, { type: 'message', ts: '2026-11-21T10:00:00Z', role: 'assistant', blocks: [], usage: { inputTokens: 7, outputTokens: 3 } }, { isSubagent: false, sessionId: 's2' })
  ingestRecord(stats, msg('2026-11-21', 'm1', 500, 500), { isSubagent: true, sessionId: 's1' })
  assert.equal(stats.days['2026-11-20'].m1.input, 110)
  assert.equal(stats.days['2026-11-20'].m1.output, 55)
  assert.equal(stats.days['2026-11-21'].m2.input, 200)
  assert.equal(stats.days['2026-11-21'].unknown.input, 7)
  assert.equal(stats.subagentTokens.input, 500)
  assert.equal(stats.subagentTokens.output, 500)
  assert.equal(stats.sessionMessages.s1, 2)
  assert.equal(stats.sessionMessages.s2, 2)
})

test('RD-04 tool_use 块计数', () => {
  const stats = emptyStats()
  ingestRecord(stats, { type: 'message', ts: '2026-11-21T10:00:00Z', role: 'assistant', blocks: [{ type: 'tool_use' }, { type: 'tool_use' }, { type: 'text' }] }, { isSubagent: false, sessionId: 's1' })
  assert.equal(stats.toolUses, 2)
})

test('RD-06 streak：longest 历史最长；current 截至 today', () => {
  const streaks = computeStreaks(['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'], '2026-11-21')
  assert.equal(streaks.longest, 4)
  assert.equal(streaks.current, 4)
  const gap = computeStreaks(['2026-11-10', '2026-11-11', '2026-11-20', '2026-11-21'], '2026-11-21')
  assert.equal(gap.longest, 2)
  assert.equal(gap.current, 2)
  const none = computeStreaks(['2026-11-10'], '2026-11-21')
  assert.equal(none.current, 0)
})

test('RD-05 overview：favorite/total/activeDays/mostActiveDay/longestSession', () => {
  const stats = emptyStats()
  ingestRecord(stats, msg('2026-11-20', 'm1', 100, 100), { isSubagent: false, sessionId: 's1' })
  ingestRecord(stats, msg('2026-11-21', 'm2', 300, 300), { isSubagent: false, sessionId: 's2' })
  ingestRecord(stats, msg('2026-11-21', 'm2', 100, 100), { isSubagent: false, sessionId: 's2' })
  stats.sessions = 2
  const overview = computeOverview(stats, { today: '2026-11-21' })
  assert.equal(overview.favoriteModel, 'm2')
  assert.equal(overview.totalTokens, 1000)
  assert.equal(overview.activeDays, 2)
  assert.equal(overview.sessions, 2)
  assert.equal(overview.mostActiveDay.date, '2026-11-21')
  assert.equal(overview.mostActiveDay.tokens, 800)
  assert.equal(overview.longestSession.sessionId, 's2')
})

test('RD-07 models：降序百分比＋In/Out；daily series 缺日补 0', () => {
  const stats = emptyStats()
  ingestRecord(stats, msg('2026-11-20', 'm1', 100, 0), { isSubagent: false, sessionId: 's1' })
  ingestRecord(stats, msg('2026-11-21', 'm2', 300, 0), { isSubagent: false, sessionId: 's1' })
  const models = computeModels(stats)
  assert.equal(models[0].model, 'm2')
  assert.equal(models[0].percent, 75)
  assert.equal(models[1].percent, 25)
  const series = modelDailySeries(stats, 'm1')
  assert.deepEqual(series.dates, ['2026-11-20', '2026-11-21'])
  assert.deepEqual(series.values, [100, 0])
})

test('RD-05 scanStats：双会话＋subagent 聚合；会话数不含 subagent', () => {
  const root = mkdtempSync(join(tmpdir(), 'sp007-stats-'))
  const sessions = join(root, 'sessions')
  mkdirSync(join(sessions, 's1'), { recursive: true })
  mkdirSync(join(sessions, 's1', 'subagents'), { recursive: true })
  mkdirSync(join(sessions, 's2'), { recursive: true })
  writeFileSync(join(sessions, 's1', 'transcript.jsonl'), JSON.stringify(msg('2026-11-21', 'm1', 100, 50)) + '\n')
  writeFileSync(join(sessions, 's1', 'subagents', 'agent-x.jsonl'), JSON.stringify(msg('2026-11-21', 'm1', 999, 999)) + '\n')
  writeFileSync(join(sessions, 's2', 'transcript.jsonl'), JSON.stringify(msg('2026-11-21', 'm2', 200, 100)) + '\n')
  const { stats } = scanStats({ sessionsDir: sessions, today: '2026-11-21', range: 'all' })
  assert.equal(stats.sessions, 2)
  assert.equal(stats.days['2026-11-21'].m1.input, 100 + 999)
  assert.equal(stats.subagentTokens.input, 999)
  assert.equal(stats.sessionMessages.s1, 1)
})

test('RD-05 缓存：版本更旧全量重算；今天恒实时；7d 绕过缓存', () => {
  const root = mkdtempSync(join(tmpdir(), 'sp007-cache-'))
  const sessions = join(root, 'sessions')
  mkdirSync(join(sessions, 's1'), { recursive: true })
  writeFileSync(join(sessions, 's1', 'transcript.jsonl'), JSON.stringify(msg('2026-11-21', 'm1', 100, 50)) + '\n')
  const cachePath = join(root, 'stats-cache.json')
  // 旧版本缓存→忽略全量重算
  writeFileSync(cachePath, JSON.stringify({ version: 0, computedThrough: '2026-11-20', stats: emptyStats() }))
  const r1 = scanStats({ sessionsDir: sessions, today: '2026-11-21', range: 'all', cachePath })
  assert.equal(r1.stats.days['2026-11-21'].m1.input, 100)
  // 写入的缓存版本正确、computedThrough=昨天
  const written = JSON.parse(readFileSync(cachePath, 'utf8'))
  assert.equal(written.version, STATS_CACHE_VERSION)
  assert.equal(written.computedThrough, '2026-11-20')
  // 7d 绕过缓存（即使缓存存在也按 fromDate 重算）
  const r7 = scanStats({ sessionsDir: sessions, today: '2026-11-21', range: '7d', cachePath })
  assert.equal(r7.fromDate, '2026-11-15')
  assert.equal(r7.stats.days['2026-11-21'].m1.input, 100)
})

test('RD-06 热力图：7 行×weeks 列；强度分档；未来留空', () => {
  assert.equal(intensityChar(0, 10), ' ')
  assert.equal(intensityChar(10, 10), '█')
  const grid = heatmapGrid({ '2026-11-21': 10 }, { endDate: '2026-11-21', weeks: 4 })
  assert.equal(grid.rows.length, 7)
  assert.equal(grid.columns, 4)
  assert.ok(grid.rows.every((row) => row.length === 4))
  assert.equal(grid.max, 10)
  assert.equal(grid.total, 10)
})

test('RD-07 折线：<2 点不画；尺寸公式；formatCount k/M', () => {
  assert.deepEqual(lineChart([5]), [])
  assert.deepEqual(lineChart([]), [])
  const chart = lineChart([1, 2, 3, 4], { height: 8, width: 10 })
  assert.equal(chart.length, 9)
  assert.ok(chart[0].includes('4'))
  assert.equal(formatCount(999), '999')
  assert.equal(formatCount(1500), '1.5k')
  assert.equal(formatCount(2000000), '2M')
})

test('RD-08 renderAnsi：含 ANSI 色与字段', () => {
  const ansi = renderAnsi({ title: 'Statistics', favoriteModel: 'm1', totalTokens: 1500, sessions: 3, activeDays: 5, longestStreak: 4, currentStreak: 2, models: [{ model: 'm1', tokens: 1500, percent: 100 }] })
  assert.ok(ansi.includes('\x1b['))
  assert.ok(ansi.includes('Statistics'))
  assert.ok(ansi.includes('m1'))
  assert.ok(ansi.includes('1.5k'))
})

test('RD-01/02/03 status 字段：不显权限模式；MCP 计数；RSS/p50/p95；来源仅非空', () => {
  const report = assembleStatusReport({
    version: '0.6.0', sessionId: 'sid', cwd: '/work', model: 'm1', profileLabel: '档', baseUrlHost: 'api.x.com',
    credentialSource: 'file', mcp: { connected: 2, failed: 1, pending: 0 }, settingSources: ['file', '', 'env'],
    warnings: ['项目指令过长'], config: { source: 'file', protocol: 'anthropic', model: 'm1', tools: true, vision: false },
    usage: { requests: 3, inputTokens: 100, outputTokens: 50, elapsedMs: 1200 },
    performance: { requestMs: { p50: 100, p95: 300, last: 200 }, firstTokenMs: { p50: 20, p95: 60, last: 30 }, memoryRssBytes: 100 * 1024 * 1024 }
  })
  const all = [...report.status, ...report.config, ...report.usage]
  assert.ok(!all.some((field) => /权限模式|permission mode/i.test(field.label + field.value)))
  assert.ok(report.status.some((field) => field.label === 'MCP' && field.value.includes('2 connected / 1 failed / 0 pending') && field.value.includes('/mcp')))
  assert.ok(report.status.some((field) => field.label === 'Setting sources' && field.value === 'file, env'))
  assert.ok(report.usage.some((field) => field.label === '进程 RSS' && field.value === '100.0 MB'))
  assert.ok(report.usage.some((field) => field.label === '请求 p50/p95' && field.value.includes('100ms') && field.value.includes('300ms')))
  assert.ok(report.config.some((field) => field.label === '协议' && field.value === 'anthropic'))
})

test('RD-09/11 doctor 警告阈值：40000 字符/15000 token/25000 token/不可达规则', () => {
  assert.equal(MAX_INSTRUCTION_CHARS, 40000)
  assert.equal(MAX_AGENT_DESCRIPTION_TOKENS, 15000)
  assert.equal(MAX_MCP_SCHEMA_TOKENS, 25000)
  const none = contextWarnings({ instructionChars: 100, agents: [], mcpServers: [], unreachableRules: [] })
  assert.deepEqual(none, [])
  const warnings = contextWarnings({
    instructionChars: 40001,
    agents: [{ name: 'a1', description: 'x'.repeat(80000) }],
    mcpServers: [{ name: 'srv', schema: 'y'.repeat(120000) }],
    unreachableRules: [{ rule: 'deny Write', reason: '被更高优先级 allow 覆盖' }]
  })
  assert.ok(warnings.some((w) => w.issue.includes('40000') && w.section === 'Context Usage Warnings'))
  assert.ok(warnings.some((w) => w.issue.includes('15000') && w.issue.includes('a1')))
  assert.ok(warnings.some((w) => w.issue.includes('srv') && w.issue.includes('25000')))
  assert.ok(warnings.some((w) => w.section === 'Unreachable Permission Rules' && w.fix.includes('覆盖')))
})

test('RD-09 doctor 报告：无问题分区隐藏；warningCount', () => {
  const clean = buildDoctorReport({ runtime: { kind: 'development', version: '0.6.0', nodeVersion: 'v22', entryPath: '/cli.js', searchAvailable: true }, installations: [], configCorrupt: false, mcpFailed: [], keybindingWarnings: [], envIssues: [], agentParseErrors: [], contextWarnings: [] })
  assert.equal(clean.sections.length, 1)
  assert.equal(clean.sections[0].title, 'Diagnostics')
  assert.equal(clean.warningCount, 0)
  const dirty = buildDoctorReport({ runtime: { kind: 'npm-global', version: '0.6.0', nodeVersion: 'v22', entryPath: '/cli.js', searchAvailable: false }, installations: ['并存'], configCorrupt: true, mcpFailed: [{ name: 's', error: 'boom' }], keybindingWarnings: ['坏键'], envIssues: [{ name: 'BUDINGX_X', issue: '非法' }], agentParseErrors: ['坏代理'], contextWarnings: [{ section: 'Context Usage Warnings', issue: 'i', fix: 'f' }] })
  assert.ok(dirty.sections.length > 1)
  assert.ok(dirty.warningCount >= 6)
  assert.ok(dirty.sections.some((s) => s.title === 'Invalid Settings'))
})

test('RD-10 清理：超 24h budingx-clipboard-* 删除计数；新文件保留', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp007-clean-'))
  const old = join(dir, 'budingx-clipboard-old.png')
  const fresh = join(dir, 'budingx-clipboard-fresh.png')
  const other = join(dir, 'unrelated.png')
  writeFileSync(old, 'x'); writeFileSync(fresh, 'x'); writeFileSync(other, 'x')
  const now = Date.now()
  utimesSync(old, new Date(now - 25 * 3600 * 1000), new Date(now - 25 * 3600 * 1000))
  utimesSync(other, new Date(now - 25 * 3600 * 1000), new Date(now - 25 * 3600 * 1000))
  const result = cleanupStaleTemp({ tmpDir: dir, now })
  assert.equal(result.cleaned, 1)
  assert.ok(!existsSync(old))
  assert.ok(existsSync(fresh))
  assert.ok(existsSync(other))
})

test('RD-15 零网络：聚合/报告不调用 fetch', () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = () => { calls++; throw new Error('network forbidden') }
  try {
    const root = mkdtempSync(join(tmpdir(), 'sp007-net-'))
    const sessions = join(root, 'sessions')
    mkdirSync(join(sessions, 's1'), { recursive: true })
    writeFileSync(join(sessions, 's1', 'transcript.jsonl'), JSON.stringify(msg('2026-11-21', 'm1', 1, 1)) + '\n')
    scanStats({ sessionsDir: sessions, today: '2026-11-21', range: 'all' })
    buildDoctorReport({ runtime: { kind: 'development', version: '0.6.0', nodeVersion: 'v22', entryPath: '/cli.js', searchAvailable: true }, installations: [], configCorrupt: false, mcpFailed: [], keybindingWarnings: [], envIssues: [], agentParseErrors: [], contextWarnings: [] })
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = original
  }
})
