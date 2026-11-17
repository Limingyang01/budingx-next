import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PassThrough } from 'node:stream'
import { createElement } from 'react'
import { render } from 'ink'
import { stripVTControlCharacters } from 'node:util'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { App } from '../dist/tui/app.js'
import { Session } from '../dist/core/session.js'
import { InkApprovalGateway } from '../dist/tui/approval.js'
import { ConfigStore } from '../dist/storage/config-store.js'
import { CredentialStore } from '../dist/storage/credentials.js'
const pause = (ms = 80) => new Promise((r) => setTimeout(r, ms))
async function mount(t, provider, tools = [], commandOverrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'budingx-app-'))
  const stores = {
    configStore: new ConfigStore(join(root, 'config.json')),
    credentialStore: new CredentialStore(join(root, 'credentials.json'))
  }
  const gateway = new InkApprovalGateway()
  let config = {
    baseUrl: 'https://fixture.invalid/v1',
    model: 'fixture',
    apiKey: '',
    timeoutMs: 100,
    source: 'env'
  }
  const session = new Session({
    provider,
    tools,
    approval: gateway,
    resolveSnapshot: () => ({
      modelId: 'm',
      model: config.model,
      baseUrlHost: new URL(config.baseUrl).host,
      capabilities: { tools: true }
    })
  })
  const stdin = new PassThrough()
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  const stdout = new PassThrough()
  stdout.columns = 80
  stdout.rows = 1000
  stdout.isTTY = true
  let raw = '',
    last = ''
  stdout.on('data', (chunk) => {
    raw += chunk
    const clean = stripVTControlCharacters(chunk.toString())
    if (clean.trim()) last = clean
  })
  const app = render(
    createElement(App, {
      session,
      gateway,
      version: '0.1.1',
      commandContext: {
        ...stores,
        getConfig: () => config,
        setConfig: (n) => (config = n),
        exit() {},
        ...commandOverrides
      },
      onExit() {}
    }),
    {
      stdin,
      stdout,
      stderr: stdout,
      debug: false,
      exitOnCtrlC: false,
      patchConsole: false
    }
  )
  t.after(() => {
    app.unmount()
    session.dispose()
    stdin.destroy()
    stdout.destroy()
  })
  await pause()
  return {
    ...stores,
    gateway,
    session,
    stdout,
    raw: () => raw,
    last: () => last,
    send: async (text) => {
      stdin.write(text)
      await pause()
      await app.waitUntilRenderFlush()
    },
    config: () => config
  }
}
const idle = {
  async *stream() {
    yield { type: 'text_delta', text: 'answer' }
    yield { type: 'message_completed', finishReason: 'stop' }
  }
}
test('G01 Ink 隐藏 Key 输入、持久化且不回显', async (t) => {
  const ui = await mount(t, idle)
  await ui.send('/provider add work https://fixture.invalid/v1 model')
  await ui.send('\r')
  await ui.send('/provider key work')
  await ui.send('\r')
  await ui.send('fixture-super-secret')
  await ui.send('\r')
  const profile = ui.configStore.load().models[0]
  assert.equal(
    ui.credentialStore.get(profile.id, 'fixture.invalid'),
    'fixture-super-secret'
  )
  assert.equal(ui.raw().includes('fixture-super-secret'), false)
  await ui.send('/model work')
  await ui.send('\r')
  assert.equal(ui.config().model, 'model')
  assert.equal(ui.config().apiKey, 'fixture-super-secret')
})
test('G07 Ink 忙时命令回合结束执行一次', async (t) => {
  let release
  const gate = new Promise((r) => (release = r))
  const ui = await mount(t, {
    async *stream() {
      await gate
      yield { type: 'message_completed', finishReason: 'stop' }
    }
  })
  ui.session.submit('working')
  await pause()
  await ui.send('/provider add queued https://fixture.invalid/v1 model')
  await ui.send('\r')
  assert.equal(ui.configStore.load().models.length, 0)
  release()
  await pause(80)
  assert.equal(ui.configStore.load().models.length, 1)
})
test('G08/G12 Ink bracketed paste 不发送、光标移动编辑及 resize', async (t) => {
  let turns = 0
  const ui = await mount(t, {
    async *stream() {
      turns++
      yield { type: 'message_completed', finishReason: 'stop' }
    }
  })
  await ui.send('\x1b[200~中文\n第二行\x1b[201~')
  assert.equal(turns, 0)
  assert.match(ui.last(), /中文/)
  await ui.send('\x1b[D')
  await ui.send('X')
  assert.match(ui.last(), /第二X行/)
  ui.stdout.columns = 32
  ui.stdout.emit('resize')
  await pause()
  assert.match(ui.last(), /第二X行/)
  assert.ok(ui.raw().includes('\x1b[?25h'))
})
test('G09 Ink 审批 Esc 拒绝并继续，停打重现且取消清理 gateway', async (t) => {
  let n = 0
  const ui = await mount(
    t,
    {
      async *stream() {
        if (n++ === 0)
          yield {
            type: 'tool_call_delta',
            index: 0,
            callId: 'c',
            nameDelta: 'echo',
            argsDelta: '{}'
          }
        yield { type: 'message_completed', finishReason: n === 1 ? 'tool_calls' : 'stop' }
      }
    },
    [
      {
        name: 'echo',
        describe: () => 'echo request',
        requiresApproval: () => true,
        execute: async () => {
          throw new Error('must deny')
        }
      }
    ]
  )
  ui.session.submit('needs approval')
  await pause()
  assert.equal(ui.gateway.pendingRequests.length, 1)
  await ui.send('draft')
  assert.doesNotMatch(ui.last(), /Approval needed/)
  await pause(750)
  assert.match(ui.last(), /Approval needed|需要审批/)
  await ui.send('\x1b')
  await pause()
  assert.equal(ui.gateway.pendingRequests.length, 0)
  assert.equal(ui.session.isBusy, false)
  assert.ok(
    ui.session.history.some(
      (m) => m.role === 'tool' && m.blocks[0].content.includes('Denied')
    )
  )
})

test('G08 方向键单独移动可见光标而不依赖下一次输入', async (t) => {
  const ui = await mount(t, idle)
  await ui.send('abc')
  const before = ui.raw().length
  await ui.send('\x1b[D')
  assert.ok(
    ui.raw().length > before,
    'cursor-only change must render terminal cursor update'
  )
  assert.ok(ui.raw().slice(before).includes('\x1b[5G'))
  const second = ui.raw().length
  await ui.send('\x1b[D')
  assert.ok(ui.raw().slice(second).includes('\x1b[4G'))
  const third = ui.raw().length
  await ui.send('\x1b[C')
  assert.ok(ui.raw().slice(third).includes('\x1b[5G'))
})

test('G04/G07 异步命令阻止新提示词和自动队列抢跑', async (t) => {
  let release
  const gate = new Promise((r) => (release = r))
  const models = []
  const ui = await mount(
    t,
    {
      async *stream(req) {
        models.push(req.model)
        yield { type: 'message_completed', finishReason: 'stop' }
      }
    },
    [],
    {
      probe: async () => {
        await gate
        return { ok: true, message: 'ok' }
      }
    }
  )
  await ui.send('/provider add a https://a.invalid/v1 a')
  await ui.send('\r')
  await ui.send('/provider key a')
  await ui.send('\r')
  await ui.send('fixture-key')
  await ui.send('\r')
  await ui.send('/provider add b https://b.invalid/v1 b')
  await ui.send('\r')
  await ui.send('/provider check a')
  await ui.send('\r')
  await ui.send('/model b')
  await ui.send('\r')
  await ui.send('hello')
  await ui.send('\r')
  assert.equal(models.length, 0)
  release()
  await pause(180)
  assert.deepEqual(models, ['b'])
})

test('G07 自动队列等待回合边界的异步命令', async (t) => {
  let releaseTurn, releaseProbe
  const turnGate = new Promise((r) => (releaseTurn = r)),
    probeGate = new Promise((r) => (releaseProbe = r))
  let n = 0
  const ui = await mount(
    t,
    {
      async *stream() {
        if (n++ === 0) await turnGate
        yield { type: 'message_completed', finishReason: 'stop' }
      }
    },
    [],
    {
      probe: async () => {
        await probeGate
        return { ok: true, message: 'ok' }
      }
    }
  )
  await ui.send('/provider add a https://a.invalid/v1 a')
  await ui.send('\r')
  await ui.send('/provider key a')
  await ui.send('\r')
  await ui.send('fixture-key')
  await ui.send('\r')
  ui.session.submit('first')
  await pause()
  await ui.send('/provider check a')
  await ui.send('\r')
  await ui.send('second')
  await ui.send('\r')
  releaseTurn()
  await pause(550)
  assert.equal(n, 1)
  releaseProbe()
  await pause(550)
  assert.equal(n, 2)
})

test('G07 排在延迟提示词后面的 clear 仍等待新回合结束', async (t) => {
  let releaseProbe, releaseTurn
  const probeGate = new Promise((r) => (releaseProbe = r)),
    turnGate = new Promise((r) => (releaseTurn = r))
  const ui = await mount(
    t,
    {
      async *stream() {
        await turnGate
        yield { type: 'message_completed', finishReason: 'stop' }
      }
    },
    [],
    {
      probe: async () => {
        await probeGate
        return { ok: true, message: 'ok' }
      }
    }
  )
  await ui.send('/provider add a https://a.invalid/v1 a')
  await ui.send('\r')
  await ui.send('/provider key a')
  await ui.send('\r')
  await ui.send('fixture-key')
  await ui.send('\r')
  await ui.send('/provider check a')
  await ui.send('\r')
  await ui.send('hello')
  await ui.send('\r')
  await ui.send('/clear')
  await ui.send('\r')
  releaseProbe()
  await pause(150)
  assert.equal(ui.session.isBusy, true)
  assert.equal(ui.session.history.length, 1)
  assert.doesNotMatch(ui.last(), /Conversation cleared|会话已清空/)
  releaseTurn()
  await pause(150)
  assert.equal(ui.session.history.length, 0)
  assert.match(ui.last(), /Conversation cleared|会话已清空/)
})
