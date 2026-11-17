import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diagnosticText } from '../../../scripts/testing/diagnostic.mjs'

test('真实测试日志截断边界不能保留密钥片段', () => {
  const text = 'x'.repeat(1995) + 'fixture-secret-key'
  const result = diagnosticText(text, 'fixture-secret-key')
  assert.equal(result.includes('fixtu'), false)
  assert.ok(result.length <= 2000)
  assert.equal(diagnosticText('fixture-secret-key', 'fixture-secret-key'), '[REDACTED]')
})
