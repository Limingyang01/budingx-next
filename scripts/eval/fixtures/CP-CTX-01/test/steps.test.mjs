import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatAmount } from '../src/steps/step1.ts'
import { roundAmount } from '../src/steps/step2.ts'
import { totalOf } from '../src/steps/step3.ts'
import { reportLine } from '../src/steps/step4.ts'

test('第一步：金额保留两位小数', () => {
  assert.equal(formatAmount(1.5), '1.50')
  assert.equal(formatAmount(2), '2.00')
})

test('第二步：金额按两位小数舍入', () => {
  assert.equal(roundAmount(1.239), 1.24)
  assert.equal(roundAmount(2.344), 2.34)
})

test('第三步：合计等于各项之和', () => {
  assert.equal(totalOf([1.5, 2.25]), 3.75)
  assert.equal(totalOf([]), 0)
})

test('第四步：报表行包含合计', () => {
  assert.equal(reportLine([1.5, 2.25]), 'total=3.75')
})
