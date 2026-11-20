import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  loadProjectInstructions,
  loadProjectInstructionsSync,
  PROJECT_INSTRUCTION_FILE_LIMIT,
  PROJECT_INSTRUCTION_TOTAL_LIMIT
} from '../dist/tui/project-instructions.js'

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), 'budingx-pi-'))
  return { root, home: join(root, 'home'), workspace: join(root, 'work', 'app') }
}

test('PI-01 工作区根 AGENTS.md 被发现并记录来源与注入内容', async () => {
  const { root, home, workspace } = await sandbox()
  await mkdir(home, { recursive: true })
  await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, 'AGENTS.md'), '# 约定\n只改授权范围。\n')
  const result = await loadProjectInstructions({ workspaceDir: workspace, homeDir: home })
  assert.equal(result.files.length, 1)
  assert.equal(result.sources[0].path, join(workspace, 'AGENTS.md'))
  assert.ok(result.content.includes('source="AGENTS.md"'))
  assert.ok(result.content.includes('只改授权范围。'))
  assert.deepEqual(result.warnings, [])
  await rm(root, { recursive: true, force: true })
})

test('PI-01 优先级：用户级 → 工作区 AGENTS → 工作区 CLAUDE，更具体者靠后', async () => {
  const { root, home, workspace } = await sandbox()
  await mkdir(join(home, '.budingx'), { recursive: true })
  await mkdir(workspace, { recursive: true })
  await writeFile(join(home, 'AGENTS.md'), 'USER-LEVEL-RULE')
  await writeFile(join(workspace, 'AGENTS.md'), 'WORKSPACE-AGENTS')
  await writeFile(join(workspace, 'CLAUDE.md'), 'WORKSPACE-CLAUDE')
  const result = await loadProjectInstructions({ workspaceDir: workspace, homeDir: home })
  assert.equal(result.files.length, 3)
  const indexUser = result.content.indexOf('USER-LEVEL-RULE')
  const indexAgents = result.content.indexOf('WORKSPACE-AGENTS')
  const indexClaude = result.content.indexOf('WORKSPACE-CLAUDE')
  assert.ok(indexUser >= 0 && indexUser < indexAgents && indexAgents < indexClaude)
  await rm(root, { recursive: true, force: true })
})

test('PI-02 受限向上发现：父目录指令被发现，超过层数上限不再向上', async () => {
  const { root, home, workspace } = await sandbox()
  await mkdir(home, { recursive: true })
  const parent = join(root, 'work')
  await mkdir(workspace, { recursive: true })
  await writeFile(join(parent, 'AGENTS.md'), 'PARENT-RULE')
  const one = await loadProjectInstructions({ workspaceDir: workspace, homeDir: home })
  assert.ok(one.content.includes('PARENT-RULE'))
  // 上限 0 层：只看工作区根。
  const none = await loadProjectInstructions({
    workspaceDir: workspace,
    homeDir: home,
    maxAncestorLevels: 0
  })
  assert.ok(!none.content.includes('PARENT-RULE'))
  // 更远的祖先（root 本身）在默认 3 层内被发现。
  await writeFile(join(root, 'AGENTS.md'), 'GRAND-RULE')
  const defaultDepth = await loadProjectInstructions({ workspaceDir: workspace, homeDir: home })
  assert.ok(defaultDepth.content.includes('GRAND-RULE'))
  await rm(root, { recursive: true, force: true })
})

test('PI-02 不越过用户主目录，也不读取 ~/.claude', async () => {
  const { root, home, workspace } = await sandbox()
  await mkdir(join(home, '.claude'), { recursive: true })
  await writeFile(join(home, '.claude', 'AGENTS.md'), 'CLAUDE-HOME-RULE')
  await mkdir(workspace, { recursive: true })
  const result = await loadProjectInstructions({ workspaceDir: workspace, homeDir: home })
  assert.ok(!result.content.includes('CLAUDE-HOME-RULE'))
  assert.equal(result.files.length, 0)
  await rm(root, { recursive: true, force: true })
})

test('PI-03 不同工作区互不串扰；同步版与异步版结果一致', async () => {
  const { root, home, workspace } = await sandbox()
  await mkdir(home, { recursive: true })
  const other = join(root, 'other')
  await mkdir(workspace, { recursive: true })
  await mkdir(other, { recursive: true })
  await writeFile(join(workspace, 'AGENTS.md'), 'APP-RULE')
  await writeFile(join(other, 'AGENTS.md'), 'OTHER-RULE')
  const a = await loadProjectInstructions({ workspaceDir: workspace, homeDir: home })
  const b = await loadProjectInstructions({ workspaceDir: other, homeDir: home })
  assert.ok(a.content.includes('APP-RULE') && !a.content.includes('OTHER-RULE'))
  assert.ok(b.content.includes('OTHER-RULE') && !b.content.includes('APP-RULE'))
  const sync = loadProjectInstructionsSync({ workspaceDir: workspace, homeDir: home })
  assert.equal(sync.content, a.content)
  await rm(root, { recursive: true, force: true })
})

test('PI-04 单文件超过 64 KiB 截断并显式标注', async () => {
  const { root, home, workspace } = await sandbox()
  await mkdir(home, { recursive: true })
  await mkdir(workspace, { recursive: true })
  const body = 'x'.repeat(PROJECT_INSTRUCTION_FILE_LIMIT + 1024)
  await writeFile(join(workspace, 'AGENTS.md'), body)
  const result = await loadProjectInstructions({ workspaceDir: workspace, homeDir: home })
  assert.equal(result.sources[0].truncated, true)
  assert.ok(result.warnings.some((line) => line.includes('64 KiB')))
  assert.ok(Buffer.byteLength(result.content, 'utf8') < PROJECT_INSTRUCTION_FILE_LIMIT + 512)
  await rm(root, { recursive: true, force: true })
})

test('PI-04 总量超过 128 KiB 时截断并标注', async () => {
  const { root, home, workspace } = await sandbox()
  await mkdir(home, { recursive: true })
  await mkdir(workspace, { recursive: true })
  await writeFile(join(home, 'AGENTS.md'), 'u'.repeat(PROJECT_INSTRUCTION_FILE_LIMIT - 128))
  await writeFile(join(workspace, 'AGENTS.md'), 'w'.repeat(PROJECT_INSTRUCTION_FILE_LIMIT - 128))
  await writeFile(join(workspace, 'CLAUDE.md'), 'c'.repeat(PROJECT_INSTRUCTION_FILE_LIMIT - 128))
  const result = await loadProjectInstructions({ workspaceDir: workspace, homeDir: home })
  assert.ok(result.warnings.some((line) => line.includes('128 KiB')))
  assert.ok(Buffer.byteLength(result.content, 'utf8') <= PROJECT_INSTRUCTION_TOTAL_LIMIT)
  await rm(root, { recursive: true, force: true })
})

test('PI-01 无指令文件时返回空内容且不产生告警', async () => {
  const { root, home, workspace } = await sandbox()
  await mkdir(home, { recursive: true })
  await mkdir(workspace, { recursive: true })
  const result = await loadProjectInstructions({ workspaceDir: workspace, homeDir: home })
  assert.deepEqual(result.files, [])
  assert.equal(result.content, '')
  assert.deepEqual(result.warnings, [])
  await rm(root, { recursive: true, force: true })
})

import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { ConfigStore } from '../dist/storage/config-store.js'
import { createProfile } from '../dist/storage/profiles.js'
import { createAgentRuntime } from '../dist/tui/runtime.js'

test('PI-01 真实进程：项目指令进入系统上下文且位于用户消息之前，用户原文不改写', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-pi-run-'))
  const cwd = join(home, 'workspace')
  mkdirSync(cwd, { recursive: true })
  writeFileSync(join(cwd, 'AGENTS.md'), 'PROJECT-RULE-ONLY')
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const requests = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push(JSON.parse(body))
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1'
  const profile = createProfile({ label: 'pi', baseUrl, model: 'fixture', tools: false })
  const configStore = new ConfigStore(join(home, 'config.json'))
  configStore.save({ version: 1, models: [profile], defaultModelId: profile.id })
  const runtime = createAgentRuntime({
    cwd,
    home,
    configStore,
    mode: 'read_only',
    getConfig: () => ({
      profileId: profile.id,
      baseUrl,
      model: 'fixture',
      apiKey: '',
      timeoutMs: 5000,
      source: 'file'
    }),
    approval: { request: async () => ({ outcome: 'deny', via: 'policy' }) }
  })
  t.after(() => runtime.session.dispose())
  const done = new Promise((resolve) => {
    const off = runtime.session.on((event) => {
      if (event.type === 'turn_finalized') {
        off()
        resolve(event)
      }
    })
  })
  runtime.session.submit('保留我的原文')
  assert.equal((await done).outcome, 'completed')
  const messages = requests[0].messages
  assert.equal(messages[0].role, 'system')
  assert.ok(messages[0].content.includes('PROJECT-RULE-ONLY'))
  const userIndex = messages.findIndex((message) => message.role === 'user')
  assert.equal(userIndex, 1)
  assert.ok(JSON.stringify(messages[userIndex]).includes('保留我的原文'))
})

