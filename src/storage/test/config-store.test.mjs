import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ConfigStore } from '../../tui/dist/storage/config-store.js'
import { createProfile, maskKey, mergeSources } from '../../tui/dist/storage/profiles.js'

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'budingx-storage-'))
  mkdirSync(join(home, '.budingx'), { recursive: true })
  return home
}

function configFile(home) {
  return join(home, '.budingx', 'config.json')
}

test('档案 CRUD 持久化并跨实例加载，写入为原子且不留半写文件', () => {
  const home = tempHome()
  const file = configFile(home)
  const store = new ConfigStore(file)
  const profile = createProfile({
    label: 'primary',
    baseUrl: 'https://api.example.test/v1',
    model: 'model-one'
  })
  store.save({ version: 1, defaultModelId: profile.id, models: [profile] })

  const reloaded = new ConfigStore(file).load()
  assert.equal(reloaded.version, 1)
  assert.equal(reloaded.models.length, 1)
  assert.equal(reloaded.models[0].id, profile.id)
  assert.equal(reloaded.defaultModelId, profile.id)

  const siblings = readdirSync(join(home, '.budingx'))
  assert.equal(siblings.includes('config.json.tmp'), false)
  assert.equal(siblings.filter((name) => name.endsWith('.tmp')).length, 0)
})

test('配置文件带 schema 版本字段', () => {
  const home = tempHome()
  const file = configFile(home)
  new ConfigStore(file).save({ version: 1, models: [] })
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(raw.version, 1)
})

test('未知字段按声明策略保留', () => {
  const home = tempHome()
  const file = configFile(home)
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      models: [
        {
          id: 'm1',
          label: 'x',
          baseUrl: 'https://api.example.test/v1',
          model: 'm',
          apiKeyRef: 'm1',
          capabilities: { tools: true },
          createdAt: 'now',
          updatedAt: 'now',
          futureField: 'keep me'
        }
      ],
      futureTopLevel: 'keep me too'
    })
  )
  const loaded = new ConfigStore(file).load()
  assert.equal(loaded.futureTopLevel, 'keep me too')
  assert.equal(loaded.models[0].futureField, 'keep me')
})

test('损坏的配置被备份并明确报错，不静默清空用户配置', () => {
  const home = tempHome()
  const file = configFile(home)
  writeFileSync(file, '{ this is not json')
  const store = new ConfigStore(file)
  assert.throws(() => store.load(), /corrupt/i)
  assert.equal(readFileSync(file, 'utf8'), '{ this is not json')
  assert.equal(readFileSync(file + '.bak', 'utf8'), '{ this is not json')
})

test('旧版本配置迁移到当前版本并保留备份', () => {
  const home = tempHome()
  const file = configFile(home)
  writeFileSync(
    file,
    JSON.stringify({
      version: 0,
      baseUrl: 'https://a.test/v1',
      model: 'legacy-model'
    })
  )
  const loaded = new ConfigStore(file).load()
  assert.equal(loaded.version, 1)
  assert.equal(loaded.models.length, 1)
  assert.equal(loaded.models[0].model, 'legacy-model')
  assert.equal(JSON.parse(readFileSync(file + '.bak', 'utf8')).version, 0)
})

test('更新的 schema 版本被明确拒绝而不是猜测解析', () => {
  const home = tempHome()
  const file = configFile(home)
  writeFileSync(file, JSON.stringify({ version: 99, models: [] }))
  assert.throws(() => new ConfigStore(file).load(), /newer than supported/i)
})

test('非法档案输入被显式拒绝', () => {
  assert.throws(
    () => createProfile({ label: '', baseUrl: 'https://a.test/v1', model: 'm' }),
    /label is required/i
  )
  assert.throws(
    () =>
      createProfile({
        label: 'x'.repeat(65),
        baseUrl: 'https://a.test/v1',
        model: 'm'
      }),
    /too long/i
  )
  assert.throws(
    () =>
      createProfile({
        label: 'bad' + String.fromCharCode(7) + 'label',
        baseUrl: 'https://a.test/v1',
        model: 'm'
      }),
    /control characters/i
  )
  assert.throws(
    () =>
      createProfile({
        label: 'ok',
        baseUrl: 'https://user:secret@a.test/v1',
        model: 'm'
      }),
    /credentials/i
  )
  assert.throws(
    () =>
      createProfile({ label: 'ok', baseUrl: 'http://a.test/v1', model: 'm' }),
    /HTTPS/i
  )
  assert.throws(
    () => createProfile({ label: 'ok', baseUrl: 'https://a.test/v1', model: '' }),
    /Model name is required/i
  )
})

test('配置来源优先级为 CLI > 环境变量 > 档案文件', () => {
  const profile = createProfile({
    label: 'file',
    baseUrl: 'https://file.test/v1',
    model: 'file-model'
  })
  const resolved = mergeSources({
    args: ['--model', 'cli-model'],
    env: { BUDINGX_BASE_URL: 'https://env.test/v1', BUDINGX_API_KEY: 'env-key' },
    file: {
      profileId: profile.id,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey: 'file-key'
    }
  })
  assert.equal(resolved.model, 'cli-model')
  assert.equal(resolved.baseUrl, 'https://env.test/v1')
  assert.equal(resolved.apiKey, 'env-key')
  assert.equal(resolved.source, 'cli')

  const envOnly = mergeSources({
    args: [],
    env: { BUDINGX_MODEL: 'env-model' },
    file: {
      baseUrl: 'https://file.test/v1',
      model: 'file-model',
      apiKey: 'file-key'
    }
  })
  assert.equal(envOnly.model, 'env-model')
  assert.equal(envOnly.baseUrl, 'https://file.test/v1')
  assert.equal(envOnly.apiKey, 'file-key')

  const fileOnly = mergeSources({
    args: [],
    env: {},
    file: {
      baseUrl: 'https://file.test/v1',
      model: 'file-model',
      apiKey: 'file-key'
    }
  })
  assert.equal(fileOnly.model, 'file-model')
  assert.equal(fileOnly.source, 'file')
})

test('0.1.1 的环境变量用法保持可用', () => {
  const resolved = mergeSources({
    args: [],
    env: {
      BUDINGX_BASE_URL: 'http://127.0.0.1:8080/v1',
      BUDINGX_MODEL: 'legacy-model',
      BUDINGX_API_KEY: 'legacy-key'
    }
  })
  assert.equal(resolved.baseUrl, 'http://127.0.0.1:8080/v1')
  assert.equal(resolved.model, 'legacy-model')
  assert.equal(resolved.apiKey, 'legacy-key')
})

test('UI 回显仅显示末 4 位', () => {
  assert.equal(maskKey('sk-1234567890'), '…7890')
  assert.equal(maskKey('abc'), '***')
  assert.equal(maskKey(undefined), '(not set)')
  assert.equal(maskKey(''), '(not set)')
})
