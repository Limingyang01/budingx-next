// Session events to frame model (SP002 design §3.6, AC TC-02).
// Pure function: the renderer never talks to the session directly.
import stringWidth from 'string-width'
import type { SessionEvent } from '../../core/events.js'
import type { Frame, PlanCard, TodoCard } from './types.js'
import { initialFrame } from './types.js'

export type RenderOptions = {
  width: number
  english?: boolean
  toolElapsedMs?: number
}

/**
 * Shared grapheme segmenter. Building one per call is wasteful: the render
 * path wraps text on every stream delta, so the constructor cost is paid
 * hundreds of times per second (SP005 review, 0.5.2 lag fix).
 */
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

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
    for (const { segment: character } of graphemeSegmenter.segment(paragraph)) {
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

/**
 * 把秒数格式化为「X 小时 Y 分钟 Z 秒」（0.5.4：此前只显示总秒数，长回合难读）。
 * 省略为 0 的高位单位；不足 1 分钟只显示秒。英文用 h/m/s。
 */
export function formatDuration(totalSeconds: number, zh = true): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const parts: string[] = []
  if (h > 0) parts.push(zh ? `${h} 小时` : `${h}h`)
  if (m > 0) parts.push(zh ? `${m} 分钟` : `${m}m`)
  if (sec > 0 || parts.length === 0) parts.push(zh ? `${sec} 秒` : `${sec}s`)
  return parts.join(' ')
}

/**
 * 过程性提示：只在回合进行中有效，回合结束即收起，不长期占据显示区（0.5.4）。
 * 其余提示（错误/告警、@ 引用反馈等）保留，供用户查看。
 */
const TRANSIENT_NOTICE_CODES = new Set([
  'api_retry',
  'stream_fallback',
  'late_event_dropped',
  'queue_recycled',
  'approval_dismissed'
])
/** 只保留最新一条的提示：重试/回退这类「attempt N/M」状态不应逐条堆叠（0.5.4）。 */
const LATEST_WINS_NOTICE_CODES = new Set(['api_retry', 'stream_fallback', 'late_event_dropped'])

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
    case 'conversation_rewound':
      // 0.5.4 /rewind：用回滚后的历史重建转录。
      return {
        ...initialFrame(frame.permissionMode),
        queue: frame.queue,
        changes: frame.changes,
        denials: frame.denials,
        transcript: event.entries.map((entry) => ({ kind: entry.kind, text: entry.text }))
      }
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
      next.error = undefined
      // 上一回合的 @ 引用反馈已过期，新回合开始时收起，避免长期占位（0.5.4）。
      next.notices = next.notices.filter((notice) => notice.code !== 'file_context')
      return next
    }
    case 'text_delta': {
      next.thinking = false
      // Only the raw text is accumulated. Wrapping it into lines on every
      // delta was quadratic in the answer length and was the main cause of
      // the long-session lag (SP005 review, 0.5.2 lag fix).
      next.liveText += event.text
      return next
    }
    case 'thinking_delta': {
      next.thinking = true
      return next
    }
    case 'message_completed': {
      next.lastAnswer = next.liveText
      next.thinking = false
      if (next.liveText.length > 0) {
        next.transcript = [...next.transcript, { kind: 'assistant', text: next.liveText }]
        next.liveText = ''
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
      return next
    }
    case 'tool_result': {
      // 追问的答案随工具结果交付并进入转录后，实时追问卡即应消失，
      // 不再长期占据卡片区域（0.5.4：此前 answered 汇总卡永不收起）。
      if (next.question !== undefined && next.question.callId === event.callId) {
        next.question = undefined
      }
      if (next.command !== undefined && next.command.callId === event.callId) {
        const content = event.content
        const taskId = /^background_task_id: (\S+)$/m.exec(content)?.[1]
        const exitCode = /^exit_code: (-?\d+)$/m.exec(content)?.[1]
        const running = /^exit_code: <pending>$/m.test(content)
        next.command = {
          ...next.command,
          result: content,
          state: taskId !== undefined || running
            ? 'background'
            : event.isError
              ? 'failed'
              : 'completed',
          ...(taskId !== undefined ? { taskId } : {}),
          ...(exitCode !== undefined ? { exitCode: Number.parseInt(exitCode, 10) } : {})
        }
      }
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
    case 'command_started': {
      next.command = {
        callId: event.callId,
        command: event.command,
        interpreter: event.interpreter,
        cwd: event.cwd,
        state: event.taskId !== undefined ? 'background' : 'running',
        startedAt: event.startedAt,
        ...(event.taskId !== undefined ? { taskId: event.taskId } : {})
      }
      return next
    }
    case 'command_finished': {
      const card = next.command
      if (card === undefined) return next
      if (event.taskId !== card.taskId && event.callId !== card.callId) return next
      next.command = {
        ...card,
        state:
          event.outcome === 'completed'
            ? 'completed'
            : event.outcome === 'cancelled'
              ? 'cancelled'
              : 'failed',
        finishedAt: event.finishedAt,
        ...(event.exitCode !== undefined ? { exitCode: event.exitCode } : {}),
        ...(event.outputPath !== undefined ? { outputPath: event.outputPath } : {})
      }
      return next
    }
    case 'plan_updated': {
      const plan = event.plan
      const previous = next.plan
      next.plan = {
        planId: plan.id,
        goal: plan.goal,
        steps: plan.steps.map((step) => ({
          id: step.id,
          title: step.title,
          status: step.status,
          ...(step.blockedBy !== undefined ? { blockedBy: step.blockedBy } : {}),
          ...(step.note !== undefined ? { note: step.note } : {})
        })),
        approval: plan.approval,
        mode:
          plan.approval === 'approved'
            ? 'approved'
            : plan.approval === 'pending'
              ? 'pending'
              : previous?.mode === 'research'
                ? 'research'
                : 'idle',
        updatedAt: plan.updatedAt
      }
      next.todos = todosFromPlan(next.plan, frame.todos)
      return next
    }
    case 'plan_mode_changed': {
      const plan = next.plan
      if (plan === undefined) {
        next.notices = [
          ...next.notices,
          {
            level: 'info' as const,
            code: 'plan_mode' as const,
            text: event.active
              ? '已进入计划模式（调研阶段）'
              : '已退出计划模式'
          }
        ].slice(-5)
        return next
      }
      next.plan = {
        ...plan,
        mode: event.active
          ? event.phase === 'pending'
            ? 'pending'
            : 'research'
          : plan.approval === 'approved'
            ? 'approved'
            : 'idle'
      }
      return next
    }
    case 'question_requested': {
      next.question = {
        questionId: event.question.questionId,
        callId: event.question.callId || event.callId,
        turnId: event.turnId,
        questions: event.question.questions,
        allowFreeText: event.question.allowFreeText,
        state: 'pending',
        createdAt: event.question.createdAt
      }
      return next
    }
    case 'question_answered': {
      const card = next.question
      if (card === undefined || card.questionId !== event.questionId) return next
      next.question = {
        ...card,
        state: 'answered',
        answers: event.answers,
        ...(event.annotations !== undefined ? { annotations: event.annotations } : {})
      }
      return next
    }
    case 'question_cancelled': {
      const card = next.question
      if (card === undefined || card.questionId !== event.questionId) return next
      next.question = { ...card, state: 'cancelled' }
      return next
    }
    case 'approval_requested': {
      next.approval = {
        requestId: event.requestId,
        name: event.name,
        summary: event.summary,
        ...(event.preview ? { preview: event.preview } : {}),
        ...(event.planId !== undefined ? { planId: event.planId } : {}),
        ...(event.planVersion !== undefined ? { planVersion: event.planVersion } : {})
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
      // 重试/回退只保留最新一条；@ 引用反馈等每条都独立保留（0.5.4）。
      const kept = LATEST_WINS_NOTICE_CODES.has(event.code)
        ? next.notices.filter((notice) => notice.code !== event.code)
        : next.notices
      next.notices = [
        ...kept,
        { level: event.level, code: event.code, text: event.text }
      ].slice(-5)
      return next
    }
    case 'turn_finalized': {
      // 回合结束即收起追问卡（兜底；正常路径已在 tool_result 时收起）。
      next.question = undefined
      // 过程性提示（重试/回退等）随回合结束收起，不再长期占位（0.5.4）。
      next.notices = next.notices.filter((notice) => !TRANSIENT_NOTICE_CODES.has(notice.code))
      next.transcript = next.transcript.map((entry) =>
        entry.kind === 'tool' && entry.turnId === event.turnId && entry.status === 'pending'
          ? { ...entry, status: 'interrupted' }
          : entry
      )
      if (next.liveText.length > 0) {
        next.transcript = [...next.transcript, { kind: 'assistant', text: next.liveText }]
        next.liveText = ''
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
          text: options.english
            ? `${label} · ${formatDuration(elapsed, false)} · ${time}`
            : `${label} · 用时 ${formatDuration(elapsed, true)} · ${time}`
        }]
      }
      next.startedAt = undefined
      next.suggestFollowUp = event.outcome === 'completed' && !!next.lastAnswer
      if (event.outcome === 'error' && event.error) {
        next.error = event.error.message
      }
      if (event.outcome === 'cancelled') {
        next.transcript = [...next.transcript, { kind: 'meta', text: '[cancelled]' }]
      }
      return next
    }
    default:
      return next
  }
}

/** 计划步骤 → 待办卡片；保留每条完成时间以便 TTL 隐藏（VIS-03）。 */
function todosFromPlan(plan: PlanCard, previous: TodoCard | undefined): TodoCard {
  const completedAt: Record<string, number> = {}
  for (const step of plan.steps) {
    if (step.status === 'completed') {
      completedAt[step.id] = previous?.completedAt[step.id] ?? plan.updatedAt
    }
  }
  return {
    items: plan.steps.map((step) => ({
      id: step.id,
      content: step.title,
      status: step.status,
      ...(step.blockedBy !== undefined ? { blockedBy: step.blockedBy } : {})
    })),
    updatedAt: plan.updatedAt,
    completedAt
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
