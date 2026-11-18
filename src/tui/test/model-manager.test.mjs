
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addCustomModel, openModels } from './helpers/model-keys.mjs'
import { mountTty } from './helpers/mount-tty.mjs'

test('opens a model manager with keyboard actions', async (t) => {
  const ui = await mountTty(t, { columns: 60 })
  await ui.send('/models')
  await ui.send('\r')
  assert.match(ui.last(), /模型管理/)
  assert.match(ui.last(), /N 新建/)
})

test('domestic template pulls models with only a hidden key, then tests and switches', async (t) => {
  const requests = []
  const results = []
  const ui = await mountTty(t, {
    columns: 60,
    commandOverrides: {
      async discoverModels(url, token) {
        requests.push({ url, token })
        return ['deepseek-test', 'deepseek-code']
      },
      async probe(connection) {
        results.push(connection)
        if (results.length === 1) return { ok: false, errorClass: 'auth', message: 'secret should not appear' }
        return { ok: true, supportsTools: true, message: 'ok' }
      }
    }
  })
  await ui.send('/models')
  await ui.send('\r')
  await ui.send('n')
  await ui.waitFor((frame) => frame.includes('选择供应商'))
  await ui.send('\r')
  await ui.send('\x1b[200~secret-template-key\x1b[201~')
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('deepseek-code'))
  assert.deepEqual(requests, [{ url: 'https://api.deepseek.com/models', token: 'secret-template-key' }])
  await ui.send('code')
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('deepseek-code') && frame.includes('保存并使用'))
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('已保存并切换模型'))
  assert.equal(ui.config().model, 'deepseek-code')
  assert.equal(ui.config().apiKey, 'secret-template-key')

  await ui.send('/models')
  await ui.send('\r')
  await ui.send('t')
  await ui.waitFor((frame) => frame.includes('鉴权失败'))
  await ui.send('t')
  await ui.waitFor((frame) => frame.includes('连接成功'))
  assert.equal(results.at(-1).apiKey, 'secret-template-key')
  assert.doesNotMatch(ui.raw(), /secret-template-key|secret should not appear/)
})

test('editing a single field keeps the key and deleting requires confirmation', async (t) => {
  const ui = await mountTty(t)
  await addCustomModel(ui, { label: 'custom', baseUrl: 'https://custom.invalid/v1', model: 'before', key: 'secret-edit-key', use: true })
  await openModels(ui)
  await ui.send('e')
  await ui.waitFor((frame) => frame.includes('编辑模型'))
  await ui.send('\x15')
  await ui.send('after')
  await ui.send('\x1b[B')
  await ui.waitFor((frame) => frame.includes('after'))
  await ui.send('\x1b')
  assert.equal(ui.configStore.load().models[0].model, 'before')
  await ui.send('e')
  await ui.send('\x15')
  await ui.send('after')
  for (let i = 0; i < 7; i++) await ui.send('\t')
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('模型档案已保存'))
  assert.equal(ui.config().model, 'after')
  assert.equal(ui.config().apiKey, 'secret-edit-key')
  await ui.send('d')
  await ui.waitFor((frame) => frame.includes('确认删除'))
  assert.equal(ui.configStore.load().models.length, 1)
  await ui.send('\x1b')
  assert.equal(ui.configStore.load().models.length, 1)
  await ui.send('d')
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('模型档案已删除'))
  assert.equal(ui.configStore.load().models.length, 0)
  assert.equal(ui.credentialStore.list().length, 0)
  assert.equal(ui.config().model, '')
})

test('unsupported discovery leaves manual model entry usable in Custom', async (t) => {
  const ui = await mountTty(t, {
    commandOverrides: { discoverModels: async () => { throw new Error('HTTP 404') } }
  })
  await openModels(ui)
  await ui.send('n')
  await ui.send('\x1b[F')
  await ui.send('\r')
  await ui.send('https://custom.invalid/v1')
  await ui.send('\r')
  for (let i = 0; i < 5; i++) await ui.send('\t')
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('手动输入模型 ID'))
  for (let i = 0; i < 5; i++) await ui.send('\x1b[A')
  await ui.send('manual-id')
  for (let i = 0; i < 8; i++) await ui.send('\t')
  await ui.send('\r')
  assert.equal(ui.config().model, 'manual-id')
})

test('MiniMax China and Qwen Token Plan presets prefill their own endpoint and use only the entered key', async (t) => {
  const discovery = []
  const ui = await mountTty(t, {
    commandOverrides: {
      async discoverModels(url, key) {
        discovery.push({ url, key })
        if (url.includes('token-plan')) throw new Error('HTTP 404')
        return ['MiniMax-M3.1-Flash']
      }
    }
  })

  for (const [name, steps, model, key] of [
    ['MiniMax（中国站）', 7, 'MiniMax-M3.1-Flash', 'fixture-minimax-key'],
    ['Qwen / 百炼 Token Plan', 2, 'auto', 'fixture-token-plan-key']
  ]) {
    await openModels(ui)
    await ui.send('n')
    for (let i = 0; i < steps; i++) await ui.send('\x1b[B')
    await ui.waitFor((frame) => frame.includes('> ' + name))
    await ui.send('\r')
    await ui.send(key)
    await ui.send('\r')
    await ui.waitFor((frame) => frame.includes('筛选') && frame.includes(model))
    await ui.send('\r')
    await ui.waitFor((frame) => frame.includes('保存并使用') && frame.includes(model))
    await ui.send('\r')
    await ui.waitFor((frame) => frame.includes('已保存并切换模型'))
    assert.equal(ui.config().model, model)
    assert.equal(ui.raw().includes(key), false)
  }

  assert.deepEqual(discovery, [
    { url: 'https://api.minimax.cn/v1/models', key: 'fixture-minimax-key' },
    { url: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/models', key: 'fixture-token-plan-key' }
  ])
})

test('multiple model IDs can be selected once and more can be added with the same saved key', async (t) => {
  const requests = []
  const ui = await mountTty(t, {
    commandOverrides: {
      async discoverModels(endpoint, key) {
        requests.push({ endpoint, key })
        return ['model-one', 'model-two', 'model-three']
      }
    }
  })
  await openModels(ui)
  await ui.waitFor((frame) => frame.includes('N 新建'))
  await ui.send('n')
  await ui.waitFor((frame) => frame.includes('选择供应商'))
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('> API Key'))
  await ui.send('fixture-shared-key')
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('[ ] model-one'))
  await ui.send(' ')
  await ui.waitFor((frame) => frame.includes('[x] model-one'))
  await ui.send('\x1b[B')
  await ui.send(' ')
  await ui.waitFor((frame) => frame.includes('[x] model-two'))
  await ui.send('three')
  await ui.waitFor((frame) => frame.includes('筛选 (1/3)'))
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('同时添加') && frame.includes('model-two'))
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('已保存并切换模型'))
  assert.equal(ui.configStore.load().models.length, 2)
  assert.equal(ui.credentialStore.list().length, 1)
  assert.equal(ui.config().model, 'model-one')

  await openModels(ui)
  await ui.waitFor((frame) => frame.includes('A 添加同组模型') && frame.includes('model-two'))
  await ui.send('a')
  await ui.waitFor((frame) => frame.includes('筛选') && frame.includes('model-three'))
  await ui.send('three')
  await ui.waitFor((frame) => frame.includes('筛选 (1/3)'))
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('沿用已存端点与密钥') && frame.includes('model-three'))
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('已保存并切换模型'))
  assert.equal(ui.configStore.load().models.length, 3)
  assert.equal(ui.credentialStore.list().length, 1)
  assert.equal(ui.config().model, 'model-three')
  assert.equal(ui.config().apiKey, 'fixture-shared-key')
  assert.deepEqual(requests, [
    { endpoint: 'https://api.deepseek.com/models', key: 'fixture-shared-key' },
    { endpoint: 'https://api.deepseek.com/models', key: 'fixture-shared-key' }
  ])
  assert.doesNotMatch(ui.raw(), /fixture-shared-key/)
})
