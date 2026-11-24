// SP006 回归：/resume 恢复出的历史必须同时进入模型上下文与可见转录。
// 证据层级：L1 纯函数（reducer / 映射）、L2 真实 Ink 帧、L3 真实运行时 + 真实会话存储。
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Session } from '../dist/core/session.js'
import { ConfigStore } from '../dist/storage/config-store.js'
import { sessionDirectory } from '../dist/storage/private-file.js'
import { TRANSCRIPT_FILE } from '../dist/storage/session-transcript.js'
import { createAgentRuntime } from '../dist/tui/runtime.js'
import { reduceFrame } from '../dist/tui/render/reducer.js'
import { restoredTranscriptEntries } from '../dist/tui/render/restored-transcript.js'
import { initialFrame } from '../dist/tui/render/types.js'
import { mountTty } from './helpers/mount-tty.mjs'

const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: false }
}

test('SP006：conversation_restored 重建可见转录并保留本会话改动', () => {
  const frame = {
    ...initialFrame('read_only'),
    transcript: [{ kind: 'plain', text: '恢复前的临时内容' }],
    changes: [{ path: 'a.txt', operation: 'write' }]
  }
  const next = reduceFrame(
    frame,
    {
      type: 'conversation_restored',
      messages: [
        { id: 'm1', role: 'user', blocks: [{ type: 'text', text: '之前的问题' }] },
        { id: 'm2', role: 'assistant', blocks: [{ type: 'text', text: '之前的回答' }] }
      ]
    },
    { width: 80 }
  )
  assert.deepEqual(
    next.transcript.map((entry) => entry.text),
    ['之前的问题', '之前的回答'],
    '恢复后的转录应由恢复出的历史重建'
  )
  assert.equal(next.transcript[0].kind, 'user')
  assert.equal(next.transcript[1].kind, 'assistant')
  assert.equal(next.changes.length, 1, '本会话改动不受恢复影响')
})

test('SP006：恢复的工具调用带结果，未决工具标记为已中断', () => {
  const entries = restoredTranscriptEntries([
    {
      id: 'm1',
      role: 'assistant',
      blocks: [{ type: 'tool_use', id: 'call-1', name: 'Read', input: { path: 'a.txt' } }]
    },
    {
      id: 'm2',
      role: 'tool',
      blocks: [{ type: 'tool_result', callId: 'call-1', content: '文件内容', isError: false }]
    },
    {
      id: 'm3',
      role: 'assistant',
      blocks: [{ type: 'tool_use', id: 'call-2', name: 'Bash', input: { path: 'b.txt' } }]
    }
  ])
  assert.equal(entries.length, 2)
  assert.equal(entries[0].text, 'Read(a.txt)')
  assert.equal(entries[0].status, 'success')
  assert.equal(entries[0].result, '文件内容')
  assert.equal(entries[1].status, 'interrupted', '没有结果的工具调用不得看起来仍在运行')
  assert.equal(entries[1].result, undefined)
})

test('SP006：TUI 恢复会话后消息区显示历史对话', async (t) => {
  const messages = [
    { id: 'm1', role: 'user', blocks: [{ type: 'text', text: '恢复前的问题' }] },
    { id: 'm2', role: 'assistant', blocks: [{ type: 'text', text: '恢复前的回答' }] }
  ]
  let session
  const ui = await mountTty(t, {
    config: { model: 'test-model' },
    sessionFactory: ({ gateway }) => {
      session = new Session({
        provider: { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } },
        approval: gateway,
        resolveSnapshot: () => SNAPSHOT
      })
      return session
    },
    commandOverrides: {
      sessions: {
        list: () => [
          { sessionId: 'sess-1', title: '旧会话', updatedAt: '2026-11-20', turns: 2 }
        ],
        resume: () => {
          // 真实路径：核心发出 conversation_restored，渲染层据此重建转录。
          session.restoreHistory(messages)
          return { ok: true, messages }
        }
      }
    }
  })
  await ui.send('/resume sess-1')
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('恢复前的问题'), 5000)
  const frame = ui.last()
  assert.match(frame, /恢复前的问题/, '恢复出的用户消息必须可见')
  assert.match(frame, /恢复前的回答/, '恢复出的助手消息必须可见')
})

test('SP006：运行时恢复后历史进入上下文、身份切换，续写落回被恢复会话', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-resume-history-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const requests = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(
      'data: {"choices":[{"delta":{"content":"已收到"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
    )
  })
  server.listen(0, '127.0.0.1')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  const cwd = join(home, 'repo')
  mkdirSync(cwd, { recursive: true })
  const configStore = new ConfigStore(join(home, 'config.json'))
  const open = (sessionId) => {
    const runtime = createAgentRuntime({
      cwd,
      home,
      sessionId,
      persistence: true,
      configStore,
      getConfig: () => ({ baseUrl, model: 'fixture', apiKey: '', timeoutMs: 3000, source: 'env' }),
      approval: { request: async () => ({ outcome: 'deny', via: 'policy' }) }
    })
    t.after(() => runtime.session.dispose())
    return runtime
  }
  const send = (runtime, prompt) =>
    new Promise((resolve) => {
      const off = runtime.session.on((event) => {
        if (event.type === 'turn_finalized') {
          off()
          resolve(event.outcome)
        }
      })
      runtime.session.submit(prompt)
    })

  const first = open('session-one')
  assert.equal(await send(first, '第一次提问'), 'completed')

  const second = open('session-two')
  const rejected = second.sessions.resume('session-one')
  assert.equal(rejected.ok, false)
  assert.equal(second.session.id, 'session-two')
  assert.equal(second.session.history.length, 0)
  first.session.dispose()
  const restored = []
  const off = second.session.on((event) => {
    if (event.type === 'conversation_restored') restored.push(event)
  })
  const outcome = second.sessions.resume('session-one')
  off()
  assert.equal(outcome.ok, true)
  assert.equal(restored.length, 1, '恢复必须发出 conversation_restored 事件')
  assert.equal(restored[0].messages.length, 2)
  assert.equal(second.session.history.length, 2, '历史必须进入模型上下文')
  assert.equal(second.session.id, 'session-one', '恢复后当前会话身份应切换到被恢复会话')
  assert.equal(outcome.sessionId, 'session-one')

  assert.equal(await send(second, '继续提问'), 'completed')
  assert.match(
    JSON.stringify(requests[1].messages),
    /第一次提问/,
    '续写请求必须带上恢复出的历史'
  )
  const transcript = readFileSync(
    join(sessionDirectory('session-one', home), TRANSCRIPT_FILE),
    'utf8'
  )
  assert.match(transcript, /继续提问/, '续写必须写进被恢复会话的转录')
  assert.match(transcript, /第一次提问/, '被恢复会话的转录保留原有历史')
})

test('SP006：TUI 用真实 /resume 命令与真实会话存储恢复出历史', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-resume-tui-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const requests = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(
      'data: {"choices":[{"delta":{"content":"旧会话的回答"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
    )
  })
  server.listen(0, '127.0.0.1')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  const workspace = join(home, 'repo')
  mkdirSync(workspace, { recursive: true })
  const configStore = new ConfigStore(join(home, 'config.json'))
  const open = (sessionId) => {
    const runtime = createAgentRuntime({
      cwd: workspace,
      home,
      sessionId,
      persistence: true,
      configStore,
      getConfig: () => ({ baseUrl, model: 'fixture', apiKey: '', timeoutMs: 3000, source: 'env' }),
      approval: { request: async () => ({ outcome: 'deny', via: 'policy' }) }
    })
    t.after(() => runtime.session.dispose())
    return runtime
  }
  const send = (runtime, prompt) =>
    new Promise((resolve) => {
      const off = runtime.session.on((event) => {
        if (event.type === 'turn_finalized') {
          off()
          resolve(event.outcome)
        }
      })
      runtime.session.submit(prompt)
    })

  // 1) 先用一个真实运行时写入旧会话。
  const writer = open('sess-existing')
  assert.equal(await send(writer, '旧会话里的问题'), 'completed')
  writer.session.dispose()

  // 2) 当前会话的 TUI 用真实命令与真实会话存储恢复旧会话。
  const current = open('sess-current')
  const ui = await mountTty(t, {
    config: { model: 'fixture' },
    sessionFactory: () => current.session,
    commandOverrides: { sessions: current.sessions }
  })
  await ui.send('/resume sess-existing')
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('旧会话里的问题'), 5000)
  const frame = ui.last()
  assert.match(frame, /旧会话里的问题/, '恢复出的用户消息必须出现在消息区')
  assert.match(frame, /旧会话的回答/, '恢复出的助手消息必须出现在消息区')
  assert.equal(current.session.id, 'sess-existing', '恢复后当前会话身份切换到被恢复会话')
})

test('SP006 波次 F：旧转录里的碎片文本块在恢复时合并为一条记录', () => {
  const legacy = [
    { id: 'u1', role: 'user', blocks: [{ type: 'text', text: '调整一下' }] },
    {
      id: 'a1',
      role: 'assistant',
      blocks: [
        { type: 'text', text: '我调整' },
        { type: 'text', text: '颗粒度' },
        { type: 'thinking', text: '可显示的思考' },
        { type: 'text', text: '（比如深挖某一板块）' },
        { type: 'tool_use', id: 'call-1', name: 'Read', input: { path: 'a.txt' } }
      ]
    },
    {
      id: 't1',
      role: 'tool',
      blocks: [{ type: 'tool_result', callId: 'call-1', content: '文件内容', isError: false }]
    }
  ]
  const entries = restoredTranscriptEntries(legacy)
  assert.deepEqual(
    entries.map((entry) => [entry.kind, entry.text]),
    [
      ['user', '调整一下'],
      ['thinking', '可显示的思考'],
      ['assistant', '我调整颗粒度（比如深挖某一板块）'],
      ['tool', 'Read(a.txt)']
    ],
    '旧转录中的同一条正文须跨思考块合并，工具结果仍配对'
  )
  assert.equal(entries[3].status, 'success')
})

test('SP006 波次 F：多增量流式回答落盘为单块，恢复后整段显示', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-resume-frag-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const sentence = '恢复后的整段回答应当完整显示'
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    // 逐段推送，复现真实 Provider 的流式增量。
    for (const piece of ['恢复后的', '整段回答', '应当完整显示']) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece }, finish_reason: null }] })}\n\n`)
    }
    res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  const workspace = join(home, 'repo')
  mkdirSync(workspace, { recursive: true })
  const configStore = new ConfigStore(join(home, 'config.json'))
  const open = (sessionId) => {
    const runtime = createAgentRuntime({
      cwd: workspace,
      home,
      sessionId,
      persistence: true,
      configStore,
      getConfig: () => ({ baseUrl, model: 'fixture', apiKey: '', timeoutMs: 3000, source: 'env' }),
      approval: { request: async () => ({ outcome: 'deny', via: 'policy' }) }
    })
    t.after(() => runtime.session.dispose())
    return runtime
  }
  const send = (runtime, prompt) =>
    new Promise((resolve) => {
      const off = runtime.session.on((event) => {
        if (event.type === 'turn_finalized') {
          off()
          resolve(event.outcome)
        }
      })
      runtime.session.submit(prompt)
    })

  const writer = open('sess-frag')
  assert.equal(await send(writer, '旧问题'), 'completed')
  const assistant = writer.session.history.filter((message) => message.role === 'assistant').at(-1)
  const textBlocks = assistant.blocks.filter((block) => block.type === 'text')
  assert.equal(textBlocks.length, 1, '一条助手消息只应保留一个文本块')
  assert.equal(textBlocks[0].text, sentence)
  writer.session.dispose()

  const current = open('sess-current')
  const ui = await mountTty(t, {
    config: { model: 'fixture' },
    sessionFactory: () => current.session,
    commandOverrides: { sessions: current.sessions }
  })
  await ui.send('/resume sess-frag')
  await ui.send('\r')
  const frame = await ui.waitFor((candidate) => candidate.includes(sentence), 5000)
  assert.ok(frame.includes(sentence), '恢复后的整段回答必须在同一行内连续显示')
  assert.equal(current.session.history.length, 2)
})
