import test from 'node:test'
import assert from 'node:assert/strict'
import { sum } from '../src/calc.js'

test('sum adds all values', () => {
  assert.equal(sum([1, 2, 3]), 6)
  assert.equal(sum([]), 0)
})
