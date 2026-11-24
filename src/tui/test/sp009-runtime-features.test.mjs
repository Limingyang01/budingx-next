import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SessionStore } from '../dist/storage/session-store.js'
import { ConfigStore } from '../dist/storage/config-store.js'
import { createProfile } from '../dist/storage/profiles.js'
import { BUILT_IN_AGENTS } from '../dist/core/agent-definitions.js'
import { createMcpElicitation } from '../dist/tui/mcp/elicitation.js'
import { createAgentRuntime, workspacePromptOptions } from '../dist/tui/runtime.js'
import { runCommand } from '../dist/tui/commands.js'
import { mountTty } from './helpers/mount-tty.mjs'

function tool(name, input) {
  return { tool: name, input }
}

async function fixture(t, { id = 'fixture-session', mode = 'full_access', git = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'budingx-092-runtime-'))
  const cwd = join(home, 'repo')
  mkdirSync(cwd)
  writeFileSync(join(cwd, 'same.txt'), 'original contents')
  if (git) {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd })
    execFileSync('git', ['add', '--', 'same.txt'], { cwd })
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture'], { cwd })
  }
  const replies = []
  const requests = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const part of req) chunks.push(part)
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    const step = replies.shift()
    if (step === 'hang') return
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const choice = step?.tool
      ? {
          delta: { tool_calls: [{
            index: 0, id: 'tool-' + requests.length, type: 'function',
            function: { name: step.tool, arguments: JSON.stringify(step.input) }
          }] },
          finish_reason: 'tool_calls'
        }
      : { delta: { content: 'fixture completed' }, finish_reason: 'stop' }
    res.end(`data: ${JSON.stringify({ choices: [choice] })}\n\ndata: [DONE]\n\n`)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  const configStore = new ConfigStore(join(home, 'config.json'))
  const profile = createProfile({ label: 'fixture', baseUrl, model: 'fixture', tools: true })
  configStore.save({ version: 1, models: [profile], defaultModelId: profile.id })
  const config = {
    profileId: profile.id, baseUrl, model: 'fixture', apiKey: 'fixture-auth-not-real',
    timeoutMs: 5000, source: 'file'
  }
  const open = (sessionId) => createAgentRuntime({
    cwd, home, sessionId, configStore, getConfig: () => config, mode, persistence: true,
    approval: { request: async () => ({ outcome: 'allow', via: 'user' }) }
  })
  const runtime = open(id)
  t.after(() => {
    runtime.session.dispose()
    server.closeAllConnections()
    server.close()
  })
  return { home, cwd, runtime, open, replies, requests, config }
}

async function turn(runtime, text, options) {
  const events = []
  const ended = new Promise((resolve) => {
    const off = runtime.session.on((event) => {
      events.push(event)
      if (event.type === 'turn_finalized') {
        off()
        resolve(event)
      }
    })
  })
  runtime.session.submit(text, options)
  assert.equal((await ended).outcome, 'completed')
  return events.filter((event) => event.type === 'tool_result')
}

test('AC-SKILL-01…03 Skill 运行时目录、隐藏资源与回合工具限制', async (t) => {
  const { home, cwd, runtime, replies, requests, config } = await fixture(t)
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const directory = join(cwd, '.budingx', 'skills', 'restricted')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), '---\nname: restricted\ndescription: Fixture restriction\nallowed-tools: Read\n---\n@./notes.md\n')
  writeFileSync(join(directory, 'notes.md'), 'INTERNAL-FIXTURE-SKILL-TEXT')
  runtime.skillCatalog.reload()

  replies.push(tool('Skill', { name: 'restricted' }), tool('Write', { path: 'denied.txt', content: 'denied' }),
    tool('Read', { path: 'same.txt' }), null)
  const results = await turn(runtime, 'activate the model skill')
  assert.match(requests[0].messages[0].content, /restricted: Fixture restriction/)
  assert.match(JSON.stringify(requests[1].messages), /INTERNAL-FIXTURE-SKILL-TEXT/)
  assert.deepEqual(requests[1].tools.map((entry) => entry.function.name), ['Read'])
  assert.match(results[0].content, /activated/)
  assert.doesNotMatch(JSON.stringify(results), /INTERNAL-FIXTURE-SKILL-TEXT/)
  assert.match(results[1].content, /allowed-tools scope/)
  assert.equal(results[2].isError, false)
  assert.equal(existsSync(join(cwd, 'denied.txt')), false)
  replies.push(tool('Write', { path: 'next.txt', content: 'after scope' }), null)
  assert.equal((await turn(runtime, 'normal turn'))[0].isError, false)
  assert.equal(existsSync(join(cwd, 'next.txt')), true)

  writeFileSync(join(directory, 'SKILL.md'), '---\nname: restricted\ndescription: Manual only\nallowed-tools: Write\ndisable-model-invocation: true\n---\n@./notes.md\n')
  runtime.skillCatalog.reload()
  const manual = await runCommand('/restricted', { session: runtime.session, skillCatalog: runtime.skillCatalog, getConfig: () => config })
  assert.deepEqual(manual.skillPrompt.allowedTools, ['Write'])
  runtime.setPermissionMode('read_only')
  replies.push(tool('Write', { path: 'denied-by-policy.txt', content: 'denied' }), null)
  const denied = await turn(runtime, '/restricted', {
    context: [{ source: 'skill:restricted', content: manual.skillPrompt.body }],
    allowedSkillTools: manual.skillPrompt.allowedTools
  })
  assert.equal(denied[0].isError, true)
  assert.doesNotMatch(denied[0].content, /allowed-tools/)
  assert.equal(existsSync(join(cwd, 'denied-by-policy.txt')), false)
})

test('AC-RULES-01 局部规则在相关工具之前交回模型，兄弟目录隔离且变更可刷新', async (t) => {
  const { home, cwd, runtime, replies, requests } = await fixture(t, { mode: 'read_only' })
  t.after(() => rmSync(home, { recursive: true, force: true }))
  writeFileSync(join(cwd, 'AGENTS.md'), 'Root project rule\n@./base.md')
  writeFileSync(join(cwd, 'base.md'), 'Imported base rule')
  for (const [directory, content] of [['alpha', 'ALPHA-RULE'], ['beta', 'BETA-RULE']]) {
    mkdirSync(join(cwd, directory))
    writeFileSync(join(cwd, directory, 'AGENTS.md'), content)
    writeFileSync(join(cwd, directory, 'file.txt'), directory + ' contents')
  }
  replies.push(tool('Read', { path: 'alpha/file.txt' }), tool('Read', { path: 'alpha/file.txt' }), null)
  const first = await turn(runtime, 'read alpha')
  assert.match(requests[0].messages[0].content, /Imported base rule/)
  assert.doesNotMatch(requests[0].messages[0].content, /ALPHA-RULE|BETA-RULE/)
  assert.match(first[0].content, /ALPHA-RULE/)
  assert.doesNotMatch(first[0].content, /BETA-RULE/)
  assert.match(first[1].content, /alpha contents/)
  writeFileSync(join(cwd, 'beta', 'AGENTS.md'), 'UPDATED-BETA-RULE')
  replies.push(tool('Read', { path: 'beta/file.txt' }), tool('Read', { path: 'beta/file.txt' }), null)
  const second = await turn(runtime, 'read beta')
  assert.match(second[0].content, /UPDATED-BETA-RULE/)
  assert.doesNotMatch(second[0].content, /ALPHA-RULE/)
  assert.match(second[1].content, /beta contents/)
})

test('规则和技能资源无法把 Read 已禁止的内容放进模型上下文', async (t) => {
  const { home, cwd, runtime, requests } = await fixture(t)
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const dir = join(cwd, '.budingx', 'skills', 'guarded')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: guarded\ndescription: Guarded skill\n---\n@./restricted.md')
  writeFileSync(join(dir, 'restricted.md'), 'PRIVATE-FIXTURE-SKILL')
  writeFileSync(join(cwd, 'restricted.md'), 'PRIVATE-FIXTURE-RULE')
  writeFileSync(join(cwd, 'AGENTS.md'), 'Global rule\n@./restricted.md')
  runtime.policy.setRules([
    { id: 'rule-fixture', tool: 'Read', action: 'deny', path: 'restricted.md' },
    { id: 'skill-fixture', tool: 'Read', action: 'deny', path: '.budingx/skills/guarded/restricted.md' }
  ])
  const result = await runCommand('/guarded', { session: runtime.session, skillCatalog: runtime.skillCatalog })
  assert.match(result.error, /读取权限拒绝/)
  await turn(runtime, 'read project instructions')
  assert.doesNotMatch(JSON.stringify(requests[0].messages), /PRIVATE-FIXTURE/)
  assert.ok(runtime.warnings.some((message) => message.includes('RULES_IMPORT_DENIED')))
})

test('派生会话不接管临时批准、原会话后台结果或附件缓存', async (t) => {
  const { home, runtime, replies } = await fixture(t, { mode: 'workspace_edit' })
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const network = { tool: 'WebFetch', capability: 'network' }
  runtime.policy.remember(network)
  assert.equal(runtime.policy.decide(network).action, 'allow')
  const originalImage = runtime.imageCache.put(7, 'image/png', Buffer.from('fixture-original'))
  assert.equal(runtime.imageCache.nextId(), 8)
  replies.push(null)
  const child = await runtime.agents.spawn({
    definition: BUILT_IN_AGENTS[0], description: 'branch ownership fixture', prompt: 'finish',
    callId: 'prior-agent', turnId: 'test'
  })
  assert.equal(child.status, 'completed')
  const branch = runtime.sessions.fork()
  assert.equal(branch.ok, true)
  assert.equal(runtime.policy.decide(network).action, 'ask')
  assert.equal(runtime.agents.get(child.agentId), undefined)
  await assert.rejects(() => runtime.agents.taskOutput(child.agentId), /Unknown agent id/)
  const newImage = runtime.imageCache.put(1, 'image/png', Buffer.from('fixture-branch'))
  assert.notEqual(newImage.path, originalImage.path)
  assert.match(newImage.path, new RegExp(branch.sessionId))
  assert.equal(existsSync(originalImage.path), true)
})

test('AC-WORKTREE-01/02 TUI 切换工作树后文件和 Shell 使用同一目录，重启恢复绑定', async (t) => {
  const { home, cwd, runtime, open, replies, config } = await fixture(t, { git: true })
  const origin = realpathSync.native(cwd)
  assert.equal(runtime.workspace.root, origin)
  const ui = await mountTty(t, {
    strategy: 'ascii', columns: 64, sessionFactory: () => runtime.session, config,
    commandOverrides: {
      home, cwd, worktree: runtime.worktree, sessions: runtime.sessions,
      permission: {
        policy: runtime.policy, workspace: runtime.workspace, store: runtime.permissionStore,
        checkpointChanges: () => runtime.checkpoint.changes(), undo: () => ({ undone: false }),
        denials: () => [], modes: { order: [], zh: {}, en: {} }
      }
    }
  })
  t.after(() => rmSync(home, { recursive: true, force: true }))
  await ui.send('/worktree create feature-box\r')
  await ui.waitFor((frame) => frame.includes('Created worktree:') && frame.includes('feature-box'), 7000)
  await ui.send('/worktree enter feature-box\r')
  await ui.waitFor(() => runtime.workspace.root !== origin, 7000)
  const active = runtime.workspace.root
  const shell = process.platform === 'win32' ? 'PowerShell' : 'Bash'
  writeFileSync(join(active, 'same.txt'), 'isolated contents')
  replies.push(tool('Read', { path: 'same.txt' }), tool(shell, { command: process.platform === 'win32' ? '(Get-Location).ProviderPath' : 'pwd' }), null)
  const result = await turn(runtime, 'read worktree')
  assert.match(result[0].content, /isolated contents/)
  assert.match(result[1].content, /feature-box/)
  const refs = workspacePromptOptions('@same.txt', runtime.workspace, runtime.policy).resolveContext()
  assert.match(JSON.stringify(refs), /isolated contents/)
  await ui.send('/branch\r')
  await ui.waitFor(() => runtime.session.id !== 'fixture-session', 7000)
  assert.equal(runtime.workspace.root, origin)

  const reopened = open('fixture-session')
  try {
    assert.equal(reopened.sessions.resume('fixture-session').ok, true)
    assert.equal(reopened.workspace.root, active)
    await reopened.worktree.exit()
    assert.equal(reopened.workspace.root, origin)
    const saved = new SessionStore({ home, workspaceRoot: cwd }).restore('fixture-session')
    assert.equal(saved.worktree, undefined)
    assert.equal(saved.worktreeOriginBranch, 'main')
  } finally {
    reopened.session.dispose()
  }
})

async function waitFor(predicate) {
  const limit = Date.now() + 8000
  while (Date.now() < limit) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail('Timed out waiting for the task state')
}

test('AC-TASKS-01/02 运行时查询并终止真实后台 Shell 及子代理', async (t) => {
  const { home, runtime, replies, requests } = await fixture(t)
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const shell = process.platform === 'win32' ? 'PowerShell' : 'Bash'
  const command = (process.platform === 'win32' ? '& ' : '') +
    `'${process.execPath}' -e 'console.log("fixture log"); setInterval(() => {}, 1000)'`
  replies.push(tool(shell, { command, run_in_background: true }), null)
  assert.equal((await turn(runtime, 'start fixture shell'))[0].isError, false)
  const task = runtime.taskPanel.list().find((row) => row.kind === 'shell')
  assert.equal(task.status, 'running')

  replies.push('hang')
  const started = await runtime.agents.spawn({
    definition: BUILT_IN_AGENTS[0], description: 'cancellable fixture', prompt: 'wait',
    callId: 'agent-fixture', turnId: 'test', runInBackground: true
  })
  assert.equal(started.status, 'async_launched')
  await waitFor(() => requests.length === 3)
  const child = runtime.taskPanel.list().find((row) => row.id === started.agentId)
  assert.equal(child.kind, 'agent')
  assert.equal(runtime.taskPanel.stop({ ...task, id: started.agentId }).result, 'unavailable')
  assert.equal(runtime.taskPanel.stop(task).result, 'requested')
  assert.equal(runtime.taskPanel.stop(child).result, 'requested')
  await waitFor(() => runtime.taskPanel.list().filter((row) => row.status === 'cancelled').length === 2)
  assert.equal(runtime.taskPanel.stop(task).result, 'already-finished')
  assert.equal(runtime.taskPanel.stop(child).result, 'already-finished')
  await turn(runtime, 'parent still works')
})

test('AC-MCP-03 Ink 交互请求支持同意、取消与超时', async (t) => {
  const elicitation = createMcpElicitation()
  const ui = await mountTty(t, { strategy: 'ascii', commandOverrides: { mcpElicitation: elicitation } })
  const ask = (signal = new AbortController().signal) => elicitation.request({
    server: 'loopback', message: 'Confirm fixture request', signal
  })
  const accepted = ask()
  await ui.waitFor((frame) => frame.includes('Confirm fixture request'))
  await ui.send('y')
  assert.equal(await accepted, 'accept')
  const declined = ask()
  await ui.waitFor((frame) => frame.includes('Confirm fixture request'))
  await ui.send('n')
  assert.equal(await declined, 'decline')
  const cancelled = ask()
  await ui.waitFor((frame) => frame.includes('Confirm fixture request'))
  await ui.send('\x1b')
  assert.equal(await cancelled, 'cancel')
  const timed = ask(AbortSignal.timeout(800))
  await ui.waitFor((frame) => frame.includes('Confirm fixture request'))
  await ui.waitFor((frame) => !frame.includes('Confirm fixture request'))
  assert.equal(await timed, 'cancel')
})
