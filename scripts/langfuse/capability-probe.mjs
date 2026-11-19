// SP004 agent-observability：综合能力探针（live）。
// 用与 TUI 相同的生产装配 createAgentRuntime，在隔离工作区跑「定位→修改→运行测试→修复」
// 闭环，启用 Langfuse 追踪，输出能力评估与 trace 关联。消耗真实模型额度（需授权）。
//
// 运行：node --env-file-if-exists=.env.e2e.local scripts/langfuse/capability-probe.mjs
// 纯函数 createBugFixture / summarizeEvents 导出供测试；main 仅在直接执行时运行。

import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAgentRuntime } from '../../src/tui/dist/tui/runtime.js'
import { createHostSandboxFromEnvironment } from '../../src/tui/dist/exec/host-sandbox.js'
import {
  mergeSources,
  startupProfile,
  profileCredentialRef,
  profileCredentialBinding
} from '../../src/tui/dist/storage/profiles.js'
import { ConfigStore } from '../../src/tui/dist/storage/config-store.js'
import { CredentialStore } from '../../src/tui/dist/storage/credentials.js'

/** 在隔离目录写入「bug 模块 + 失败测试」fixture。返回文件路径。 */
export function createBugFixture(dir) {
  const mathPath = path.join(dir, 'math.js')
  const testPath = path.join(dir, 'test.mjs')
  writeFileSync(mathPath, 'export function add(a, b) {\n  return a - b\n}\n')
  writeFileSync(
    testPath,
    "import assert from 'node:assert/strict'\nimport { test } from 'node:test'\nimport { add } from './math.js'\ntest('add returns the sum', () => {\n  assert.equal(add(2, 3), 5)\n})\n"
  )
  return { mathPath, testPath }
}

/** 从事件流提炼能力摘要（纯函数）。 */
export function summarizeEvents(events) {
  const tools = events.filter((e) => e.type === 'tool_call_completed').map((e) => e.name)
  const edits = events.filter((e) => e.type === 'change_set').flatMap((e) => e.changes.map((c) => c.path))
  const commands = events.filter((e) => e.type === 'command_finished')
  const finalized = events.find((e) => e.type === 'turn_finalized')
  const answer = events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('')
  const toolCounts = {}
  for (const name of tools) toolCounts[name] = (toolCounts[name] ?? 0) + 1
  return {
    toolCounts,
    toolTotal: tools.length,
    editedFiles: [...new Set(edits)],
    commandOutcomes: commands.map((c) => c.outcome),
    commandSucceeded: commands.some((c) => c.outcome === 'completed'),
    outcome: finalized?.outcome ?? 'unknown',
    errorCode: finalized?.error?.code ?? null,
    answer
  }
}

/** 与 TUI cli.ts loadStores 一致地绑定存储 profile，使 capabilities.tools 生效。 */
export function loadRuntimeConfig(env = process.env) {
  const configStore = new ConfigStore()
  const credentialStore = new CredentialStore()
  const stored = configStore.load()
  const profile = startupProfile(stored)
  const file = profile
    ? {
        profileId: profile.id,
        baseUrl: profile.baseUrl,
        model: profile.model,
        apiKey: credentialStore.get(profileCredentialRef(profile), profileCredentialBinding(profile))
      }
    : {}
  const config = mergeSources({ args: [], env, file })
  return { config, configStore, profileTools: profile?.capabilities?.tools ?? false }
}

const TASK =
  'The test in test.mjs fails because of a bug in math.js. Read both files, fix the bug in math.js so add returns the sum, then run `node --test test.mjs` to confirm the test passes. Report the result.'

async function main() {
  const ws = mkdtempSync(path.join(tmpdir(), 'budingx-cap-'))
  const { mathPath } = createBugFixture(ws)
  console.log('workspace:', ws)

  const { config, configStore, profileTools } = loadRuntimeConfig()
  if (!config.model?.trim()) {
    console.error('No model configured; set BUDINGX_MODEL/BASE_URL/API_KEY in .env.e2e.local.')
    process.exitCode = 1
    return
  }
  console.log('model:', config.model, '| profileTools:', profileTools)
  const sandboxBackend = createHostSandboxFromEnvironment()
  console.log('sandboxBackend:', sandboxBackend ? sandboxBackend.id : '(none — commands may be refused)')

  const events = []
  const runtime = createAgentRuntime({
    cwd: ws,
    getConfig: () => config,
    approval: { async request() { return { outcome: 'allow', via: 'user' } } },
    configStore,
    mode: 'workspace_edit',
    sandboxBackend
  })
  for (const w of runtime.warnings) console.log('warning:', w)
  const session = runtime.session
  session.on((e) => {
    events.push(e)
    if (e.type === 'tool_call_completed') console.log('[tool]', e.name)
    if (e.type === 'change_set') console.log('[edit]', e.changes.map((c) => c.path).join(','))
    if (e.type === 'command_finished') console.log('[cmd]', e.outcome)
  })

  const finalized = new Promise((resolve) => session.on((e) => { if (e.type === 'turn_finalized') resolve(e) }))
  const timer = setTimeout(() => { console.log('[probe] timeout, interrupting'); session.interrupt() }, 180000)
  session.submit(TASK)
  await finalized
  clearTimeout(timer)

  const summary = summarizeEvents(events)
  const fixed = readFileSync(mathPath, 'utf8').includes('a + b')
  console.log('=== 能力摘要 ===')
  console.log('turn outcome:', summary.outcome, summary.errorCode ? `(${summary.errorCode})` : '')
  console.log('工具调用:', JSON.stringify(summary.toolCounts))
  console.log('编辑文件:', summary.editedFiles.join(',') || '(无)')
  console.log('命令结果:', summary.commandOutcomes.join(',') || '(无命令执行)')
  console.log('bug 已修复(落盘):', fixed)
  console.log('=== agent 回答(截断) ===\n' + summary.answer.slice(0, 1200))
  console.log('=== 判定 ===')
  console.log('定位+编辑:', fixed ? 'PASS' : 'FAIL')
  console.log('运行测试:', summary.commandSucceeded ? 'PASS' : 'BLOCKED/FAIL（本机可能无已验证执行隔离后端）')
  await runtime.shutdownTracing?.()
  session.dispose()
  process.exitCode = summary.outcome === 'completed' ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
