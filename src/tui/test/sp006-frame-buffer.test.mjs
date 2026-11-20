import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createFrameBuffer,
  diffFrameLines,
  diffFrames,
  resizeFrameBuffer,
} from '../dist/tui/render/frame-buffer.js'

test('TU-03 首次渲染输出全部行', () => {
  const next = createFrameBuffer(20, 3, ['a', 'b', 'c'])
  assert.deepEqual(diffFrames(null, next), ['a', 'b', 'c'])
})

test('TU-03 相同帧不产出补丁', () => {
  const prev = createFrameBuffer(20, 3, ['a', 'b', 'c'])
  const next = createFrameBuffer(20, 3, ['a', 'b', 'c'])
  assert.deepEqual(diffFrames(prev, next), [])
})

test('TU-03 单行变化只重写该行', () => {
  const prev = createFrameBuffer(20, 3, ['a', 'b', 'c'])
  const next = createFrameBuffer(20, 3, ['a', 'B', 'c'])
  const result = diffFrameLines(prev, next)
  assert.deepEqual(result.lines, ['B'])
  assert.deepEqual(result.indexes, [1])
  assert.equal(result.reflow, false)
})

test('TU-03 宽度变化触发全量重写并标记 reflow', () => {
  const prev = createFrameBuffer(20, 2, ['a', 'b'])
  const next = resizeFrameBuffer(prev, 30, 2, ['a', 'b'])
  const result = diffFrameLines(prev, next)
  assert.equal(result.reflow, true)
  assert.equal(result.lines.length, 2)
})

test('createFrameBuffer 按高度补齐空白行', () => {
  const buf = createFrameBuffer(10, 4, ['x'])
  assert.equal(buf.lines.length, 4)
  assert.equal(buf.lines[0], 'x')
  assert.deepEqual(buf.lines.slice(1), ['', '', ''])
  assert.equal(buf.version, 1)
})

test('resizeFrameBuffer 更换宽度与内容并递增版本', () => {
  const buf = createFrameBuffer(10, 2, ['a', 'b'])
  const resized = resizeFrameBuffer(buf, 12, 3)
  assert.equal(resized.width, 12)
  assert.equal(resized.height, 3)
  assert.equal(resized.lines.length, 3)
  assert.equal(resized.version, buf.version + 1)
})
