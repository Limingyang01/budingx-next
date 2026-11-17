import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ConfigStore } from '../../tui/dist/storage/config-store.js'
import { CredentialStore } from '../../tui/dist/storage/credentials.js'
import { createProfile, profileHost } from '../../tui/dist/storage/profiles.js'

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'budingx-credentials-'))
  mkdirSync(join(home, '.budingx'), { recursive: true })
  return home
}

test('key 仅存于专用凭据文件，普通配置不含 key', () => {
  const home = tempHome()
  const configFile = join(home, '.budingx', 'config.json')
  const credentialFile = join(home, '.budingx', 'credentials.json')
  const profile = createProfile({
    label: 'primary',
    baseUrl: 'https://api.example.test/v1',
    model: 'model-one'
  })
  new ConfigStore(configFile).save({ version: 1, models: [profile] })
  const credentials = new CredentialStore(credentialFile)
  credentials.set(profile.id, profileHost(profile), 'sk-secret-value')

  const configRaw = readFileSync(configFile, 'utf8')
  assert.equal(configRaw.includes('sk-secret-value'), false)
  const credentialRaw = readFileSync(credentialFile, 'utf8')
  assert.equal(credentialRaw.includes('sk-secret-value'), true)
})

test('凭据与主机绑定，主机不符时视为无 key', () => {
  const home = tempHome()
  const credentialFile = join(home, '.budingx', 'credentials.json')
  const credentials = new CredentialStore(credentialFile)
  credentials.set('m1', 'api.example.test', 'sk-secret-value')
  assert.equal(credentials.get('m1', 'api.example.test'), 'sk-secret-value')
  assert.equal(credentials.get('m1', 'other.example.test'), undefined)
  assert.equal(credentials.get('unknown', 'api.example.test'), undefined)
})

test('删除档案连带删除其 key', () => {
  const home = tempHome()
  const credentialFile = join(home, '.budingx', 'credentials.json')
  const credentials = new CredentialStore(credentialFile)
  credentials.set('m1', 'api.example.test', 'sk-secret-value')
  assert.equal(credentials.list().length, 1)
  credentials.remove('m1')
  assert.equal(credentials.list().length, 0)
  assert.equal(credentials.get('m1', 'api.example.test'), undefined)
})

test('孤儿 key 被诊断出来而不是静默删除', () => {
  const home = tempHome()
  const credentialFile = join(home, '.budingx', 'credentials.json')
  const credentials = new CredentialStore(credentialFile)
  credentials.set('m1', 'api.example.test', 'sk-one')
  credentials.set('orphan', 'api.example.test', 'sk-two')
  const orphans = credentials.orphanIds(['m1'])
  assert.deepEqual(orphans, ['orphan'])
  assert.equal(credentials.list().length, 2)
})

test('档案主机变更后旧 key 不会被取用', () => {
  const home = tempHome()
  const credentialFile = join(home, '.budingx', 'credentials.json')
  const credentials = new CredentialStore(credentialFile)
  const profile = createProfile({
    label: 'primary',
    baseUrl: 'https://api.example.test/v1',
    model: 'model-one'
  })
  credentials.set(profile.id, profileHost(profile), 'sk-secret-value')
  const moved = {
    ...profile,
    baseUrl: 'https://other.example.test/v1'
  }
  assert.equal(
    credentials.get(moved.id, profileHost(moved)),
    undefined,
    'a key must not be forwarded to a different host'
  )
})

test('凭据文件损坏时报错且不静默覆盖', () => {
  const home = tempHome()
  const credentialFile = join(home, '.budingx', 'credentials.json')
  writeFileSync(credentialFile, 'not json at all')
  const credentials = new CredentialStore(credentialFile)
  assert.throws(() => credentials.load(), /corrupt/i)
  assert.equal(readFileSync(credentialFile, 'utf8'), 'not json at all')
})

test('凭据文件所在目录不存在时按需创建', () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-credentials-'))
  const credentialFile = join(home, '.budingx', 'credentials.json')
  const credentials = new CredentialStore(credentialFile)
  credentials.set('m1', 'api.example.test', 'sk-value')
  assert.equal(credentials.get('m1', 'api.example.test'), 'sk-value')
})
