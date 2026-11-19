// SP004 agent-observability T27：脱敏与合法 JSON 裁剪。
// 覆盖 OB-17、OB-18、OB-19。核心约束：先脱敏，再从脱敏结构裁剪。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { redactValue } from '../../tui/dist/observability/redact.js'

const REDACTED = '[redacted]'

test('sensitive keys have their values replaced', () => {
  const out = JSON.parse(
    redactValue({
      api_key: 'plain-value',
      secret: 'plain-value',
      password: 'plain-value',
      token: 'plain-value',
      authorization: 'plain-value',
      cookie: 'plain-value',
      private_key: 'plain-value',
      keep: 'visible'
    })
  )
  assert.equal(out.api_key, REDACTED)
  assert.equal(out.secret, REDACTED)
  assert.equal(out.password, REDACTED)
  assert.equal(out.token, REDACTED)
  assert.equal(out.authorization, REDACTED)
  assert.equal(out.cookie, REDACTED)
  assert.equal(out.private_key, REDACTED)
  assert.equal(out.keep, 'visible')
})

test('credential shaped strings inside values are replaced', () => {
  const out = JSON.parse(
    redactValue({
      a: 'Bearer abcdef123456',
      b: 'sk-abcdefghijklmnop',
      c: 'ghp_abcdefghijklmnopqrstuvwxyz012345',
      d: 'github_pat_abcdefghijklmnopqrstuvwxyz0123456789',
      e: 'AKIAIOSFODNN7EXAMPLE',
      f: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      g: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----'
    })
  )
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
    assert.ok(out[key].includes(REDACTED), `${key} must be redacted, got ${out[key]}`)
  }
})

test('a known secret literal is replaced', () => {
  const secret = 'super-secret-value-12345'
  const out = JSON.parse(redactValue({ note: `token is ${secret} here` }, [secret]))
  assert.ok(!out.note.includes(secret))
  assert.ok(out.note.includes(REDACTED))
})

test('a short known value is not replaced', () => {
  const short = 'abc'
  const out = JSON.parse(redactValue({ note: `value ${short} here` }, [short]))
  assert.equal(out.note, 'value abc here')
})

test('a known secret inside a sensitive key is replaced', () => {
  const secret = 'super-secret-value-12345'
  const out = JSON.parse(redactValue({ api_key: secret }, [secret]))
  assert.equal(out.api_key, REDACTED)
})

test('an oversized message array keeps roles and stays valid json', () => {
  const messages = []
  for (let i = 0; i < 30; i++) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'x'.repeat(2000) })
  }
  const encoded = redactValue(messages)
  assert.ok(encoded.length <= 8000, `length ${encoded.length} must be <= 8000`)
  const parsed = JSON.parse(encoded)
  assert.ok(Array.isArray(parsed))
  assert.ok(parsed.length <= 8, 'at most 8 messages are kept')
  const first = parsed[0]
  assert.equal(typeof first.role, 'string')
  assert.ok(first.role.length > 0)
  assert.ok(first.content.includes('[truncated]'))
})

test('a secret in the kept prefix of an oversized message never reaches the output', () => {
  const secret = 'super-secret-value-12345'
  const messages = []
  for (let i = 0; i < 30; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `prefix ${secret} ` + 'y'.repeat(2000)
    })
  }
  const encoded = redactValue(messages, [secret])
  assert.ok(!encoded.includes(secret), 'the secret must not survive into the output')
  const parsed = JSON.parse(encoded)
  assert.ok(parsed.every((row) => !JSON.stringify(row).includes(secret)))
})

test('an oversized plain object is truncated into a preview and stays valid json', () => {
  const encoded = redactValue({ blob: 'z'.repeat(20000) })
  assert.ok(encoded.length <= 8000, `length ${encoded.length} must be <= 8000`)
  const parsed = JSON.parse(encoded)
  assert.equal(parsed.truncated, true)
  assert.equal(typeof parsed.preview, 'string')
})

test('a circular value returns a valid json error marker instead of throwing', () => {
  const circular = { name: 'loop' }
  circular.self = circular
  const encoded = redactValue(circular)
  const parsed = JSON.parse(encoded)
  assert.ok(parsed !== null)
  assert.ok(!encoded.includes('loop'), 'the original text must not leak')
})

test('short content is returned unchanged without a truncated marker', () => {
  const encoded = redactValue({ hello: 'world' })
  assert.equal(encoded, '{"hello":"world"}')
  assert.ok(!encoded.includes('truncated'))
})

test('nested structures are redacted at any depth', () => {
  const out = JSON.parse(
    redactValue({ level1: { level2: { api_key: 'plain-value', ok: 1 } } })
  )
  assert.equal(out.level1.level2.api_key, REDACTED)
  assert.equal(out.level1.level2.ok, 1)
})

test('arrays of objects are redacted element wise', () => {
  const out = JSON.parse(redactValue([{ password: 'plain-value' }, { fine: true }]))
  assert.equal(out[0].password, REDACTED)
  assert.equal(out[1].fine, true)
})

test('the output is always parseable json for assorted inputs', () => {
  const inputs = [
    null,
    undefined,
    42,
    'plain',
    [],
    {},
    { a: [1, 2, { b: 'c' }] },
    { nested: { deep: { deeper: 'value' } } }
  ]
  for (const input of inputs) {
    const encoded = redactValue(input)
    assert.doesNotThrow(() => JSON.parse(encoded), `input ${JSON.stringify(input)} must parse`)
  }
})
