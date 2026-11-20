import { Box, useBoxMetrics, type DOMElement } from 'ink'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import stringWidth from 'string-width'
import { TranscriptMessage } from './transcript.js'
import type { ToolTranscriptEntry, TranscriptEntry } from './types.js'

const virtualThreshold = 64
/**
 * Extra rows rendered above and below the viewport.
 *
 * The reference implementation uses a generous overscan because real message
 * heights vary a lot (a long tool result is many rows, a one-line reply is
 * one). A small overscan forces constant mount/unmount churn while the user
 * scrolls, which is what made the long session feel stuck
 * (SP005 review, 0.5.2 lag fix).
 */
const OVERSCAN_ROWS = 80
/**
 * Cap on mounted messages. Mounting hundreds of fresh messages in one
 * commit blocks the event loop for seconds; the reference implementation
 * bounds the same way.
 */
const MAX_MOUNTED_ITEMS = 300
/**
 * Maximum number of newly mounted messages per commit. Sliding the range
 * towards the target over several commits keeps every commit cheap.
 */
const SLIDE_STEP = 25

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
  offsets: readonly number[], offset: number, height: number, overscanRows?: number
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
  const overscan = overscanRows ?? Math.max(10, height)
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
  // Measured heights survive a width change; see the useMemo below.
  const measuredRef = useRef<Map<TranscriptEntry, number> | undefined>(undefined)
  const measuredWidthRef = useRef(0)
  // Measured heights are kept across a width change and scaled by the
  // width ratio instead of being dropped. Dropping them makes every entry
  // fall back to a guess, which forces a fresh mount of the whole visible
  // range right after a resize (SP005 review, 0.5.2 lag fix).
  const measured = useMemo(() => {
    const previous = measuredRef.current
    const previousWidth = measuredWidthRef.current
    const ratio = previousWidth > 0 ? width / previousWidth : 1
    const next = new Map<TranscriptEntry, number>()
    if (previous) {
      for (const [entry, rows] of previous) {
        next.set(entry, previousWidth === width ? rows : Math.max(1, Math.round(rows * ratio)))
      }
    }
    measuredWidthRef.current = width
    measuredRef.current = next
    return next
  }, [width, expanded])
  // Bumped only when a measured height actually changed, so the offsets
  // array is not rebuilt on every frame.
  const [measuredRevision, setMeasuredRevision] = useState(0)
  const estimates = useMemo(() => new WeakMap<TranscriptEntry, number>(), [width])
  // Range of messages that were mounted last time. The mounted range slides
  // towards the wanted range in bounded steps so a single commit never
  // mounts an unbounded number of fresh messages (SP005 review, 0.5.2 lag fix).
  const mountedRange = useRef<{ start: number; end: number }>({ start: 0, end: 0 })
  const adjustBeforeViewport = useEffectEvent((index: number, delta: number) => {
    if (virtual && delta !== 0 && offsets[index + 1] <= offset) onPriorRowsChanged(delta)
  })
  const measure = useCallback((entry: TranscriptEntry, index: number, rows: number) => {
    const previous = measured.get(entry)
    if (previous === rows) return
    measured.set(entry, rows)
    const estimated = previous ?? estimates.get(entry)
    if (estimated !== undefined) adjustBeforeViewport(index, rows - estimated)
    // Only a real height change needs a new layout pass. Revising on every
    // measurement made the whole window re-render on each frame
    // (SP005 review, 0.5.2 lag fix).
    setMeasuredRevision((value) => value + 1)
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
  }, [entries, width, measured, estimates, virtual, measuredRevision, targetIndex])
  useEffect(() => {
    if (targetIndex !== undefined && offsets[targetIndex] !== undefined) {
      onTargetOffset(offsets[targetIndex])
    }
  }, [targetIndex, offsets, onTargetOffset])
  const wanted = virtual
    ? visibleHistoryRange(offsets, offset, height, OVERSCAN_ROWS)
    : { start: 0, end: entries.length }
  // Bound how many messages a single commit may mount. Without this bound a
  // scroll into fresh territory mounts every message between the old and the
  // new range at once, which blocks the event loop long enough to look
  // like a freeze (SP005 review, 0.5.2 lag fix).
  let start = wanted.start
  let end = Math.min(wanted.end, start + MAX_MOUNTED_ITEMS)
  if (virtual) {
    const previous = mountedRange.current
    const pendingNew = Math.max(0, end - previous.end) + Math.max(0, previous.start - start)
    if (pendingNew > SLIDE_STEP) {
      // Slide towards the wanted range instead of mounting everything now.
      if (previous.start > start) {
        start = Math.max(start, previous.start - SLIDE_STEP)
        end = Math.max(end, start + 1)
      } else {
        end = Math.min(end, previous.end + SLIDE_STEP)
      }
    }
    mountedRange.current = { start, end }
  }
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