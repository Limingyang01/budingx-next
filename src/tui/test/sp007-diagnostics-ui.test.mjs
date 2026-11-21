// SP007 T10 — 诊断端口组装＋/status /stats /doctor 真实 Ink 帧级功能用例。
// 纯逻辑聚合见 sp007-diagnostics.test.mjs；本文件验证宿主接线与面板交互（参考 Settings/Stats/Doctor）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDiagnosticsPort } from '../dist/tui/diagnostics/port.js'
import { DIAGNOSTICS_COMMANDS } from '../dist/tui/commands/builtin-diagnostics.js'
import { createCommandRegistry } from '../dist/tui/commands/registry.js'
import { registerBuiltinCommands } from '../dist/tui/commands/index.js'
import { mountTty, fixtureStores } from './helpers/mount-tty.mjs'

const statusCommand = DIAGNOSTICS_COMMANDS.find((c) => c.name === 'status')
const statsCommand = DIAGNOSTICS_COMMANDS.find((c) => c.name === 'stats')
const doctorCommand = DIAGNOSTICS_COMMANDS.find((c) => c.name === 'doctor')

function fakeRuntime(overrides = {}) {
  return {
    session: {
      id: 'sess-1',
      usageTotals: { inputTokens: 100, outputTokens: 50, requests: 3, elapsedMs: 1200 },
      performance: {
        requests: 3,
        requestMs: { p50: 100, p95: 200, last: 150 },
        firstTokenMs: { p50: 30, p95: 60, last: 40 },
        inputTokens: 100, outputTokens: 50, elapsedMs: 1200, memoryRssBytes: 80 * 1024 * 1024
      }
    },
    warnings: [],
    ...overrides
  }
}

function fakePort(home) {
  return {
    statusInput: () => ({
      version: '0.7.0', sessionId: 'sess-1', cwd: home, model: 'fixture-model',
      baseUrlHost: 'fixture.invalid', credentialSource: 'env',
      mcp: { connected: 1, failed: 0, pending: 0 }, settingSources: ['env'], warnings: [],
      config: { source: 'env', protocol: 'openai', model: 'fixture-model', tools: true },
      usage: { requests: 3, inputTokens: 100, outputTokens: 50, elapsedMs: 1200 },
      performance: { requestMs: { p50: 100, p95: 200, last: 150 }, memoryRssBytes: 80 * 1024 * 1024 }
    }),
    sessionsDir: join(home, 'sessions'),
    cachePath: join(home, 'stats-cache.json'),
    today: '2026-11-21',
    doctorInput: () => ({
      runtime: { kind: 'development', version: '0.7.0', nodeVersion: 'v22', entryPath: '/cli.js', searchAvailable: false },
      installations: [], configCorrupt: false,
      mcpFailed: [{ name: 'broken', error: '连接超时' }],
      keybindingWarnings: [], envIssues: [], agentParseErrors: [],
      contextWarnings: [{ section: 'Context Usage Warnings', issue: '项目指令过大', fix: '精简 AGENTS.md' }]
    }),
    copyToClipboard: () => true
  }
}

test('RD-01/02/03 端口：statusInput 组装宿主事实（不显权限模式、MCP 计数、视觉未知、凭据来源）', () => {
  const stores = fixtureStores()
  const home = stores.root
  const port = buildDiagnosticsPort({
    runtime: fakeRuntime({ warnings: ['配置文件损坏，已保留备份'] }),
    configStore: stores.configStore,
    getConfig: () => ({ baseUrl: 'https://api.example.com/v1', model: 'm1', source: 'file', protocol: 'anthropic', profileId: 'p1' }),
    mcpStatuses: [{ name: 'a', connected: true }, { name: 'b', connected: false, error: 'boom' }, { name: 'c', connected: false }],
    mcpTools: [],
    version: '0.7.0', cwd: home, home
  })
  const status = port.statusInput()
  assert.equal(status.model, 'm1')
  assert.equal(status.baseUrlHost, 'api.example.com')
  assert.deepEqual(status.mcp, { connected: 1, failed: 1, pending: 1 })
  assert.equal(status.config.protocol, 'anthropic')
  assert.equal(status.config.tools, false)
  assert.equal(status.config.vision, undefined)
  assert.equal(status.credentialSource, 'file')
  assert.equal(status.usage.requests, 3)
  assert.equal(status.performance.requestMs.p95, 200)
  assert.ok(status.warnings.some((w) => w.includes('损坏')))
  assert.ok(port.sessionsDir.endsWith('sessions'))
  assert.ok(port.cachePath.endsWith('stats-cache.json'))
  assert.equal(port.today, new Date().toISOString().slice(0, 10))
})

test('RD-09/10/11 端口：doctorInput 损坏配置/MCP 失败/代理警告/上下文警告', () => {
  const stores = fixtureStores()
  const home = stores.root
  const port = buildDiagnosticsPort({
    runtime: fakeRuntime({ warnings: ['配置文件损坏'] }),
    configStore: stores.configStore,
    getConfig: () => ({ baseUrl: 'https://api.example.com/v1', model: 'm1', source: 'file' }),
    mcpStatuses: [{ name: 'broken', connected: false, error: '连接超时' }],
    mcpTools: [],
    version: '0.7.0', cwd: home, home
  })
  const doctor = port.doctorInput()
  assert.equal(doctor.configCorrupt, true)
  assert.deepEqual(doctor.mcpFailed, [{ name: 'broken', error: '连接超时' }])
  assert.equal(doctor.runtime.version, '0.7.0')
  assert.equal(typeof doctor.runtime.searchAvailable, 'boolean')
  assert.ok(Array.isArray(doctor.agentParseErrors))
  assert.ok(Array.isArray(doctor.contextWarnings))
  assert.equal(typeof port.copyToClipboard, 'function')
})

test('RD-01 /status：交互→openStatus＋文本字段；无头→仅文本无 openStatus', async () => {
  const home = mkdtempSync(join(tmpdir(), 'sp007-diag-'))
  const interactive = await statusCommand.run('', { interactive: true, lang: 'zh', diagnostics: fakePort(home) })
  assert.equal(interactive.outcome.openStatus, true)
  assert.ok(interactive.value.includes('Version'))
  assert.ok(interactive.value.includes('fixture-model'))
  const headless = await statusCommand.run('', { interactive: false, lang: 'zh', diagnostics: fakePort(home) })
  assert.equal(headless.outcome.openStatus, undefined)
  assert.ok(headless.value.includes('Version'))
  const noPort = await statusCommand.run('', { interactive: true, lang: 'zh' })
  assert.ok(noPort.value.includes('诊断数据不可用'))
})

test('RD-04 /stats 与 RD-09 /doctor：交互开面板；命令注册补全', async () => {
  const home = mkdtempSync(join(tmpdir(), 'sp007-diag-'))
  const stats = await statsCommand.run('', { interactive: true, lang: 'zh', diagnostics: fakePort(home) })
  assert.equal(stats.outcome.openStats, true)
  const doctor = await doctorCommand.run('', { interactive: true, lang: 'zh', diagnostics: fakePort(home) })
  assert.equal(doctor.outcome.openDoctor, true)
  assert.ok(doctor.value.includes('Diagnostics'))
  const registry = createCommandRegistry()
  registerBuiltinCommands(registry)
  for (const name of ['status', 'stats', 'doctor']) {
    assert.ok(registry.get(name), '缺命令 ' + name)
    assert.equal(registry.get(name).supportsNonInteractive, undefined)
  }
})

test('RD-01/02/03 功能：/status 真实 Ink 三页签＋Esc 关闭汇总', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'sp007-status-tty-'))
  const tty = await mountTty(t, {
    provider: { async *stream() {} },
    commandOverrides: { interactive: true, cwd: home, home, lang: 'zh', diagnostics: fakePort(home) }
  })
  await tty.send('/status\r')
  await tty.waitFor((f) => f.includes('Status') && f.includes('Version') && f.includes('sess-1'))
  assert.ok(tty.last().includes('fixture-model'))
  // Tab → Config 页签
  await tty.send('\t')
  await tty.waitFor((f) => f.includes('协议') && f.includes('来源优先级'))
  // Tab → Usage 页签（p50/p95/RSS）
  await tty.send('\t')
  await tty.waitFor((f) => f.includes('请求 p50/p95') && f.includes('进程 RSS'))
  // Esc 关闭 → hint
  await tty.send('\x1b')
  await tty.waitFor((f) => f.includes('Status 面板已关闭'))
})

test('RD-04/05/06/07 功能：/stats Overview 热力图→r 范围→Tab Models→Esc 关闭', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'sp007-stats-tty-'))
  const tty = await mountTty(t, {
    provider: { async *stream() {} },
    commandOverrides: { interactive: true, cwd: home, home, lang: 'zh', diagnostics: fakePort(home) }
  })
  await tty.send('/stats\r')
  await tty.waitFor((f) => f.includes('Overview') && f.includes('总 token'))
  // r 循环范围 all→7d
  await tty.send('r')
  await tty.waitFor((f) => f.includes('7d'))
  // Tab → Models 页
  await tty.send('\t')
  await tty.waitFor((f) => f.includes('Models'))
  // Esc 关闭
  await tty.send('\x1b')
  await tty.waitFor((f) => f.includes('Stats 面板已关闭'))
})

test('RD-09/10/11 功能：/doctor 警告式分区 Warning/Fix＋Esc 关闭', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'sp007-doctor-tty-'))
  const tty = await mountTty(t, {
    provider: { async *stream() {} },
    commandOverrides: { interactive: true, cwd: home, home, lang: 'zh', diagnostics: fakePort(home) }
  })
  await tty.send('/doctor\r')
  await tty.waitFor((f) => f.includes('Diagnostics') && f.includes('运行类型'))
  assert.ok(tty.last().includes('Warning: MCP 服务器 broken 连接失败'))
  assert.ok(tty.last().includes('Fix:'))
  assert.ok(tty.last().includes('项目指令过大'))
  await tty.send('\x1b')
  await tty.waitFor((f) => f.includes('budingx 诊断已关闭'))
})
