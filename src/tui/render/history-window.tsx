import { Box, useBoxMetrics, type DOMElement } from 'ink'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import stringWidth from 'string-width'
import { TranscriptMessage } from './transcript.js'
import type { ToolTranscriptEntry, TranscriptEntry } from './types.js'

const virtualThreshold = 64

export function collapseReadSearch(entries: readonly TranscriptEntry[], ascii: boolean): TranscriptEntry[] {
  const result: TranscriptEntry[] = []
  let group: ToolTranscriptEntry[] = []
  function flush() {
    if (group.length < 2) result.push(...group)
    else {
      const names = [...new Set(group.map((entry) => entry.text.split('(')[0]))]
      result.push({
        ...group[0],
        text: ascii ? `${group.length} read/search calls (${names.join(', ')})`
          : `${group.length} 次读取／搜索（${names.join('、')}）`,
        elapsedMs: undefined,
        result: ascii ? 'Ctrl+O to expand' : 'Ctrl+O 展开详情'
      })
    }
    group = []
  }
  for (const entry of entries) {
    if (entry.kind === 'tool' && entry.status === 'success' && /^(Read|Glob|Grep)\(/.test(entry.text)) {
      if (group.length && group[0].turnId !== entry.turnId) flush()
      group.push(entry)
    } else {
      if (group.length) flush()
      result.push(entry)
    }
  }
  if (group.length) flush()
  return result
}

export function visibleHistoryRange(
  offsets: readonly number[], offset: number, height: number
): { start: number; end: number } {
  function firstAfter(row: number): number {
    let low = 0
    let high = offsets.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (offsets[middle] <= row) low = middle + 1
      else high = middle
    }
    return low
  }
  const overscan = Math.max(10, height)
  const start = Math.max(0, Math.min(offsets.length - 2, firstAfter(offset - overscan) - 1))
  const end = Math.min(offsets.length - 1, Math.max(start + 1, firstAfter(offset + height + overscan)))
  return { start, end }
}

function estimate(entry: TranscriptEntry, width: number): number {
  const columns = Math.max(1, width - 4)
  if (entry.kind === 'tool') return entry.result ? 3 : 2
  const rows = entry.text.split('\n').reduce((total, line) =>
    total + Math.max(1, Math.ceil(stringWidth(line) / columns)), 0)
  return rows + (entry.kind === 'plain' ? 0 : 1)
}

function MeasuredMessage({
  entry, index, ascii, expanded, measure
}: {
  entry: TranscriptEntry
  index: number
  ascii: boolean
  expanded: boolean
  measure(entry: TranscriptEntry, index: number, height: number): void
}) {
  const box = useRef<DOMElement>(null)
  const layout = useBoxMetrics(box)
  useEffect(() => {
    if (layout.hasMeasured) measure(entry, index, layout.height)
  }, [layout.hasMeasured, layout.height, entry, index, measure])
  return <Box flexShrink={0} flexDirection="column" ref={box}>
    <TranscriptMessage entry={entry} ascii={ascii} expanded={expanded} />
  </Box>
}

export function HistoryWindow({
  entries, width, offset, height, ascii, fullScreen, expanded, targetIndex, onTargetOffset, onPriorRowsChanged
}: {
  entries: readonly TranscriptEntry[]
  width: number
  offset: number
  height: number
  ascii: boolean
  fullScreen: boolean
  expanded: boolean
  targetIndex?: number
  onTargetOffset(rows: number): void
  onPriorRowsChanged(delta: number): void
}) {
  const measured = useMemo(() => new WeakMap<TranscriptEntry, number>(), [width, expanded])
  const estimates = useMemo(() => new WeakMap<TranscriptEntry, number>(), [width])
  const [revision, revise] = useState(0)
  const adjustBeforeViewport = useEffectEvent((index: number, delta: number) => {
    if (virtual && delta !== 0 && offsets[index + 1] <= offset) onPriorRowsChanged(delta)
  })
  const measure = useCallback((entry: TranscriptEntry, index: number, rows: number) => {
    const previous = measured.get(entry)
    if (previous === rows) return
    measured.set(entry, rows)
    const estimated = previous ?? estimates.get(entry)
    if (estimated !== undefined) adjustBeforeViewport(index, rows - estimated)
    revise((value) => value + 1)
  }, [measured, estimates])
  const virtual = fullScreen && entries.length >= virtualThreshold
  const offsets = useMemo(() => {
    if (!virtual && targetIndex === undefined) return [0]
    const positions = [0]
    for (const entry of entries) {
      let rows = measured.get(entry)
      if (rows === undefined) {
        rows = estimates.get(entry) ?? estimate(entry, width)
        estimates.set(entry, rows)
      }
      positions.push(positions.at(-1)! + rows)
    }
    return positions
  }, [entries, width, measured, estimates, virtual, revision, targetIndex])
  useEffect(() => {
    if (targetIndex !== undefined && offsets[targetIndex] !== undefined) {
      onTargetOffset(offsets[targetIndex])
    }
  }, [targetIndex, offsets, onTargetOffset])
  const { start, end } = virtual
    ? visibleHistoryRange(offsets, offset, height)
    : { start: 0, end: entries.length }
  return (
    <>
      {virtual && offsets[start] > 0 && <Box height={offsets[start]} flexShrink={0} />}
      {!fullScreen && entries.map((entry, index) => (
        <TranscriptMessage key={index} entry={entry} ascii={ascii} expanded={expanded} />
      ))}
      {fullScreen && entries.slice(start, end).map((entry, index) => (
        <MeasuredMessage key={start + index} index={start + index} entry={entry} ascii={ascii}
          expanded={expanded} measure={measure} />
      ))}
      {virtual && end < entries.length && (
        <Box height={offsets.at(-1)! - offsets[end]} flexShrink={0} />
      )}
    </>
  )
}
