import { stripVTControlCharacters } from 'node:util'
import { Box, measureElement, type DOMElement } from 'ink'
import { Fragment, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import stringWidth from 'string-width'
import { TranscriptMessage } from './transcript.js'
import { displayThinkingText, thinkingBody } from './thinking.js'
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

function textRows(text: string, columns: number): number {
  return text.split('\n').reduce((total, line) =>
    total + Math.max(1, Math.ceil(stringWidth(line) / columns)), 0)
}

function estimate(entry: TranscriptEntry, width: number, expanded: boolean, ascii: boolean): number {
  const columns = Math.max(1, width - 4)
  if (entry.kind === 'tool') {
    const result = expanded ? stripVTControlCharacters(entry.result ?? '').trim() : ''
    return 2 + (result ? textRows(result, Math.max(1, columns - 2)) : Number(Boolean(entry.result) || entry.status === 'interrupted'))
  }
  if (entry.kind === 'thinking') {
    const text = expanded ? displayThinkingText(entry) : ''
    return 2 + (text ? textRows(thinkingBody(entry, text, ascii), columns) : 0)
  }
  return textRows(entry.text, columns) + (entry.kind === 'plain' ? 0 : 1)
}

type HistoryVariant = 'collapsed' | 'expanded'
type HistoryRows = { width: number; heights: WeakMap<TranscriptEntry, Partial<Record<HistoryVariant, number>>> }

function historyVariant(entry: TranscriptEntry, expanded: boolean, toggledIds?: ReadonlySet<string>): HistoryVariant {
  const detail = entry.kind === 'thinking'
    ? expanded !== (toggledIds?.has(entry.id) ?? false)
    : entry.kind === 'tool' && expanded
  return detail ? 'expanded' : 'collapsed'
}

function MeasuredMessage({
  entry, index, variant, node, measure
}: {
  entry: TranscriptEntry
  index: number
  variant: HistoryVariant
  node: ReactNode
  measure(entry: TranscriptEntry, index: number, variant: HistoryVariant, height: number): void
}) {
  const box = useRef<DOMElement>(null)
  const reported = useRef<{ entry: TranscriptEntry; variant: HistoryVariant; rows: number }>(undefined)
  // 0.5.4：只测高度，高度不变就不上报。Ink 的 useBoxMetrics 每帧都会上报
  // left/top，虚拟列表间距一抖就触发「测量 → setState → 重渲染 → 再测量」的
  // 链，长会话下抛 React「Maximum update depth exceeded」。
  useLayoutEffect(() => {
    if (!box.current) return
    const rows = measureElement(box.current).height
    const previous = reported.current
    if (previous?.entry === entry && previous.variant === variant && previous.rows === rows) return
    reported.current = { entry, variant, rows }
    measure(entry, index, variant, rows)
  })
  return <Box flexShrink={0} flexDirection="column" ref={box}>{node}</Box>
}

// SP006 TU-03：冻结元素复用计数。只给测试读取，不影响渲染决策。
let frozenHits = 0
let frozenMisses = 0

export function freezeCacheStats(): { hits: number; misses: number } {
  return { hits: frozenHits, misses: frozenMisses }
}

export function resetFreezeCacheStats(): void {
  frozenHits = 0
  frozenMisses = 0
}

export function HistoryWindow({
  entries, width, offset, height, ascii, fullScreen, expanded, thinkingView, targetIndex, onTargetOffset, onPriorRowsChanged
}: {
  entries: readonly TranscriptEntry[]
  width: number
  offset: number
  height: number
  ascii: boolean
  fullScreen: boolean
  expanded: boolean
  thinkingView?: { toggledIds: ReadonlySet<string>; selectedId?: string }
  targetIndex?: number
  onTargetOffset(rows: number): void
  onPriorRowsChanged(delta: number): void
}) {
  // Measured heights survive a width change; see the useMemo below.
  // SP006 §4.3：已完成条目按「条目对象 + 宽度 + 视图参数」冻结 React 元素。
  // 元素引用不变时 React 直接跳过该子树，等价于参考实现「离屏返回同一元素」，
  // 避免长会话里每帧重排整段 Markdown。
  const frozenElements = useRef(new WeakMap<TranscriptEntry, {
    width: number
    ascii: boolean
    variant: HistoryVariant
    selected: boolean
    node: ReactNode
  }>())
  const toggledIds = thinkingView?.toggledIds
  const messageNode = (entry: TranscriptEntry, variant: HistoryVariant): ReactNode => {
    const cache = frozenElements.current
    const hit = cache.get(entry)
    const selected = entry.kind === 'thinking' && entry.id === thinkingView?.selectedId
    if (hit && hit.width === width && hit.ascii === ascii && hit.variant === variant && hit.selected === selected) {
      frozenHits += 1
      return hit.node
    }
    frozenMisses += 1
    const node = <TranscriptMessage entry={entry} ascii={ascii} expanded={variant === 'expanded'} selected={selected} />
    cache.set(entry, { width, ascii, variant, selected, node })
    return node
  }
  const measuredRef = useRef<HistoryRows>(undefined)
  // Retain estimates from the previous width while visible entries are remeasured.
  // Weak keys let replaced streaming entries be released immediately.
  const { measured, previousWidth } = useMemo(() => {
    const previousWidth = measuredRef.current
    const current: HistoryRows = { width, heights: new WeakMap() }
    measuredRef.current = current
    return { measured: current.heights, previousWidth }
  }, [width])
  // Bumped only when a measured height actually changed, so the offsets
  // array is not rebuilt on every frame.
  const [measuredRevision, setMeasuredRevision] = useState(0)
  // 把一批测量的重排合并为一次，杜绝同一次提交里层层嵌套 setState。
  const revisionScheduled = useRef(false)
  const estimates = useMemo(() => new WeakMap<TranscriptEntry, Partial<Record<HistoryVariant, number>>>(), [width, ascii])
  // Range of messages that were mounted last time. The mounted range slides
  // towards the wanted range in bounded steps so a single commit never
  // mounts an unbounded number of fresh messages (SP005 review, 0.5.2 lag fix).
  const mountedRange = useRef<{ start: number; end: number }>({ start: 0, end: 0 })
  const adjustBeforeViewport = useEffectEvent((index: number, delta: number) => {
    if (virtual && delta !== 0 && offsets[index + 1] <= offset) onPriorRowsChanged(delta)
  })
  const measure = useCallback((entry: TranscriptEntry, index: number, variant: HistoryVariant, rows: number) => {
    const previous = measured.get(entry)?.[variant]
    if (previous === rows) return
    measured.set(entry, { ...measured.get(entry), [variant]: rows })
    const estimated = previous ?? estimates.get(entry)?.[variant]
    if (estimated !== undefined) adjustBeforeViewport(index, rows - estimated)
    // Only a real height change needs a new layout pass. Revising on every
    // measurement made the whole window re-render on each frame
    // (SP005 review, 0.5.2 lag fix).
    if (!revisionScheduled.current) {
      revisionScheduled.current = true
      setTimeout(() => {
        revisionScheduled.current = false
        setMeasuredRevision((value) => value + 1)
      }, 0)
    }
  }, [measured, estimates])
  const virtual = fullScreen && entries.length >= virtualThreshold
  const offsets = useMemo(() => {
    if (!virtual && targetIndex === undefined) return [0]
    const positions = [0]
    for (const entry of entries) {
      const variant = historyVariant(entry, expanded, toggledIds)
      let rows = measured.get(entry)?.[variant]
      if (rows === undefined) {
        const prior = previousWidth?.heights.get(entry)?.[variant]
        rows = estimates.get(entry)?.[variant] ?? (prior === undefined
          ? estimate(entry, width, variant === 'expanded', ascii)
          : Math.max(1, Math.round(prior * previousWidth!.width / width)))
        estimates.set(entry, { ...estimates.get(entry), [variant]: rows })
      }
      positions.push(positions.at(-1)! + rows)
    }
    return positions
  }, [entries, width, ascii, expanded, toggledIds, measured, previousWidth, estimates, virtual, measuredRevision, targetIndex])
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
    if (previous.end <= start || previous.start >= end) {
      // A restored position or search can jump beyond the mounted range.
      // Seed the visible rows first, then fill the overscan on later frames.
      start = visibleHistoryRange(offsets, offset, height, 0).start
      end = Math.min(end, start + SLIDE_STEP)
    } else if (pendingNew > SLIDE_STEP) {
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
        <Fragment key={entry.kind === 'thinking' ? entry.id : index}>
          {messageNode(entry, historyVariant(entry, expanded, toggledIds))}
        </Fragment>
      ))}
      {fullScreen && entries.slice(start, end).map((entry, index) => {
        const variant = historyVariant(entry, expanded, toggledIds)
        return <MeasuredMessage key={entry.kind === 'thinking' ? entry.id : start + index}
          index={start + index} entry={entry} variant={variant} node={messageNode(entry, variant)} measure={measure} />
      })}
      {virtual && end < entries.length && (
        <Box height={offsets.at(-1)! - offsets[end]} flexShrink={0} />
      )}
    </>
  )
}
