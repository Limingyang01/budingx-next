// SP006 CMD-05…CMD-11：新增命令面（/init /btw /worktree /tasks /mcp /skills /export）。
// 真实副作用：真实 git 仓库、真实子进程、真实导出文件、真实旁路模型请求。
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { getDefaultRegistry } from '../dist/tui/commands/index.js'
import { runCommand } from '../dist/tui/commands.js'
import { createTaskRegistry, trackCommandTask } from '../dist/tui/tasks.js'
import { ConfigStore } from '../dist/storage/config-store.js'
import { createProfile } from '../dist/storage/profiles.js'
import { createAgentRuntime } from '../dist/tui/runtime.js'

function baseCtx(extra = {}) {
  return {
    lang: 'zh',
    interactive: false,
    session: { id: 'sess-1', history: [] },
    exit() {},
    getConfig: () => ({ model: 'm', baseUrl: 'b', apiKey: 'k', timeoutMs: 1, source: 'file' }),
    setConfig() {},
    configStore: { load: () => ({ models: [] }) },
    ...extra
  }
}

function tempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('CMD-05…CMD-11 七条命令按设计三型注册且可直接解析', () => {
  const registry = getDefaultRegistry()
  const expected = {
    init: 'prompt',
    btw: 'prompt',
    worktree: 'local',
    tasks: 'local',
    mcp: 'local-jsx',
    skills: 'local-jsx',
    export: 'local'
  }
  for (const [name, kind] of Object.entries(expected)) {
    const definition = registry.get(name)
    assert.ok(definition, 'missing /' + name)
    assert.equal(definition.kind, kind, '/' + name + ' kind')
    assert.ok(definition.summary.length > 0)
    assert.equal(registry.resolve('/' + name).definition.name, name)
  }
})

test('CMD-05 /init：生成模板但不写文件，既有 AGENTS.md 拒绝覆盖', async (t) => {
  const cwd = tempDir(t, 'budingx-init-')
  const first = await runCommand('/init', baseCtx({ cwd }))
  assert.equal(first.handled, true)
  assert.match(first.prompt.text, /AGENTS\.md/)
  assert.match(first.prompt.text, /# 项目说明/)
  assert.match(first.prompt.progress, /正在生成项目指令/)
  assert.equal(existsSync(join(cwd, 'AGENTS.md')), false, '/init 自身不写文件')
  writeFileSync(join(cwd, 'AGENTS.md'), '# existing\n')
  const second = await runCommand('/init', baseCtx({ cwd }))
  assert.match(second.message, /项目指令已存在，不会覆盖/)
  assert.equal(readFileSync(join(cwd, 'AGENTS.md'), 'utf8'), '# existing\n')
})

test('CMD-06 /btw：空问题给用法，有内容进入旁路提问通道', async () => {
  const empty = await runCommand('/btw', baseCtx())
  assert.match(empty.message, /用法：\/btw/)
  const asked = await runCommand('/btw 总结一下这个仓库', baseCtx())
  assert.equal(asked.handled, true)
  assert.equal(asked.sideQuestion, '总结一下这个仓库')
})

test('CMD-06 旁路提问真实请求模型但不写入主会话历史', async (t) => {
  const home = tempDir(t, 'budingx-btw-')
  const requests = []
  let reply = 'main-reply'
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push(JSON.parse(body))
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: reply } }] }) + '\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1'
  const profile = createProfile({ label: 'btw', baseUrl, model: 'fixture', tools: false })
  const configStore = new ConfigStore(join(home, 'config.json'))
  configStore.save({ version: 1, models: [profile], defaultModelId: profile.id })
  const runtime = createAgentRuntime({
    cwd: home,
    home,
    configStore,
    mode: 'read_only',
    persistence: true,
    getConfig: () => ({ profileId: profile.id, baseUrl, model: 'fixture', apiKey: '', timeoutMs: 5000, source: 'file' }),
    approval: { request: async () => ({ outcome: 'deny', via: 'policy' }) }
  })
  t.after(() => runtime.session.dispose())
  const events = []
  runtime.session.on((event) => events.push(event))
  const done = new Promise((resolve) => {
    const off = runtime.session.on((event) => {
      if (event.type === 'turn_finalized') { off(); resolve(event) }
    })
  })
  runtime.session.submit('主会话问题')
  assert.equal((await done).outcome, 'completed')
  assert.equal(runtime.session.history.length, 2)
  const eventCount = events.length
  reply = 'side-answer'
  const answer = await runtime.session.submitSideQuestion('旁路问题')
  assert.equal(answer.ok, true, answer.error)
  assert.equal(answer.text, 'side-answer')
  assert.equal(runtime.session.history.length, 2, '旁路问答不写入历史')
  assert.equal(events.length, eventCount, '旁路问答不发会话事件')
  assert.equal(requests.length, 2)
  assert.match(JSON.stringify(requests[1].messages), /旁路问答/)
  assert.ok(JSON.stringify(requests[1].messages).includes('旁路问题'))

  const original = runtime.session.id
  const branch = runtime.sessions.fork(original, { question: '旁路问题', answer: 'side-answer' })
  assert.equal(branch.ok, true, branch.message)
  assert.notEqual(branch.sessionId, original)
  assert.equal(runtime.session.id, branch.sessionId)
  assert.equal(runtime.session.history.length, 4)
  assert.match(JSON.stringify(runtime.session.history.slice(-2)), /旁路问题.*side-answer/)
  const restored = runtime.sessions.resume(original)
  assert.equal(restored.ok, true, restored.message)
  assert.equal(runtime.session.history.length, 2)
  assert.doesNotMatch(JSON.stringify(runtime.session.history), /旁路问题|side-answer/)
})

test('CMD-07 /worktree：列出、创建、删除需确认并留预览（真实 git）', async (t) => {
  const root = tempDir(t, 'budingx-wt-')
  const repo = join(root, 'repo')
  const home = join(root, 'home')
  mkdirSync(repo, { recursive: true })
  mkdirSync(home, { recursive: true })
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
  git('init', '-b', 'master')
  git('config', 'user.email', 'test@example.test')
  git('config', 'user.name', 'Test')
  writeFileSync(join(repo, 'README.md'), '# repo\n')
  git('add', 'README.md')
  git('commit', '-m', 'init')
  const listed = await runCommand('/worktree list', baseCtx({ cwd: repo, home }))
  assert.match(listed.message, /共 1 个 worktree/)
  assert.match(listed.message, /主工作区/)
  const created = await runCommand('/worktree create demo', baseCtx({ cwd: repo, home }))
  assert.match(created.message, /已创建 worktree/)
  const createdPath = created.message.split('\n')[0].replace(/^已创建 worktree：/, '')
  assert.equal(existsSync(createdPath), true)
  const afterCreate = await runCommand('/worktree list', baseCtx({ cwd: repo, home }))
  assert.match(afterCreate.message, /共 2 个 worktree/)
  let preview = []
  const cancelled = await runCommand('/worktree remove demo', baseCtx({
    cwd: repo,
    home,
    confirm: async (request) => { preview = request.preview; return false }
  }))
  assert.match(cancelled.message, /已取消删除/)
  assert.ok(preview.some((line) => line.includes('路径：')))
  assert.equal(existsSync(createdPath), true, '取消后保留 worktree')
  const removed = await runCommand('/worktree remove demo', baseCtx({
    cwd: repo,
    home,
    confirm: async () => true
  }))
  assert.match(removed.message, /已删除 worktree/)
  assert.match(removed.message, /丢弃文件 0 个、提交 0 个/)
  assert.equal(existsSync(createdPath), false)
  const finalList = await runCommand('/worktree list', baseCtx({ cwd: repo, home }))
  assert.match(finalList.message, /共 1 个 worktree/)
})

test('CMD-08 /tasks：真实子进程完成后列出状态、退出码与输出路径', async (t) => {
  const dir = tempDir(t, 'budingx-tasks-')
  const registry = createTaskRegistry()
  const ok = trackCommandTask(registry, {
    title: '后台 echo',
    command: process.execPath,
    args: ['-e', 'process.stdout.write("done")'],
    cwd: dir,
    logDir: join(dir, 'logs')
  })
  const failed = trackCommandTask(registry, {
    title: '后台失败',
    command: process.execPath,
    args: ['-e', 'process.exit(3)'],
    cwd: dir,
    logDir: join(dir, 'logs')
  })
  const okId = ok.record.id
  const failedId = failed.record.id
  const deadline = Date.now() + 10000
  while (Date.now() < deadline && (registry.get(okId).status === 'running' || registry.get(failedId).status === 'running')) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.equal(registry.get(okId).status, 'completed')
  assert.equal(registry.get(okId).exitCode, 0)
  assert.equal(registry.get(okId).outputPath, join(dir, 'logs', okId + '.log'))
  assert.equal(readFileSync(registry.get(okId).outputPath, 'utf8'), 'done')
  const listed = await runCommand('/tasks', baseCtx({ tasks: registry }))
  assert.match(listed.message, /共 2 个任务/)
  assert.match(listed.message, /后台 echo · 已完成  exit=0/)
  assert.match(listed.message, /后台失败 · 失败  exit=3/)
  assert.match(listed.message, new RegExp(okId.slice(0, 8)))
})

const HISTORY = [
  { role: 'user', blocks: [{ type: 'text', text: '你好' }] },
  { role: 'assistant', blocks: [{ type: 'text', text: '回答' }, { type: 'tool_use', name: 'Bash', id: 'call-1', input: {} }] },
  { role: 'tool', blocks: [{ type: 'tool_result', callId: 'call-1', content: 'ok', isError: false }] }
]

test('CMD-11 /export：格式/路径显式且必须位于数据根内，不覆盖既有文件', async (t) => {
  const home = tempDir(t, 'budingx-export-')
  const session = { id: 'sess-export', history: HISTORY }
  const text = await runCommand('/export --format text --path reports/out.txt', baseCtx({ home, session }))
  assert.match(text.message, /已导出 \d+ 字节/)
  const textPath = join(home, '.budingx', 'reports', 'out.txt')
  assert.equal(existsSync(textPath), true)
  const body = readFileSync(textPath, 'utf8')
  assert.match(body, /## 用户/)
  assert.match(body, /## 助手/)
  assert.match(body, /> 工具调用：Bash/)
  const again = await runCommand('/export --format text --path reports/out.txt', baseCtx({ home, session }))
  assert.match(again.message, /导出目标已存在，未覆盖/)
  const escape = await runCommand('/export --path ../escape.txt', baseCtx({ home, session }))
  assert.match(escape.message, /导出路径必须位于/)
  assert.equal(existsSync(join(home, 'escape.txt')), false)
  const badFlag = await runCommand('/export --nope', baseCtx({ home, session }))
  assert.match(badFlag.message, /未知参数：--nope/)
  const badFormat = await runCommand('/export -f xml', baseCtx({ home, session }))
  assert.match(badFormat.message, /jsonl、text 或 markdown/)
  const defaults = await runCommand('/export -f jsonl', baseCtx({ home, session }))
  assert.match(defaults.message, /已导出/)
  const defaultPath = defaults.message.replace(/^已导出 \d+ 字节：/, '')
  assert.ok(defaultPath.startsWith(join(home, '.budingx', 'exports')))
  const firstLine = JSON.parse(readFileSync(defaultPath, 'utf8').split('\n')[0])
  assert.equal(firstLine.role, 'user')
})

test('CMD-09/CMD-10 /mcp 与 /skills：交互式打开只读列表，非交互返回文本', async (t) => {
  const home = tempDir(t, 'budingx-list-')
  const cwd = join(home, 'workspace')
  mkdirSync(join(cwd, '.budingx', 'skills', 'demo'), { recursive: true })
  writeFileSync(join(cwd, '.budingx', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: 演示技能\n---\n正文\n')
  const statuses = [
    { name: 'alpha', connected: true, tools: 3, serverName: 'srv', serverVersion: '1.0' },
    { name: 'beta', connected: false, tools: 0, error: 'boom' }
  ]
  const mcp = await runCommand('/mcp', baseCtx({ mcp: { statuses }, interactive: true }))
  assert.equal(mcp.openList.title, 'MCP 服务器')
  assert.ok(mcp.openList.lines.some((line) => line.includes('alpha · 已连接 · 工具 3 个')))
  assert.ok(mcp.openList.lines.some((line) => line.includes('beta · 未连接 · boom')))
  const mcpText = await runCommand('/mcp', baseCtx({ mcp: { statuses } }))
  assert.match(mcpText.message, /alpha · 已连接 · 工具 3 个/)
  const emptyMcp = await runCommand('/mcp', baseCtx())
  assert.match(emptyMcp.message, /未配置 MCP 服务器/)
  const skills = await runCommand('/skills', baseCtx({ home, cwd, interactive: true }))
  assert.equal(skills.openList.title, '技能')
  const joined = skills.openList.lines.join('\n')
  assert.match(joined, /\/demo · 项目/)
  assert.match(joined, /演示技能/)
  assert.match(joined, /SKILL\.md/)
})

test('CMD-07 /worktree 在非 git 目录给出可读错误而不是崩溃', async (t) => {
  const dir = tempDir(t, 'budingx-wt-bad-')
  const result = await runCommand('/worktree list', baseCtx({ cwd: dir, home: dir }))
  assert.match(result.message, /无法列出 worktree/)
})

test('CMD-05…CMD-11 命令帮助包含七条新增命令', async () => {
  const help = await runCommand('/help', baseCtx())
  for (const name of ['/init', '/btw', '/worktree', '/tasks', '/mcp', '/skills', '/export']) {
    assert.ok(help.message.includes(name), 'help missing ' + name)
  }
})
