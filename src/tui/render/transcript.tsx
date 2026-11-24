import { stripVTControlCharacters } from 'node:util'
import { Box, Text } from 'ink'
import { Marked, type Token, type Tokens } from 'marked'
import { Fragment, memo, useEffect, useState, type ReactNode } from 'react'
import { ACCENT } from './header.js'
import { displayThinkingText, thinkingBody } from './thinking.js'
import type { ThinkingTranscriptEntry, ToolTranscriptEntry, TranscriptEntry } from './types.js'

const markdown = new Marked({ gfm: true })

/**
 * Markdown token cache for assistant messages.
 *
 * The live assistant message is re-rendered on every stream delta. Parsing
 * the whole answer again each time was quadratic in the answer length and was
 * the second cause of the long-session lag (SP005 review, 0.5.2 lag fix).
 * Completed paragraphs never change, so their tokens are reused and only the
 * trailing (still growing) paragraph is re-parsed.
 */
type MarkdownCacheEntry = {
  /** Text of the completed part that the cached tokens were built from. */
  complete: string
  /** Text of the trailing part that the cached tokens were built from. */
  partial: string
  /** Tokens of the completed part (stable). */
  stable: Token[]
  /** Tokens of the trailing part (rebuilt on every change). */
  tail: Token[]
}
const markdownCache = new WeakMap<object, MarkdownCacheEntry>()

/** Split text into stable blocks: complete paragraphs and a trailing partial one. */
function blocksOf(text: string): { complete: string; partial: string } {
  const lastBreak = text.lastIndexOf('\n\n')
  if (lastBreak < 0) return { complete: '', partial: text }
  return { complete: text.slice(0, lastBreak), partial: text.slice(lastBreak + 2) }
}

function inline(tokens: Token[]): ReactNode {
  return tokens.map((token, index) => (
    <Fragment key={index}>{inlineToken(token)}</Fragment>
  ))
}

function inlineToken(token: Token): ReactNode {
  switch (token.type) {
    case 'strong': return <Text bold>{inline((token as Tokens.Strong).tokens)}</Text>
    case 'em': return <Text italic>{inline((token as Tokens.Em).tokens)}</Text>
    case 'del': return <Text strikethrough>{inline((token as Tokens.Del).tokens)}</Text>
    case 'codespan': return <Text color="cyan">{(token as Tokens.Codespan).text}</Text>
    case 'link': {
      const { tokens, href, text } = token as Tokens.Link
      return <Text color="cyan">{inline(tokens)}{text !== href && ` (${href})`}</Text>
    }
    case 'image': return (token as Tokens.Image).text
    case 'br': return '\n'
    case 'paragraph':
    case 'text': {
      const { text, tokens } = token as Tokens.Paragraph | Tokens.Text
      return tokens ? inline(tokens) : text
    }
    case 'escape': return (token as Tokens.Escape).text
    default: return token.raw
  }
}

function blocks(tokens: Token[], ascii: boolean): ReactNode {
  return tokens.map((token, index) => {
    switch (token.type) {
      case 'space': return <Text key={index}>{' '}</Text>
      case 'def': return null
      case 'paragraph':
      case 'text':
        return <Text key={index}>{inlineToken(token)}</Text>
      case 'heading':
        return <Text key={index} bold>{inline((token as Tokens.Heading).tokens)}</Text>
      case 'code':
        return <Box key={index} paddingLeft={2}><Text color="cyan">{(token as Tokens.Code).text}</Text></Box>
      case 'blockquote':
        return <Box key={index} paddingLeft={2} flexDirection="column">{blocks((token as Tokens.Blockquote).tokens, ascii)}</Box>
      case 'list': {
        const { ordered, start, items } = token as Tokens.List
        return <Box key={index} flexDirection="column">
          {items.map((item, i) => (
            <Box key={i}>
              <Text>{ordered ? `${Number(start) + i}. ` : ascii ? '- ' : '• '}</Text>
              <Box flexDirection="column" flexShrink={1}>{blocks(item.tokens, ascii)}</Box>
            </Box>
          ))}
        </Box>
      }
      case 'table': {
        const { header, rows } = token as Tokens.Table
        return <Box key={index} flexDirection="column">
          {[header, ...rows].map((row, i) => (
            <Text key={i} bold={i === 0}>
              {row.map((cell, j) => <Fragment key={j}>{j > 0 && ' | '}{inline(cell.tokens)}</Fragment>)}
            </Text>
          ))}
        </Box>
      }
      case 'hr': return <Text key={index} dimColor>---</Text>
      default: return <Text key={index}>{token.raw}</Text>
    }
  })
}

const toolPulse = [ACCENT, '#9a75dd', '#8160bd', '#9a75dd']

function ToolMessage({ entry, ascii, expanded }: { entry: ToolTranscriptEntry; ascii: boolean; expanded: boolean }) {
  const [pulse, setPulse] = useState(0)
  useEffect(() => {
    if (entry.status !== 'pending' || ascii) return
    const timer = setInterval(() => setPulse((frame) => (frame + 1) % toolPulse.length), 220)
    return () => clearInterval(timer)
  }, [entry.status, ascii])
  const color = {
    pending: toolPulse[pulse],
    success: '#62c981',
    error: '#ff6b6b',
    interrupted: 'gray'
  }[entry.status]
  const glyph = ascii
    ? { pending: '*', success: '+', error: '!', interrupted: '-' }[entry.status]
    : '●'
  const result = stripVTControlCharacters(entry.result ?? '').trim()
  const lines = result ? result.split(/\r?\n/) : []
  const detail = lines.length > 0
    ? lines[0] + (lines.length > 1 ? (ascii ? ` (+${lines.length - 1} lines)` : `（另有 ${lines.length - 1} 行）`) : '')
    : entry.status === 'interrupted' ? (ascii ? 'Interrupted' : '已中断') : undefined
  return (
    <Box marginTop={1} paddingX={1} flexDirection="column">
      <Box>
        <Text color={color}>{glyph + ' '}</Text>
        <Text bold wrap="truncate-end">{stripVTControlCharacters(entry.text)}</Text>
        {entry.elapsedMs !== undefined && <Text dimColor>{` · ${(entry.elapsedMs / 1000).toFixed(1)}s`}</Text>}
      </Box>
      {detail && (
        <Box paddingLeft={2}>
          <Text color={entry.status === 'error' ? color : undefined} dimColor={entry.status !== 'error'}
            wrap={expanded ? 'wrap' : 'truncate-end'}>
            {(ascii ? '  ' : '└ ')}{expanded && result ? result : detail}
          </Text>
        </Box>
      )}
    </Box>
  )
}

function ThinkingMessage({
  entry, ascii, expanded, selected
}: {
  entry: ThinkingTranscriptEntry
  ascii: boolean
  expanded: boolean
  selected: boolean
}) {
  const text = displayThinkingText(entry)
  const label = text
    ? (ascii ? 'Thinking' : '思考')
    : (ascii ? 'Thinking text unavailable' : '思考内容缺失')
  const summary = !expanded && text ? (ascii ? ' - ' : ' · ') + text.split('\n', 1)[0] : ''
  const prefix = selected ? (ascii ? '> ' : '› ') : '  '
  return (
    <Box marginTop={1} paddingX={1} flexDirection="column">
      <Text wrap="truncate-end" color={selected ? ACCENT : undefined} dimColor={!selected} italic>
        {prefix}{label}{summary}
      </Text>
      {expanded && text && <Box paddingLeft={2}><Text dimColor>{thinkingBody(entry, text, ascii)}</Text></Box>}
    </Box>
  )
}

/**
 * Parse an assistant message into render tokens, reusing the tokens of the
 * already completed part. The cache key is the entry object, so it is freed
 * together with the transcript entry.
 */
function assistantTokens(entry: TranscriptEntry, text: string): Token[] {
  const { complete, partial } = blocksOf(text)
  const cached = markdownCache.get(entry)
  if (cached && cached.complete === complete) {
    if (cached.partial !== partial) {
      cached.partial = partial
      cached.tail = markdown.lexer(partial)
    }
    return [...cached.stable, ...cached.tail]
  }
  const stable = complete ? markdown.lexer(complete) : []
  const tail = markdown.lexer(partial)
  markdownCache.set(entry, { complete, partial, stable, tail })
  return [...stable, ...tail]
}

export const TranscriptMessage = memo(function TranscriptMessage({
  entry, ascii, expanded = false, selected = false
}: { entry: TranscriptEntry; ascii: boolean; expanded?: boolean; selected?: boolean }) {
  if (entry.kind === 'tool') return <ToolMessage entry={entry} ascii={ascii} expanded={expanded} />
  if (entry.kind === 'thinking') return <ThinkingMessage entry={entry} ascii={ascii} expanded={expanded} selected={selected} />
  const text = stripVTControlCharacters(entry.text)
  if (entry.kind === 'user') {
    return (
      <Box backgroundColor="#282231" paddingX={1} marginTop={1}>
        <Text color="#af87ff">{ascii ? '> ' : '› '}</Text>
        <Box flexShrink={1}><Text bold>{text}</Text></Box>
      </Box>
    )
  }
  if (entry.kind === 'assistant') {
    return (
      <Box marginTop={1} paddingX={1} flexDirection="column">
        {blocks(assistantTokens(entry, text), ascii)}
      </Box>
    )
  }
  if (entry.kind === 'meta') {
    return <Box marginTop={1} paddingX={1}><Text dimColor>{text}</Text></Box>
  }
  return <Text>{text}</Text>
})
