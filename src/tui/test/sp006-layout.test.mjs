import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_REGIONS,
  displayWidth,
  planLayout,
  regionsFor,
} from '../dist/tui/render/layout.js'

test('TU-01 四区顺序固定：header → transcript → input → footer', () => {
  const plan = planLayout({ columns: 100, rows: 40, regions: regionsFor({ headerVisible: true }) })
  assert.deepEqual(
    plan.regions.map((r) => r.id),
    ['header', 'transcript', 'input', 'footer'],
  )
  let top = 0
  for (const region of plan.regions) {
    assert.equal(region.top, top, '区域 top 必须连续')
    top += region.height
  }
  assert.equal(plan.totalHeight, top)
})

test('TU-01 40 行：页脚 1 行、输入区 3 行、其余给消息区', () => {
  const plan = planLayout({ columns: 100, rows: 40, regions: regionsFor({ headerVisible: true, headerHeight: 8 }) })
  const byId = Object.fromEntries(plan.regions.map((r) => [r.id, r]))
  assert.equal(byId.footer.height, 1)
  assert.equal(byId.input.height, 3)
  assert.equal(byId.header.height, 8)
  assert.equal(byId.transcript.height, 28)
  assert.equal(plan.totalHeight, 40)
  assert.equal(plan.overflow, 'none')
})

test('TU-02 首屏在消息区为空时占行，消息非空时折叠为 0 行', () => {
  const empty = planLayout({ columns: 100, rows: 24, regions: regionsFor({ headerVisible: true, headerHeight: 6 }) })
  const busy = planLayout({ columns: 100, rows: 24, regions: regionsFor({ headerVisible: false }) })
  assert.equal(empty.regions[0].height, 6)
  assert.equal(busy.regions[0].height, 0)
  assert.ok(busy.regions[1].height > empty.regions[1].height)
})

test('TU-02 resize 到 60 行仍满足不变量', () => {
  for (const rows of [24, 40, 60]) {
    const plan = planLayout({ columns: 80, rows, regions: regionsFor({ headerVisible: true, headerHeight: 5 }) })
    const byId = Object.fromEntries(plan.regions.map((r) => [r.id, r]))
    assert.equal(plan.totalHeight, rows)
    assert.ok(byId.input.height >= 3, '输入区不得低于 3 行')
    assert.equal(byId.footer.height, 1)
    assert.ok(byId.transcript.height >= 1)
  }
})

test('TU-02 行数不足时先压缩消息区并标记 overflow=transcript', () => {
  const plan = planLayout({ columns: 80, rows: 6, regions: regionsFor({ headerVisible: true, headerHeight: 6 }) })
  const byId = Object.fromEntries(plan.regions.map((r) => [r.id, r]))
  assert.equal(byId.transcript.height, 1, '消息区被压到最小 1 行')
  assert.equal(byId.input.height, 3, '输入区保持最小 3 行')
  assert.equal(byId.footer.height, 1)
  assert.equal(plan.overflow, 'transcript')
})

test('TU-11 CJK 宽度按双宽计算', () => {
  assert.equal(displayWidth('中文abc'), 7)
  assert.equal(displayWidth('abc'), 3)
  assert.equal(displayWidth('a中b'), 4)
})

test('DEFAULT_REGIONS 与 regionsFor 契约稳定', () => {
  assert.deepEqual(DEFAULT_REGIONS.map((r) => r.id), ['header', 'transcript', 'input', 'footer'])
  const hidden = regionsFor({ headerVisible: false })
  assert.equal(hidden[0].minHeight, 0)
  assert.equal(hidden[0].maxHeight, 0)
})
