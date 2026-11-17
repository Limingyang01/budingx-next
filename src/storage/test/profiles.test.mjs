import assert from 'node:assert/strict'
import { mergeSources } from '../../tui/dist/storage/profiles.js'
import { test } from 'node:test'
import {
  loadConfig,
  normalizeBaseUrl,
  profileHost
} from '../../tui/dist/storage/profiles.js'

test('配置归一化端点并拒绝凭据泄漏与不安全的远端地址', () => {
  assert.equal(normalizeBaseUrl('https://example.test/v1/'), 'https://example.test/v1')
  assert.equal(normalizeBaseUrl('http://localhost:1234/v1'), 'http://localhost:1234/v1')
  for (const url of [
    'http://example.test/v1',
    'https://user:secret@example.test/v1',
    'https://example.test/v1?key=secret',
    'file:///x'
  ]) {
    assert.throws(() => normalizeBaseUrl(url))
  }
})

test('配置只读取显式的 BUDINGX_ 环境变量并校验参数', () => {
  const config = loadConfig(
    ['--model', 'my-model', '--base-url', 'https://example.test/v1'],
    { BUDINGX_API_KEY: 'test-only-key', OPENAI_API_KEY: 'not-read' }
  )
  assert.equal(config.model, 'my-model')
  assert.equal(config.apiKey, 'test-only-key')
  assert.equal(loadConfig([], { OPENAI_API_KEY: 'not-read' }).apiKey, '')
  assert.throws(() => loadConfig(['--unknown'], {}), /Unknown/)
  assert.throws(() => loadConfig(['--model'], {}), /value/)
  assert.throws(() => loadConfig(['--timeout', 'NaN'], {}), /timeout/i)
})

test('档案主机名用于凭据绑定', () => {
  assert.equal(
    profileHost({
      id: 'm1',
      label: 'x',
      baseUrl: 'https://api.example.test/v1',
      model: 'm',
      apiKeyRef: 'm1',
      capabilities: { tools: true },
      createdAt: '',
      updatedAt: ''
    }),
    'api.example.test'
  )
})

test('配置覆盖端点不复用其他主机的文件凭据', () => {
  const resolved = mergeSources({
    args: ['--base-url', 'https://other.invalid/v1'],
    env: {},
    file: { baseUrl: 'https://one.invalid/v1', model: 'm', apiKey: 'file-key' }
  })
  assert.equal(resolved.apiKey, '')
})
