import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('text file uses LF endings only', () => {
  const content = readFileSync(new URL('../src/text.txt', import.meta.url), 'utf8')
  assert.equal(content.includes('\r'), false)
  assert.equal(content, 'line1\nline2\n')
})
