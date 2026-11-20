import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runCommand } from '../dist/tui/commands.js'
import { ConfigStore } from '../dist/storage/config-store.js'
import { CredentialStore } from '../dist/storage/credentials.js'
import { createProfile } from '../dist/storage/profiles.js'

function context(lang) {
  const home = mkdtempSync(join(tmpdir(), 'budingx-commands-zh-'))
  mkdirSync(join(home, '.budingx'), { recursive: true })
  const configStore = new ConfigStore(join(home, '.budingx', 'config.json'))
  const credentialStore = new CredentialStore(join(home, '.budingx', 'credentials.json'))
  const cleared = []
  const config = {
    baseUrl: 'https://api.example.test/v1',
    model: 'model-one',
    apiKey: 'sk-secret-value',
    timeoutMs: 120000,
    source: 'env'
  }
  return {
    configStore,
    cleared,
    config,
    ctx: {
      session: { clearHistory: () => cleared.push(true) },
      configStore,
      credentialStore,
      getConfig: () => config,
      setConfig: (next) => Object.assign(config, next),
      exit: () => {},
      ...(lang ? { lang } : {})
    }
  }
}

test('zh：/help 与 /clear 与未知命令回显中文', async () => {
  const { ctx } = context('zh')
  const help = await runCommand('/help', ctx)
  assert.match(help.message, /命令：/)
  assert.match(help.message, /\/models/)
  const clear = await runCommand('/clear', ctx)
  assert.equal(clear.message, '会话已清空（项目规则保留）')
  const unknown = await runCommand('/nope', ctx)
  assert.equal(unknown.error, '未知命令；使用 /help')
})

test('zh：/config 中文标签且仍掩码密钥', async () => {
  const { ctx } = context('zh')
  const outcome = await runCommand('/config', ctx)
  assert.match(outcome.message, /端点：https:\/\/api\.example\.test\/v1/)
  assert.match(outcome.message, /模型：model-one/)
  assert.match(outcome.message, /密钥：…alue/)
  assert.ok(!outcome.message.includes('sk-secret-value'))
})

test('zh：/model 切换中文回显且不清史', async () => {
  const { ctx, configStore, cleared } = context('zh')
  const stored = configStore.load()
  const profile = createProfile({
    label: 'second',
    baseUrl: 'https://api.example.test/v1',
    model: 'model-two'
  })
  stored.models.push(profile)
  configStore.save(stored)
  const outcome = await runCommand('/model second', ctx)
  assert.equal(outcome.message, '已切换到 second；会话保留，自下一回合生效')
  assert.equal(cleared.length, 0)
})

test('zh：/models 使用说明和已移除命令反馈', async () => {
  const { ctx } = context('zh')
  assert.match((await runCommand('/models extra', ctx)).error, /用法：\/models/)
  assert.match((await runCommand('/provider add', ctx)).error, /未知命令/)
})

test('默认（无 lang）保持英文，管道/机器面不受中文化影响', async () => {
  const { ctx } = context()
  const clear = await runCommand('/clear', ctx)
  assert.equal(clear.message, 'Conversation cleared (project rules kept)')
  const help = await runCommand('/help', ctx)
  assert.match(help.message, /Commands:/)
})
