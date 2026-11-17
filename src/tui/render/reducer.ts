// Session events to frame model (SP002 design §3.6, AC TC-02).
// Pure function: the renderer never talks to the session directly.
import stringWidth from 'string-width'
import type { SessionEvent } from '../../core/events.js'
import type { Frame } from './types.js'
import { initialFrame } from './types.js'

export type RenderOptions = {
  width: number
}

/** Split text into width aware lines without cutting wide characters. */
export function renderTextLines(text: string, width: number): string[] {
  const limit = Math.max(1, width)
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('')
      continue
    }
    let current = ''
    let currentWidth = 0
    for (const { segment: character } of new Intl.Segmenter(undefined, {
      granularity: 'grapheme'
    }).segment(paragraph)) {
      const charWidth = stringWidth(character)
      if (currentWidth + charWidth > limit && current !== '') {
        lines.push(current)
        current = ''
        currentWidth = 0
      }
      current += character
      currentWidth += charWidth
    }
    lines.push(current)
  }
  return lines
}

function liveLinesOf(frame: Frame, width: number): string[] {
  if (!frame.liveText && !frame.liveThinking) return []
  const lines: string[] = []
  if (frame.liveThinking) {
    for (const line of renderTextLines(frame.liveThinking, width)) {
      lines.push(line ? `· ${line}` : '·')
    }
  }
  lines.push(...renderTextLines(frame.liveText, width))
  return lines
}

export function reduceFrame(
  frame: Frame,
  event: SessionEvent,
  options: RenderOptions = { width: 80 }
): Frame {
  const next: Frame = {
    ...frame,
    status: { ...frame.status },
    queue: [...frame.queue],
    notices: [...frame.notices]
  }

  switch (event.type) {
    case 'conversation_cleared':
      // Mode, change set and denials survive a conversation clear; the
      // checkpoint store keeps offering /undo for files we already wrote.
      return {
        ...initialFrame(frame.permissionMode),
        queue: frame.queue,
        changes: frame.changes,
        denials: frame.denials
      }
    case 'permission_changed':
      next.permissionMode = event.mode
      return next
    case 'change_set':
      next.changes = [...next.changes, ...event.changes]
      return next
    case 'denial_recorded':
      next.denials = [...next.denials, event.denial].slice(-10)
      return next
    case 'turn_started': {
      next.liveText = ''
      next.liveThinking = ''
      next.liveLines = []
      next.error = undefined
      return next
    }
    case 'text_delta': {
      next.liveText += event.text
      next.liveLines = liveLinesOf(next, options.width)
      return next
    }
    case 'thinking_delta': {
      next.liveThinking += event.text
      next.liveLines = liveLinesOf(next, options.width)
      return next
    }
    case 'message_completed': {
      next.liveLines = liveLinesOf(next, options.width)
      if (next.liveLines.length > 0) {
        next.transcript = [
          ...next.transcript,
          ...[next.liveThinking ? '· ' + next.liveThinking : '', next.liveText].filter(
            Boolean
          ),
          ''
        ]
        next.staticLines = [...next.staticLines, ...next.liveLines, '']
        next.liveText = ''
        next.liveThinking = ''
        next.liveLines = []
      }
      return next
    }
    case 'tool_call_completed': {
      next.transcript = [
        ...next.transcript,
        `⚙ ${event.name}(${summarizeInput(event.input)})`
      ]
      next.staticLines = [
        ...next.staticLines,
        `⚙ ${event.name}(${summarizeInput(event.input)})`
      ]
      next.liveLines = [
        ...next.liveLines,
        `⚙ ${event.name}(${summarizeInput(event.input)})`
      ]
      return next
    }
    case 'tool_result': {
      next.transcript = [
        ...next.transcript,
        `${event.isError ? '✗' : '✓'} ${event.callId}: ${event.content}`
      ]
      const lines = renderTextLines(
        `${event.isError ? '✗' : '✓'} ${event.callId}: ${event.content}`,
        options.width
      )
      next.staticLines = [...next.staticLines, ...lines]
      next.liveLines = [...next.liveLines, ...lines]
      return next
    }
    case 'input_queued': {
      next.queue = [...next.queue, { id: event.queueId, preview: event.preview }]
      return next
    }
    case 'input_injected': {
      next.queue = next.queue.filter((item) => item.id !== event.queueId)
      return next
    }
    case 'approval_requested': {
      next.approval = {
        requestId: event.requestId,
        name: event.name,
        summary: event.summary
      }
      return next
    }
    case 'approval_resolved': {
      if (next.approval?.requestId === event.requestId) next.approval = undefined
      return next
    }
    case 'status': {
      next.status = { state: event.state, note: event.note }
      return next
    }
    case 'notice': {
      if (event.code === 'queue_recycled') next.queue = []
      next.notices = [
        ...next.notices,
        { level: event.level, code: event.code, text: event.text }
      ].slice(-5)
      return next
    }
    case 'turn_finalized': {
      next.liveLines = liveLinesOf(next, options.width)
      if (next.liveLines.length > 0) {
        next.transcript = [
          ...next.transcript,
          ...[next.liveThinking ? '· ' + next.liveThinking : '', next.liveText].filter(
            Boolean
          ),
          ''
        ]
        next.staticLines = [...next.staticLines, ...next.liveLines, '']
        next.liveText = ''
        next.liveThinking = ''
        next.liveLines = []
      }
      if (event.outcome === 'error' && event.error) {
        next.error = event.error.message
      }
      if (event.outcome === 'cancelled') {
        next.transcript = [...next.transcript, '[cancelled]']
        next.staticLines = [...next.staticLines, '[cancelled]']
      }
      return next
    }
    default:
      return next
  }
}

function summarizeInput(input: unknown): string {
  if (input === undefined || input === null) return ''
  const text = typeof input === 'string' ? input : JSON.stringify(input)
  if (!text) return ''
  return text.length > 60 ? text.slice(0, 59) + '…' : text
}
