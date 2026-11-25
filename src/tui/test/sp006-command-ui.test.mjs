// SP006 §6.3：命令面在真实 Ink 帧中的接线（/mcp 列表、/btw 旁路回显）。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'
import { createWorkspace } from '../dist/workspace/paths.js'
import { createPermissionPolicy } from '../dist/workspace/policy.js'

function policyFor(root) {
  const workspace = createWorkspace(root)
  const policy = createPermissionPolicy({ mode: 'full_access', workspace })
  return { workspace, policy }
}

const permissionOverrides = (workspace, policy) => ({
  permission: {
    policy,
    setMode: (mode) => policy.setMode(mode),
    store: { save: () => {}, load: () => ({ schemaVersion: 1, rules: [] }) },
    workspace,
    checkpointChanges: () => [],
    undo: () => ({ ok: true }),
    denials: () => [],
    modes: {
      order: ['read_only', 'workspace_edit', 'full_access'],
      zh: { read_only: '仅可查看', workspace_edit: '允许编辑', full_access: '全自动' },
      en: { read_only: 'Read-only', workspace_edit: 'Allow edits', full_access: 'Full auto' }
    }
  }
})

test('CMD-09 /mcp 在帧中打开只读列表，Esc 关闭且输入区被模态占用', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'budingx-cmd-ui-mcp-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { workspace, policy } = policyFor(root)
  const provider = { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } }
  const ui = await mountTty(t, {
    fullScreen: true, columns: 100, rows: 40, provider, permissionPolicy: policy,
    config: { model: 'fixture' },
    commandOverrides: {
      ...permissionOverrides(workspace, policy),
      cwd: root,
      home: root,
      mcp: { statuses: [
        { name: 'alpha', connected: true, tools: 3, serverName: 'srv', serverVersion: '1.0' },
        { name: 'beta', connected: false, tools: 0, error: 'boom' }
      ] }
    }
  })
  await ui.send('/mcp\r')
  await ui.waitFor((frame) => frame.includes('MCP 服务器') && frame.includes('alpha'), 5000)
  const open = ui.last()
  assert.match(open, /alpha · 已连接 · 工具 3 个/)
  assert.match(open, /beta · 未连接 · boom/)
  assert.match(open, /Esc 关闭/)
  assert.equal(ui.session.history.length, 0)
  await ui.send('\x1b')
  await ui.waitFor((frame) => !frame.includes('MCP 服务器'), 5000)
})

test('CMD-06 /btw 在帧中回显旁路回答且不写入主会话历史', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'budingx-cmd-ui-btw-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { workspace, policy } = policyFor(root)
  const calls = []
  const provider = {
    async *stream(request) {
      calls.push(request)
      yield { type: 'text_delta', text: '旁路答案' }
      yield { type: 'message_completed', finishReason: 'stop' }
    }
  }
  const ui = await mountTty(t, {
    fullScreen: true, columns: 100, rows: 40, provider, permissionPolicy: policy,
    config: { model: 'fixture' },
    commandOverrides: { ...permissionOverrides(workspace, policy), cwd: root, home: root }
  })
  await ui.send('/btw 主循环是什么\r')
  await ui.waitFor((frame) => frame.includes('/btw 主循环是什么') && frame.includes('旁路答案'), 5000)
  await ui.send('\x1b')
  await ui.waitFor((frame) => !frame.includes('旁路答案'))
  await ui.send('/btw 第二问\r')
  await ui.waitFor((frame) => frame.includes('/btw 第二问') && frame.includes('旁路答案'))
  await ui.send('\x1b[D')
  await ui.waitFor((frame) => frame.includes('1/2') && frame.includes('旁路答案'))
  await ui.send('x')
  await ui.waitFor((frame) => !frame.includes('旁路答案'))
  assert.equal(calls.length, 2)
  assert.ok(calls.every((request) => !request.tools?.length))
  assert.equal(ui.session.history.length, 0, '旁路问答不得进入主历史')
})

test('/btw 在主回合进行时打开，关闭面板只取消旁路请求', async (t) => {
  const main = Promise.withResolvers()
  t.after(main.resolve)
  const signals = []
  const ui = await mountTty(t, {
    fullScreen: true, columns: 94, rows: 30, config: { model: 'fixture' },
    provider: { async *stream(request) {
      signals.push(request.signal)
      if (signals.length === 1) {
        yield { type: 'text_delta', text: 'MAIN_RUNNING' }
        await main.promise
        yield { type: 'text_delta', text: '_COMPLETE' }
        yield { type: 'message_completed', finishReason: 'stop' }
      } else {
        await new Promise((resolve) => request.signal.addEventListener('abort', resolve, { once: true }))
      }
    } }
  })
  t.after(() => rmSync(ui.root, { recursive: true, force: true }))
  await ui.send('main prompt\r')
  await ui.waitFor((frame) => frame.includes('MAIN_RUNNING'))
  await ui.send('/btw side probe\r')
  await ui.waitFor((frame) => frame.includes('/btw side probe') && signals.length === 2)
  await ui.send('\x1b')
  await ui.waitFor((frame) => !frame.includes('/btw side probe'))
  assert.equal(signals[1].aborted, true)
  assert.equal(signals[0].aborted, false)
  assert.equal(ui.session.isBusy, true)
  main.resolve()
  await ui.waitFor((frame) => frame.includes('MAIN_RUNNING_COMPLETE'))
  assert.equal(ui.session.history.length, 2)
})

test('/btw 长回答可滚动到底部，并可把所选问答交给会话分支', async (t) => {
  const response = Array.from({ length: 34 }, (_, i) => 'BTW-LINE-' + String(i + 1).padStart(2, '0')).join('\n')
  const forks = []
  const ui = await mountTty(t, {
    fullScreen: true, columns: 72, rows: 24, config: { model: 'fixture' },
    provider: { async *stream() {
      yield { type: 'text_delta', text: response }
      yield { type: 'message_completed', finishReason: 'stop' }
    } },
    commandOverrides: {
      sessions: {
        list: () => [], resume: () => ({ ok: false }),
        fork: (id, exchange) => { forks.push({ id, exchange }); return { ok: true, sessionId: 'branch' } }
      }
    }
  })
  t.after(() => rmSync(ui.root, { recursive: true, force: true }))
  await ui.send('/btw long answer\r')
  const firstPage = await ui.waitFor((frame) => frame.includes('BTW-LINE-01'))
  assert.doesNotMatch(firstPage, /BTW-LINE-34/)
  for (let i = 0; i < 3; i++) await ui.send('\x1b[6~')
  await ui.waitFor((frame) => frame.includes('BTW-LINE-34'))
  await ui.send('f')
  await ui.waitFor((frame) => !frame.includes('BTW-LINE-34'))
  assert.deepEqual(forks, [{ id: ui.session.id, exchange: { question: 'long answer', answer: response } }])
  assert.equal(ui.session.history.length, 0)
})


for (const fullScreen of [false, true]) {
  test('/btw 打开隐藏输入光标，关闭后恢复（' + (fullScreen ? '全屏' : '行内') + '）', async (t) => {
    const ui = await mountTty(t, {
      fullScreen, columns: 100, rows: 40, config: { model: 'fixture' },
      provider: { async *stream() {
        yield { type: 'text_delta', text: '三行测试答案' }
        yield { type: 'message_completed', finishReason: 'stop' }
      } }
    })
    t.after(() => rmSync(ui.root, { recursive: true, force: true }))
    const visibility = () => ui.raw().match(/\x1b\[\?25[hl]/g)?.at(-1)
    assert.equal(visibility(), '\x1b[?25h', '普通输入时的光标应可见')
    await ui.send('/btw 光标测试\r')
    await ui.waitFor((frame) => frame.includes('三行测试答案'))
    assert.equal(visibility(), '\x1b[?25l', '面板打开时光标应隐藏')
    await ui.send('\x1b')
    await ui.waitFor((frame) => !frame.includes('三行测试答案') && visibility() === '\x1b[?25h')
  })
}

test('/btw 网络审批在旁路面板展示搜索词，放行后显示带来源的答案', async (t) => {
  const { workspace, policy, root } = (() => {
    const root = mkdtempSync(join(tmpdir(), 'budingx-btw-approved-'))
    return { ...policyFor(root), root }
  })()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  policy.setMode('workspace_edit')
  let requests = 0
  let searches = 0
  const ui = await mountTty(t, {
    fullScreen: true, rows: 38, columns: 106, config: { model: 'fixture' },
    permissionPolicy: policy,
    commandOverrides: { ...permissionOverrides(workspace, policy), cwd: root, home: root },
    tools: [{
      name: 'WebSearch',
      capability: () => 'network',
      describe: () => 'Search public web pages',
      prepareApproval(input) {
        return {
          preview: [input.query],
          execute: async ({ approved }) => {
            assert.equal(approved, true)
            searches++
            return JSON.stringify({ sources: [{ title: '核验榜单', url: 'https://example.test/' }] })
          }
        }
      },
      execute: async () => assert.fail('expected prepared execution')
    }],
    provider: { async *stream(request) {
      requests++
      if (requests === 1) {
        assert.deepEqual(request.tools.map((tool) => tool.name), ['WebSearch'])
        yield { type: 'tool_call_delta', index: 0, callId: 'wt-search', nameDelta: 'WebSearch', argsDelta: '{"query":"微博热搜榜"}' }
        yield { type: 'message_completed', finishReason: 'tool_calls' }
      } else {
        assert.equal(request.messages.at(-1).tool_call_id, 'wt-search')
        yield { type: 'text_delta', text: '样例榜单来源 https://example.test/' }
        yield { type: 'message_completed', finishReason: 'stop' }
      }
    } }
  })
  t.after(() => rmSync(ui.root, { recursive: true, force: true }))
  await ui.send('/btw 查询现在的热搜\r')
  const pending = await ui.waitFor((frame) => frame.includes('待批准的联网搜索') && frame.includes('微博热搜榜'))
  assert.doesNotMatch(pending, /C 复制/)
  assert.equal(searches, 0)
  await ui.send('y')
  await ui.waitFor((frame) => frame.includes('样例榜单来源 https://example.test/'))
  assert.equal(searches, 1)
  assert.equal(requests, 2)
  assert.equal(ui.session.history.length, 0)
})
