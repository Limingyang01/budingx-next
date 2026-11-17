// Line-level diff (SP003 design §3.6, AC CP-01/CP-02).
// Self-implemented from the published LCS/Myers mechanism; no third party
// diff library and no reference component is used. Common prefix and
// suffix lines are trimmed first; the middle is aligned with an LCS table
// bounded by MAX_LCS_CELLS, and larger middles fall back to one whole
// replacement block (still honest: nothing is claimed to match).
import { DIFF_CONTEXT_LINES } from './constants.js'

export type DiffLineType = 'context' | 'add' | 'remove'

export type DiffLine = {
  type: DiffLineType
  text: string
  oldNo?: number
  newNo?: number
}

export type DiffHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

const MAX_LCS_CELLS = 250000

function splitLines(text: string): string[] {
  if (text === '') return []
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines.length > 1 && lines.at(-1) === '') lines.pop()
  return lines
}

type MiddleOp = { type: DiffLineType; oldIndex: number; newIndex: number }

/** Align two middle ranges; returns ops covering both ranges exactly. */
function alignMiddle(oldLines: string[], newLines: string[]): MiddleOp[] {
  const m = oldLines.length
  const n = newLines.length
  if (m * n > MAX_LCS_CELLS) {
    const removals: MiddleOp[] = oldLines.map((_, index) => ({
      type: 'remove',
      oldIndex: index,
      newIndex: 0
    }))
    const additions: MiddleOp[] = newLines.map((_, index) => ({
      type: 'add',
      oldIndex: m,
      newIndex: index
    }))
    return [...removals, ...additions]
  }
  // Classic LCS table over the middle only.
  const width = n + 1
  const table = new Uint32Array((m + 1) * width)
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      table[i * width + j] =
        oldLines[i] === newLines[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  const ops: MiddleOp[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'context', oldIndex: i, newIndex: j })
      i++
      j++
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      ops.push({ type: 'remove', oldIndex: i, newIndex: j })
      i++
    } else {
      ops.push({ type: 'add', oldIndex: i, newIndex: j })
      j++
    }
  }
  while (i < m) {
    ops.push({ type: 'remove', oldIndex: i, newIndex: j })
    i++
  }
  while (j < n) {
    ops.push({ type: 'add', oldIndex: i, newIndex: j })
    j++
  }
  return ops
}

export function diffLines(
  oldText: string,
  newText: string,
  contextLines = DIFF_CONTEXT_LINES
): DiffHunk[] {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)

  let prefix = 0
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  )
    prefix++
  let suffix = 0
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  )
    suffix++

  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix)
  const newMiddle = newLines.slice(prefix, newLines.length - suffix)

  const all: DiffLine[] = []
  for (let index = 0; index < prefix; index++) {
    all.push({ type: 'context', text: oldLines[index] })
  }
  for (const op of alignMiddle(oldMiddle, newMiddle)) {
    if (op.type === 'context') {
      all.push({ type: 'context', text: oldMiddle[op.oldIndex] })
    } else if (op.type === 'remove') {
      all.push({ type: 'remove', text: oldMiddle[op.oldIndex] })
    } else {
      all.push({ type: 'add', text: newMiddle[op.newIndex] })
    }
  }
  // Assign every line number in one clean walk.
  let oldCounter = 1
  let newCounter = 1
  const numbered: DiffLine[] = all.map((line) => {
    const out: DiffLine = { type: line.type, text: line.text }
    if (line.type === 'context' || line.type === 'remove') out.oldNo = oldCounter++
    if (line.type === 'context' || line.type === 'add') out.newNo = newCounter++
    return out
  })
  for (let index = 0; index < suffix; index++) {
    numbered.push({
      type: 'context',
      text: oldLines[oldLines.length - suffix + index],
      oldNo: oldCounter++,
      newNo: newCounter++
    })
  }

  // Group changed regions into hunks with context.
  const changedIndexes = numbered
    .map((line, index) => (line.type === 'context' ? -1 : index))
    .filter((index) => index >= 0)
  if (changedIndexes.length === 0) return []

  const hunks: DiffHunk[] = []
  let regionStart = changedIndexes[0]
  let regionEnd = changedIndexes[0]
  const flush = (): void => {
    const start = Math.max(0, regionStart - contextLines)
    const end = Math.min(numbered.length - 1, regionEnd + contextLines)
    const lines = numbered.slice(start, end + 1)
    const firstOld = lines.find((line) => line.oldNo !== undefined)
    const firstNew = lines.find((line) => line.newNo !== undefined)
    hunks.push({
      oldStart: firstOld?.oldNo ?? oldLines.length + 1,
      oldLines: lines.filter((line) => line.oldNo !== undefined).length,
      newStart: firstNew?.newNo ?? newLines.length + 1,
      newLines: lines.filter((line) => line.newNo !== undefined).length,
      lines
    })
  }
  for (const index of changedIndexes) {
    if (index - regionEnd > contextLines * 2) {
      flush()
      regionStart = index
    }
    regionEnd = index
  }
  flush()
  return hunks
}

/** `+A -R` summary used by the change list and tool results. */
export function diffSummary(hunks: DiffHunk[]): { additions: number; removals: number } {
  let additions = 0
  let removals = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') additions++
      if (line.type === 'remove') removals++
    }
  }
  return { additions, removals }
}
