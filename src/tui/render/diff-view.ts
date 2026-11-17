// Diff rendering for the TUI (SP003 design §3.6, AC CP-01/CP-07/CP-08).
// The layout is deliberately single column: the terminal is narrow and a
// split column would cut hunks. Line numbers live in a gutter, additions
// and removals are marked, and the same model feeds both the interactive
// dialog and the plain-text /diff output. No reference diff component is
// reused; hunk data comes from our own workspace/diff module.
import type { DiffHunk } from '../../workspace/diff.js'

export type DiffSpanKind = 'header' | 'add' | 'remove' | 'context' | 'gutter'

export type DiffSpan = { text: string; kind: DiffSpanKind }

export type DiffViewLine = { spans: DiffSpan[]; kind: 'header' | 'add' | 'remove' | 'context' }

export function diffViewLines(hunks: DiffHunk[], columns = 100): DiffViewLine[] {
  const lines: DiffViewLine[] = []
  for (const hunk of hunks) {
    const width = String(Math.max(hunk.oldStart + hunk.oldLines, hunk.newStart + hunk.newLines))
      .length
    const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
    lines.push({ spans: [{ text: header, kind: 'header' }], kind: 'header' })
    for (const line of hunk.lines) {
      const number =
        line.type === 'add'
          ? String(line.newNo ?? '').padStart(width, ' ')
          : String(line.oldNo ?? '').padStart(width, ' ')
      const marker = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '
      const text = line.text
      const limit = Math.max(20, columns - width - 2)
      const shown = text.length > limit ? text.slice(0, limit - 1) + '…' : text
      lines.push({
        spans: [
          { text: number, kind: 'gutter' },
          { text: marker + shown, kind: line.type }
        ],
        kind: line.type
      })
    }
  }
  return lines
}

/** Plain-text rendering for /diff and non-TTY output. */
export function diffText(hunks: DiffHunk[], columns = 100): string[] {
  return diffViewLines(hunks, columns).map((line) =>
    line.spans.map((span) => span.text).join(' ')
  )
}

export function diffStats(hunks: DiffHunk[]): { additions: number; removals: number } {
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
