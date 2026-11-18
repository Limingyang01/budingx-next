import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { commandHelp, runCommand } from '../dist/tui/commands.js'
import { ConfigStore } from '../dist/storage/config-store.js'
import { CredentialStore } from '../dist/storage/credentials.js'
import { saveModel, removeModel, testProfile, loadModelIds, selectProfile } from '../dist/tui/model-management.js'
import { createProfile, profileHost, startupProfile } from '../dist/storage/profiles.js'

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
  assert.match(outcome.message, /\/models/)
  assert.doesNotMatch(outcome.message, /\/provider/)
  assert.match((await runCommand('/provider add a', ctx)).error, /Unknown command/)
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


const draft = {
  label: 'first', baseUrl: 'https://one.invalid/v1', model: 'model-one',
  apiKey: 'fixture-key', tools: true, startupDefault: false
}

test('models is interactive in the TUI and a read-only list in pipes', async () => {
  const { context: ctx } = context()
  saveModel(ctx, draft, false)
  assert.match((await runCommand('/models', ctx)).message, /first/)
  assert.deepEqual(await runCommand('/models', { ...ctx, interactive: true }), {
    handled: true, openModels: true
  })
})

test('saving rejects duplicate labels and invalid model and key inputs', () => {
  const { context: ctx } = context()
  saveModel(ctx, draft, false)
  assert.throws(() => saveModel(ctx, { ...draft, model: 'model-two' }, false), /already exists/)
  assert.throws(() => saveModel(ctx, { ...draft, label: 'empty-model', model: '' }, false), /required/)
  assert.throws(() => saveModel(ctx, { ...draft, label: 'bad-key', apiKey: 'a b' }, false), /Invalid API key/)
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


test('connection test uses the bound key, requested model and tools preference', async () => {
  const { context: ctx } = context()
  const profile = saveModel(ctx, draft, false)
  const requests = []
  const result = await testProfile({
    ...ctx,
    probe: async (target, options) => {
      requests.push({ target, options })
      return { ok: true, message: 'reachable', supportsTools: true }
    }
  }, { ...draft, id: profile.id, apiKey: '' }, new AbortController().signal)
  assert.deepEqual(requests[0].target, { baseUrl: draft.baseUrl, model: draft.model, apiKey: draft.apiKey })
  assert.equal(requests[0].options.tools, true)
  assert.equal(result.supportsTools, true)
})

test('saving an edited profile keeps its ID, default, capabilities and same-host key', () => {
  const { context: ctx, store, config } = context()
  const profile = saveModel(ctx, { ...draft, tools: false, startupDefault: true }, true)
  const edited = saveModel(ctx, {
    ...draft, id: profile.id, model: 'other', label: 'renamed',
    apiKey: '', tools: false, startupDefault: true
  }, false)
  assert.equal(edited.id, profile.id)
  assert.equal(store.configStore.load().defaultModelId, profile.id)
  assert.equal(config.model, 'other')
  assert.equal(config.apiKey, draft.apiKey)
  assert.equal(edited.capabilities.tools, false)
})

test('changing hosts clears the stored key, deleting an active/default profile applies the replacement', () => {
  const { context: ctx, store, config } = context()
  const first = saveModel(ctx, { ...draft, startupDefault: true }, true)
  const second = saveModel(ctx, { ...draft, label: 'second', model: 'two' }, false)
  saveModel(ctx, { ...draft, id: first.id, baseUrl: 'https://changed.invalid/v1',
    apiKey: '', startupDefault: true }, false)
  assert.equal(config.apiKey, '')
  assert.equal(store.credentialStore.get(first.id, profileHost(first)), undefined)
  assert.throws(() => removeModel(ctx, first.id, 'missing'), /Replacement/)
  removeModel(ctx, first.id, second.id)
  assert.equal(store.configStore.load().defaultModelId, second.id)
  assert.equal(config.model, 'two')
  removeModel(ctx, second.id)
  assert.equal(config.model, '')
  assert.equal(store.credentialStore.list().length, 0)
  assert.equal(store.configStore.load().defaultModelId, null)
})

test('the product guide covers every advertised command in its usage section', () => {
  const handbook = readFileSync(new URL('../../../PRODUCT.md', import.meta.url), 'utf8')
  const usage = handbook.split('## 5. 使用说明')[1].split('## 6. 数据与隐私')[0]
  for (const [, name] of commandHelp('en').matchAll(/^\s+(\/[a-z]+)\b/gm)) {
    assert.ok(usage.includes(name), 'Missing usage for ' + name)
  }
  for (const iteration of ['Bootstrap', 'SP002', 'SP003']) {
    assert.ok(usage.includes(iteration), 'Missing usage section for ' + iteration)
  }
})

test('discovery uses the verified model-list route and explicit unsupported fallback', async () => {
  const { context: ctx } = context()
  const signal = new AbortController().signal
  const qwen = { ...draft, baseUrl: 'https://fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' }
  const result = await loadModelIds({
    ...ctx,
    discoverModels: async (url, key) => {
      assert.equal(url, 'https://fixture.cn-beijing.maas.aliyuncs.com/api/v1/models?capabilities=TG&page_size=100')
      assert.equal(key, draft.apiKey)
      return ['qwen-fixture']
    }
  }, qwen, signal)
  assert.deepEqual(result, { models: ['qwen-fixture'], suggested: false })
  const glm = { ...draft, baseUrl: 'https://open.bigmodel.cn/api/paas/v4' }
  const unsupported = { ...ctx, discoverModels: async () => { throw new Error('HTTP 404') } }
  assert.equal((await loadModelIds(unsupported, glm, signal)).suggested, true)
  await assert.rejects(loadModelIds(unsupported, { ...draft, baseUrl: 'https://custom.invalid/v1' }, signal), /404/)
})

test('explicitly empty startup default does not select a remaining legacy profile', () => {
  const model = createProfile(draft)
  const file = { version: 1, models: [model] }
  assert.equal(startupProfile(file), model)
  assert.equal(startupProfile({ ...file, defaultModelId: null }), undefined)
})

test('Token Plan stays on its own compatible URL and does not mask authentication failures', async () => {
  const { context: ctx } = context()
  const signal = new AbortController().signal
  const plan = { ...draft, baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' }
  const unsupported = { ...ctx, discoverModels: async (url, key) => {
    assert.equal(url, plan.baseUrl + '/models')
    assert.equal(key, draft.apiKey)
    throw new Error('HTTP 404')
  } }
  assert.deepEqual(await loadModelIds(unsupported, plan, signal), { models: ['auto'], suggested: true })
  const denied = { ...ctx, discoverModels: async () => { throw new Error('HTTP 401') } }
  await assert.rejects(loadModelIds(denied, plan, signal), /401/)
})

test('one saved provider configuration shares a key across selected models and survives deleting one', () => {
  const { context: ctx, config, store } = context()
  const first = saveModel(ctx, { ...draft, modelIds: ['model-two', 'model-three'] }, true)
  assert.equal(store.configStore.load().models.length, 3)
  assert.equal(store.credentialStore.list().length, 1)
  const two = store.configStore.load().models.find((item) => item.model === 'model-two')
  selectProfile(ctx, two)
  assert.equal(config.apiKey, draft.apiKey)
  removeModel(ctx, first.id)
  assert.equal(store.credentialStore.list().length, 1)
  assert.equal(config.model, 'model-two')
  removeModel(ctx, two.id)
  assert.equal(store.credentialStore.list().length, 1)
  const last = store.configStore.load().models[0]
  removeModel(ctx, last.id)
  assert.equal(store.credentialStore.list().length, 0)
})

test('adding to a legacy profile opts into sharing without merging another account on the same endpoint', () => {
  const { context: ctx, config, store } = context()
  const first = saveModel(ctx, { ...draft, label: 'account-a', startupDefault: true }, true)
  const separate = saveModel(ctx, { ...draft, label: 'account-b', apiKey: 'other-key' }, false)
  const second = saveModel(ctx, { ...draft, model: 'model-two', attachTo: first.id, label: '', apiKey: '' }, false)
  assert.equal(store.credentialStore.list().length, 2)
  assert.equal(config.apiKey, draft.apiKey)
  selectProfile(ctx, second)
  assert.equal(config.apiKey, draft.apiKey)
  const after = store.configStore.load().models.find((item) => item.id === first.id)
  saveModel(ctx, { ...draft, id: first.id, updatedAt: after.updatedAt, label: after.label,
    apiKey: 'new-shared-key', startupDefault: true }, false)
  assert.equal(config.apiKey, 'new-shared-key')
  selectProfile(ctx, separate)
  assert.equal(config.apiKey, 'other-key')
})


test('shared credentials stay bound to the exact endpoint and failed promotion keeps the legacy key', () => {
  const { context: ctx, store, config } = context()
  const first = saveModel(ctx, { ...draft, startupDefault: true }, true)
  const other = { ...draft, attachTo: first.id, label: '', model: 'model-two', apiKey: '' }
  const before = store.credentialStore.load()
  assert.throws(() => saveModel({
    ...ctx, configStore: { load: () => store.configStore.load(), save: () => { throw new Error('fixture disk error') } }
  }, other, false), /fixture disk error/)
  assert.deepEqual(store.credentialStore.load(), before)
  assert.equal(store.configStore.load().models.length, 1)

  const second = saveModel(ctx, other, true)
  assert.equal(config.apiKey, draft.apiKey)
  const parent = store.configStore.load().models.find((model) => model.id === first.id)
  saveModel(ctx, {
    ...draft, id: first.id, updatedAt: parent.updatedAt, apiKey: '',
    baseUrl: 'https://one.invalid/another-plan', startupDefault: true
  }, false)
  assert.equal(config.profileId, second.id)
  assert.equal(config.baseUrl, 'https://one.invalid/another-plan')
  assert.equal(config.apiKey, '')
  assert.equal(store.credentialStore.list().length, 0)
})
