// Line diff tests (SP003 AC CP-01/CP-02, plan T7).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diffLines, diffSummary } from '../../tui/dist/workspace/diff.js'

test('a single changed line becomes one hunk with numbers', () => {
  const hunks = diffLines('a\nb\nc\n', 'a\nB\nc\n')
  assert.equal(hunks.length, 1)
  const [hunk] = hunks
  assert.equal(hunk.oldStart, 1)
  assert.equal(hunk.newStart, 1)
  assert.deepEqual(
    hunk.lines.map((line) => line.type),
    ['context', 'remove', 'add', 'context']
  )
  const removed = hunk.lines.find((line) => line.type === 'remove')
  assert.equal(removed.oldNo, 2)
  assert.equal(removed.newNo, undefined)
  const added = hunk.lines.find((line) => line.type === 'add')
  assert.equal(added.newNo, 2)
})

test('identical content produces no hunks', () => {
  assert.deepEqual(diffLines('same\ncontent\n', 'same\ncontent\n'), [])
})

test('context is bounded and far-apart changes split into separate hunks', () => {
  const oldLines = Array.from({ length: 20 }, (_, i) => `l${i + 1}`)
  const newLines = [...oldLines]
  newLines[1] = 'CHANGED-2'
  newLines[17] = 'CHANGED-18'
  const hunks = diffLines(oldLines.join('\n') + '\n', newLines.join('\n') + '\n', 3)
  assert.equal(hunks.length, 2)
  assert.equal(hunks[0].oldStart, 1)
  assert.ok(hunks[0].lines.length <= 7)
  const second = hunks[1]
  assert.ok(second.oldStart > 10)
})

test('pure addition and pure removal get correct counts', () => {
  const addOnly = diffLines('a\nb\n', 'a\nx\nb\n')
  assert.deepEqual(diffSummary(addOnly), { additions: 1, removals: 0 })
  const removeOnly = diffLines('a\nx\nb\n', 'a\nb\n')
  assert.deepEqual(diffSummary(removeOnly), { additions: 0, removals: 1 })
})

test('a very large middle range falls back to one replacement block', () => {
  const oldLines = Array.from({ length: 900 }, (_, i) => `o${i}`)
  const newLines = Array.from({ length: 900 }, (_, i) => `n${i}`)
  const hunks = diffLines(oldLines.join('\n'), newLines.join('\n'))
  const summary = diffSummary(hunks)
  assert.equal(summary.additions, 900)
  assert.equal(summary.removals, 900)
})

test('CRLF differences do not show up as content changes', () => {
  assert.deepEqual(diffLines('a\r\nb\r\n', 'a\nb\n'), [])
})
