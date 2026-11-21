import test from 'node:test'
import assert from 'node:assert/strict'

import { createFreezeCache } from '../dist/tui/render/freeze-cache.js'

const entry = (id, width, text = id) => ({ id, width, lines: [text], hash: text + ':' + width })

test('TU-04 同 id 同宽度命中并返回同一引用', () => {
  const cache = createFreezeCache()
  const value = entry('m1', 80)
  cache.set(value)
  const hit = cache.get('m1', 80)
  assert.equal(hit, value)
  assert.equal(cache.get('m1', 80), value)
})

test('TU-04 宽度变化即失效', () => {
  const cache = createFreezeCache()
  cache.set(entry('m1', 80))
  assert.equal(cache.get('m1', 60), undefined)
})

test('TU-04 invalidate/clear/size 行为', () => {
  const cache = createFreezeCache()
  cache.set(entry('a', 80))
  cache.set(entry('b', 80))
  assert.equal(cache.size(), 2)
  cache.invalidate('a')
  assert.equal(cache.get('a', 80), undefined)
  assert.equal(cache.size(), 1)
  cache.clear()
  assert.equal(cache.size(), 0)
})

test('TU-04 超过上限按插入序淘汰最旧条目', () => {
  const cache = createFreezeCache(2)
  cache.set(entry('a', 80))
  cache.set(entry('b', 80))
  cache.set(entry('c', 80))
  assert.equal(cache.size(), 2)
  assert.equal(cache.get('a', 80), undefined)
  assert.ok(cache.get('b', 80))
  assert.ok(cache.get('c', 80))
})
