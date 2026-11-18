// Diff rendering for the TUI (SP003 design §3.6, AC CP-01/CP-07/CP-08).
// The layout is deliberately single column: the terminal is narrow and a
// split column would cut hunks. Line numbers live in a gutter, additions
// and removals are marked, and the same model feeds both the interactive
// dialog and the plain-text /diff output. No reference diff component is
// reused; hunk data comes from our own workspace/diff module.
import { extname } from 'node:path'
import { common, createLowlight } from 'lowlight'
import type { RootContent } from 'hast'
import { renderTextLines } from './reducer.js'
import type { DiffHunk } from '../../workspace/diff.js'

export type DiffSpanKind = 'header' | 'add' | 'remove' | 'context' | 'gutter'

export type DiffSpan = { text: string; kind: DiffSpanKind; color?: string }

export type DiffViewLine = { spans: DiffSpan[]; kind: 'header' | 'add' | 'remove' | 'context' }

const syntax = createLowlight(common)
const syntaxColors: Record<string, string> = {
  'hljs-keyword': '#c89bf2',
  'hljs-built_in': '#c89bf2',
  'hljs-literal': '#e6b980',
  'hljs-number': '#e6b980',
  'hljs-string': '#a8cf9b',
  'hljs-comment': '#8a8493',
  'hljs-title': '#80bddd',
  'hljs-attr': '#80bddd',
  'hljs-type': '#80bddd'
}

function highlightLine(text: string, kind: DiffSpanKind, language?: string): DiffSpan[] {
  if (!language || text.length > 1000) return [{ text, kind }]
  const spans: DiffSpan[] = []
  function collect(nodes: RootContent[], color?: string): void {
    for (const node of nodes) {
      if (node.type === 'text') spans.push({ text: node.value, kind, color })
      else if (node.type === 'element') {
        const classes = node.properties.className
        const first = Array.isArray(classes) ? String(classes[0]) : ''
        collect(node.children, syntaxColors[first] ?? color)
      }
    }
  }
  collect(syntax.highlight(language, text).children)
  return spans
}

function sliceSpans(spans: readonly DiffSpan[], start: number, width: number): DiffSpan[] {
  const end = start + width
  const slice: DiffSpan[] = []
  let position = 0
  for (const span of spans) {
    const next = position + span.text.length
    if (next > start && position < end) {
      slice.push({ ...span, text: span.text.slice(Math.max(0, start - position), end - position) })
    }
    position = next
    if (position >= end) break
  }
  return slice
}

export function diffViewLines(hunks: DiffHunk[], columns = 100, wrap = false, path = ''): DiffViewLine[] {
  const lines: DiffViewLine[] = []
  const extension = extname(path).slice(1).toLowerCase()
  const alias: Record<string, string> = { tsx: 'typescript', jsx: 'javascript', ps1: 'powershell', md: 'markdown', yml: 'yaml' }
  const requested = alias[extension] ?? extension
  const language = requested && syntax.registered(requested) ? requested : undefined
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
      const text = line.text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
      if (wrap) {
        const parts = renderTextLines(text, Math.max(1, columns - width - 1))
        const colored = highlightLine(text, line.type, language)
        let start = 0
        for (const [index, part] of parts.entries()) {
          lines.push({
            spans: [
              { text: index === 0 ? number : ' '.repeat(width), kind: 'gutter' },
              { text: index === 0 ? marker : ' ', kind: line.type },
              ...sliceSpans(colored, start, part.length)
            ],
            kind: line.type
          })
          start += part.length
        }
        continue
      }
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
