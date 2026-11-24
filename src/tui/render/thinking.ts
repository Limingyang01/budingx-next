import { stripVTControlCharacters } from 'node:util'
import type { ThinkingTranscriptEntry } from './types.js'

const MAX_THINKING_LENGTH = 8192

export function startThinkingEntry(messageId: string, ordinal: number): ThinkingTranscriptEntry {
  return { kind: 'thinking', id: `${messageId}:${ordinal}`, text: '' }
}

export function appendThinkingText(entry: ThinkingTranscriptEntry, text: string): ThinkingTranscriptEntry {
  if (entry.truncated || text.length === 0) return entry
  const remaining = MAX_THINKING_LENGTH - entry.text.length
  if (text.length <= remaining) return { ...entry, text: entry.text + text }
  return {
    ...entry,
    text: (entry.text + text.slice(0, remaining)).replace(/[\uD800-\uDBFF]$/, ''),
    truncated: true
  }
}

export function displayThinkingText(entry: ThinkingTranscriptEntry): string {
  return stripVTControlCharacters(entry.text)
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
    .trim()
}

const MAX_VISIBLE_THINKING_LINES = 120

export function thinkingBody(entry: ThinkingTranscriptEntry, text: string, ascii: boolean): string {
  const lines = text.split('\n')
  const visible = lines.slice(0, MAX_VISIBLE_THINKING_LINES)
  if (entry.truncated || lines.length > MAX_VISIBLE_THINKING_LINES) {
    visible.push(ascii ? '[Thinking text truncated]' : '［思考内容已截断］')
  }
  return visible.join('\n')
}
