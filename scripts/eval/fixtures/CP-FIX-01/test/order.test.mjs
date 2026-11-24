import assert from 'node:assert/strict'
import { test } from 'node:test'
import { totalFor } from '../src/order.ts'

test('有五位邮编时免运费', () => {
  const order = {
    id: 'o1',
    items: [{ sku: 'a', price: 10, qty: 2 }],
    customer: { name: 'x', address: { zip: '12345' } }
  }
  assert.equal(totalFor(order), 20)
})

test('缺少地址时不得抛空指针，按非五位邮编计运费', () => {
  const order = {
    id: 'o2',
    items: [{ sku: 'a', price: 10, qty: 1 }],
    customer: { name: 'x' }
  }
  assert.equal(totalFor(order), 18)
})
