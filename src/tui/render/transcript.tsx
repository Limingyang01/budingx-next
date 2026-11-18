import { stripVTControlCharacters } from 'node:util'
import { Box, Text } from 'ink'
import { Marked, type Token, type Tokens } from 'marked'
import { Fragment, memo, type ReactNode } from 'react'
import type { TranscriptEntry } from './types.js'

const markdown = new Marked({ gfm: true })

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

export const TranscriptMessage = memo(function TranscriptMessage({
  entry, ascii
}: { entry: TranscriptEntry; ascii: boolean }) {
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
        {blocks(markdown.lexer(text), ascii)}
      </Box>
    )
  }
  if (entry.kind === 'meta') {
    return <Box marginTop={1} paddingX={1}><Text dimColor>{text}</Text></Box>
  }
  return <Text>{text}</Text>
})
