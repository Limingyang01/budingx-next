import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatMoney as a } from '../src/a.ts'
import { formatMoney as b } from '../src/b.ts'
import { formatMoney as c } from '../src/c.ts'
import { formatMoney as shared } from '../src/shared/money.ts'

test('三个模块的金额格式化行为一致', () => {
  for (const fn of [a, b, c]) {
    assert.equal(fn(1234.5), '1,234.50')
    assert.equal(fn(0), '0.00')
    assert.equal(fn(-12.3), '-12.30')
  }
})

test('三个模块复用同一份实现', () => {
  assert.equal(a, shared)
  assert.equal(b, shared)
  assert.equal(c, shared)
})
