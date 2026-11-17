import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runCommand } from '../dist/tui/commands.js'
import { ConfigStore } from '../dist/storage/config-store.js'
import { CredentialStore } from '../dist/storage/credentials.js'
import { createProfile, profileHost } from '../dist/storage/profiles.js'

function stores() {
  const home = mkdtempSync(join(tmpdir(), 'budingx-commands-'))
  mkdirSync(join(home, '.budingx'), { recursive: true })
  const configStore = new ConfigStore(join(home, '.budingx', 'config.json'))
  const credentialStore = new CredentialStore(join(home, '.budingx', 'credentials.json'))
  return { configStore, credentialStore }
}

function context(overrides = {}) {
  const store = stores()
  const cleared = []
  let exited = false
  const config = {
    baseUrl: 'https://api.example.test/v1',
    model: 'model-one',
    apiKey: 'sk-secret-value',
    timeoutMs: 120000,
    source: 'env',
    ...overrides.config
  }
  return {
    store,
    cleared,
    isExited: () => exited,
    context: {
      session: { clearHistory: () => cleared.push(true) },
      configStore: store.configStore,
      credentialStore: store.credentialStore,
      getConfig: () => config,
      setConfig: (next) => {
        Object.assign(config, next)
      },
      exit: () => {
        exited = true
      }
    },
    config
  }
}

test('/help 返回命令说明', async () => {
  const { context: ctx } = context()
  const outcome = await runCommand('/help', ctx)
  assert.equal(outcome.handled, true)
  assert.match(outcome.message, /\/provider/)
})

test('/config 隐藏 key 明文', async () => {
  const { context: ctx } = context()
  const outcome = await runCommand('/config', ctx)
  assert.equal(outcome.message.includes('sk-secret-value'), false)
  assert.match(outcome.message, /alue/)
})

test('/model 切换不清空会话历史', async () => {
  const { context: ctx, store, config } = context()
  const profile = createProfile({
    label: 'second',
    baseUrl: 'https://second.example.test/v1',
    model: 'model-two'
  })
  store.configStore.save({ version: 1, models: [profile] })
  const outcome = await runCommand(`/model ${profile.id}`, ctx)
  assert.equal(outcome.error, undefined)
  assert.equal(config.model, 'model-two')
  assert.equal(config.baseUrl, 'https://second.example.test/v1')
})

test('/provider add 后可列出，rm 会连带删除 key', async () => {
  const { context: ctx, store } = context()
  const added = await runCommand(
    '/provider add first https://api.example.test/v1 model-one',
    ctx
  )
  assert.equal(added.error, undefined)
  const stored = store.configStore.load()
  assert.equal(stored.models.length, 1)
  const profile = stored.models[0]
  store.credentialStore.set(profile.id, profileHost(profile), 'sk-value')

  const listed = await runCommand('/models', ctx)
  assert.match(listed.message, /first/)

  const removed = await runCommand(`/provider rm ${profile.id}`, ctx)
  assert.equal(removed.error, undefined)
  assert.equal(store.configStore.load().models.length, 0)
  assert.equal(store.credentialStore.list().length, 0)
})

test('/provider add 拒绝重复档案名与非法输入', async () => {
  const { context: ctx } = context()
  await runCommand('/provider add first https://api.example.test/v1 model-one', ctx)
  const duplicate = await runCommand(
    '/provider add first https://api.example.test/v1 model-two',
    ctx
  )
  assert.match(duplicate.error, /already exists/i)
  const incomplete = await runCommand('/provider add only-label', ctx)
  assert.match(incomplete.error, /Usage/i)
})

test('未知命令给出明确错误', async () => {
  const { context: ctx } = context()
  const outcome = await runCommand('/nope', ctx)
  assert.match(outcome.error, /Unknown command/i)
})

test('/exit 触发退出', async () => {
  const { context: ctx, isExited } = context()
  const outcome = await runCommand('/exit', ctx)
  assert.equal(outcome.exit, true)
  assert.equal(isExited(), true)
})

test('/clear 清空会话', async () => {
  const { context: ctx, cleared } = context()
  await runCommand('/clear', ctx)
  assert.equal(cleared.length, 1)
})

test('/provider check 用档案凭据探测并报告工具能力', async () => {
  const { context: ctx, store } = context()
  const added = await runCommand(
    '/provider add first https://api.example.test/v1 model-one',
    ctx
  )
  assert.equal(added.error, undefined)
  const profile = store.configStore.load().models[0]
  store.credentialStore.set(profile.id, profileHost(profile), 'sk-value')

  const requests = []
  const outcome = await runCommand(`/provider check ${profile.id}`, {
    ...ctx,
    probe: async (target, options) => {
      requests.push({ target, options })
      return { ok: true, message: 'reachable', supportsTools: true }
    }
  })
  assert.equal(outcome.error, undefined)
  assert.match(outcome.message, /reachable/)
  assert.match(outcome.message, /tool calls supported/)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].target.model, 'model-one')
  assert.equal(requests[0].target.apiKey, 'sk-value')
  assert.equal(requests[0].options.tools, true)
})

test('/provider check 在缺少凭据时明确拒绝且不发出请求', async () => {
  const { context: ctx } = context()
  await runCommand('/provider add first https://api.example.test/v1 model-one', ctx)
  const stored = ctx.configStore.load()
  let called = 0
  const outcome = await runCommand(`/provider check ${stored.models[0].id}`, {
    ...ctx,
    probe: async () => {
      called++
      return { ok: true, message: 'reachable' }
    }
  })
  assert.match(outcome.error, /No key stored/i)
  assert.equal(called, 0)
})

test('G02/G03 编辑档案并设置默认', async () => {
  const { context: ctx, store } = context()
  await runCommand('/provider add first https://one.invalid/v1 one', ctx)
  await runCommand('/provider add second https://two.invalid/v1 two', ctx)
  const edit = await runCommand(
    '/provider edit second renamed https://new.invalid/v1 new-model',
    ctx
  )
  assert.equal(edit.error, undefined)
  assert.equal(store.configStore.load().models[1].model, 'new-model')
  assert.equal((await runCommand('/provider default renamed', ctx)).error, undefined)
  const loaded = store.configStore.load()
  assert.equal(loaded.defaultModelId, loaded.models[1].id)
})
test('G01 命令请求隐藏录入且拒绝参数密钥', async () => {
  const { context: ctx } = context()
  await runCommand('/provider add first https://one.invalid/v1 one', ctx)
  const result = await runCommand('/provider key first', ctx)
  assert.equal(result.error, undefined)
  assert.equal(result.keyRequest.host, 'one.invalid')
  const rejected = await runCommand('/provider key first test-secret', ctx)
  assert.ok(rejected.error)
  assert.equal(JSON.stringify(rejected).includes('test-secret'), false)
})
test('G05/G06 能力修改及显式孤儿清理', async () => {
  const { context: ctx, store } = context()
  await runCommand('/provider add first https://one.invalid/v1 one', ctx)
  assert.equal((await runCommand('/provider tools first off', ctx)).error, undefined)
  assert.equal(store.configStore.load().models[0].capabilities.tools, false)
  store.credentialStore.set('orphan', 'one.invalid', 'fixture-key')
  assert.match((await runCommand('/provider orphans', ctx)).message, /orphan/i)
  assert.equal(store.credentialStore.list().length, 1)
  await runCommand('/provider orphans clean', ctx)
  assert.equal(store.credentialStore.list().length, 0)
})

test('G04 活动档案编辑换主机清空凭据，删除后不再继续使用', async () => {
  const { context: ctx, config } = context()
  await runCommand('/provider add one https://one.invalid/v1 old', ctx)
  await runCommand('/model one', ctx)
  config.apiKey = 'fixture-active-key'
  await runCommand('/provider edit one renamed https://other.invalid/v1 new', ctx)
  assert.equal(config.baseUrl, 'https://other.invalid/v1')
  assert.equal(config.model, 'new')
  assert.equal(config.apiKey, '')
  await runCommand('/provider rm renamed', ctx)
  assert.equal(config.model, '')
  assert.equal(config.apiKey, '')
})
