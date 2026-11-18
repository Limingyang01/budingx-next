// Session events to frame model (SP002 design §3.6, AC TC-02).
// Pure function: the renderer never talks to the session directly.
import stringWidth from 'string-width'
import type { SessionEvent } from '../../core/events.js'
import type { Frame } from './types.js'
import { initialFrame } from './types.js'

export type RenderOptions = {
  width: number
  english?: boolean
  toolElapsedMs?: number
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
  return frame.liveText ? renderTextLines(frame.liveText, width) : []
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
      next.startedAt = event.startedAt
      next.lastQuestion = event.userText
      next.lastAnswer = undefined
      next.suggestFollowUp = false
      if (event.userText) {
        next.transcript = [...next.transcript, { kind: 'user', text: event.userText }]
      }
      next.liveText = ''
      next.thinking = false
      next.liveLines = []
      next.error = undefined
      return next
    }
    case 'text_delta': {
      next.thinking = false
      next.liveText += event.text
      next.liveLines = liveLinesOf(next, options.width)
      return next
    }
    case 'thinking_delta': {
      next.thinking = true
      return next
    }
    case 'message_completed': {
      next.lastAnswer = next.liveText
      next.thinking = false
      next.liveLines = liveLinesOf(next, options.width)
      if (next.liveLines.length > 0) {
        next.transcript = [...next.transcript, { kind: 'assistant', text: next.liveText }]
        next.staticLines = [...next.staticLines, ...next.liveLines, '']
        next.liveText = ''
        next.liveLines = []
      }
      return next
    }
    case 'tool_call_completed': {
      next.transcript = [
        ...next.transcript,
        {
          kind: 'tool',
          text: `${event.name}(${toolArgument(event.input)})`,
          turnId: event.turnId,
          callId: event.callId,
          status: 'pending'
        }
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
      const index = next.transcript.findLastIndex((entry) =>
        entry.kind === 'tool' && entry.turnId === event.turnId &&
        entry.callId === event.callId && entry.status === 'pending'
      )
      const status = event.isError ? 'error' : 'success'
      const result = event.content
      const entry = next.transcript[index]
      if (entry?.kind === 'tool') {
        next.transcript = [...next.transcript]
        next.transcript[index] = { ...entry, status, result, elapsedMs: options.toolElapsedMs }
      } else {
        next.transcript = [...next.transcript, {
          kind: 'tool', text: 'Tool', turnId: event.turnId, callId: event.callId, status, result
        }]
      }
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
      if (event.boundary === 'intra_turn' && event.text) {
        next.transcript = [...next.transcript, { kind: 'user', text: event.text }]
        next.lastQuestion = event.text
      }
      next.queue = next.queue.filter((item) => item.id !== event.queueId)
      return next
    }
    case 'approval_requested': {
      next.approval = {
        requestId: event.requestId,
        name: event.name,
        summary: event.summary,
        ...(event.preview ? { preview: event.preview } : {})
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
      next.transcript = next.transcript.map((entry) =>
        entry.kind === 'tool' && entry.turnId === event.turnId && entry.status === 'pending'
          ? { ...entry, status: 'interrupted' }
          : entry
      )
      next.liveLines = liveLinesOf(next, options.width)
      if (next.liveLines.length > 0) {
        next.transcript = [...next.transcript, { kind: 'assistant', text: next.liveText }]
        next.staticLines = [...next.staticLines, ...next.liveLines, '']
        next.liveText = ''
        next.liveLines = []
      }
      next.thinking = false
      if (next.startedAt !== undefined && event.finishedAt !== undefined) {
        const elapsed = Math.max(0, Math.floor((event.finishedAt - next.startedAt) / 1000))
        const time = new Date(event.finishedAt).toTimeString().slice(0, 5)
        const labels = {
          completed: '已完成',
          error: '失败',
          cancelled: '已中断',
          length_capped: '达到输出上限',
          max_turns: '达到回合上限',
          unknown: '已结束',
          blocking_limit: '达到阻塞上限',
          prompt_too_long: '提示词过长',
          image_error: '图片处理失败',
          stop_hook_blocking: '停止钩子阻断',
          stop_hook_prevented: '停止钩子拦截'
        }
        const label = options.english ? event.outcome : labels[event.outcome]
        next.transcript = [...next.transcript, {
          kind: 'meta',
          text: options.english ? `${label} · ${elapsed}s · ${time}` : `${label} · 用时 ${elapsed} 秒 · ${time}`
        }]
      }
      next.startedAt = undefined
      next.suggestFollowUp = event.outcome === 'completed' && !!next.lastAnswer
      if (event.outcome === 'error' && event.error) {
        next.error = event.error.message
      }
      if (event.outcome === 'cancelled') {
        next.transcript = [...next.transcript, { kind: 'meta', text: '[cancelled]' }]
        next.staticLines = [...next.staticLines, '[cancelled]']
      }
      return next
    }
    default:
      return next
  }
}

function toolArgument(input: unknown): string {
  if (input && typeof input === 'object') {
    const values = input as Record<string, unknown>
    const target = [values.path, values.pattern, values.query, values.url].find(
      (value): value is string => typeof value === 'string' && value.length > 0
    )
    return summarizeInput(target ?? (Object.keys(values).length ? input : undefined))
  }
  return summarizeInput(input)
}

function summarizeInput(input: unknown): string {
  if (input === undefined || input === null) return ''
  const text = typeof input === 'string' ? input : JSON.stringify(input)
  if (!text) return ''
  return text.length > 60 ? text.slice(0, 59) + '…' : text
}
