// SP004 T15 · 四类 TUI 卡片视图模型（design §9.7，AC VIS-01…04）。
// 纯函数：只把 Frame 里的卡片数据变成文本行，不读时钟（时间由调用方传入）。
// 交互键位在 app.tsx 处理，这样卡片可以在伪 TTY 与真实终端里复用同一份渲染。
import stringWidth from 'string-width'
import type { CommandCard, PlanCard, QuestionCard, TodoCard } from './types.js'

export type CardRenderOptions = {
  zh?: boolean
  /** 命令/待办卡片展开（Ctrl+E）。 */
  expanded?: boolean
  /** 计划卡片当前焦点步骤索引。 */
  focusIndex?: number
  /** 待办完成项 TTL（毫秒）与当前时间。 */
  now?: number
  ttlMs?: number
  /** 追问卡片：当前题索引、光标、已选答案（题目文本→选项标签数组）与自由输入草稿。 */
  questionIndex?: number
  cursor?: number
  selected?: Readonly<Record<string, readonly string[]>>
  otherDraft?: string
}

const COMMAND_SYMBOLS = {
  running: '◐',
  background: '▷',
  completed: '✓',
  failed: '✗',
  cancelled: '⊘'
} as const

const STEP_SYMBOLS = {
  pending: '○',
  in_progress: '◐',
  completed: '✓',
  blocked: '⊘'
} as const

/** 按显示宽度截断（不切宽字符的一半），超长追加省略号。 */
export function truncateByWidth(text: string, width: number): string {
  const limit = Math.max(1, width)
  if (stringWidth(text) <= limit) return text
  let result = ''
  let used = 0
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    const size = stringWidth(segment)
    if (used + size > limit - 1) break
    result += segment
    used += size
  }
  return result + '…'
}

function pick(zh: boolean, cn: string, en: string): string {
  return zh ? cn : en
}

/** VIS-01：命令卡片（命令、状态、cwd、tail 输出、退出码、展开提示）。 */
export function commandCardLines(
  card: CommandCard,
  width: number,
  options: CardRenderOptions = {}
): string[] {
  const zh = options.zh !== false
  const expanded = options.expanded === true
  const symbol = COMMAND_SYMBOLS[card.state]
  const stateLabel = pick(
    zh,
    {
      running: '运行中',
      background: '后台运行',
      completed: '完成',
      failed: '失败',
      cancelled: '已取消'
    }[card.state],
    card.state
  )
  const header = `${symbol} ${pick(zh, '命令', 'Command')} · ${card.interpreter} · ${stateLabel}`
  const lines = [truncateByWidth(header, width)]
  lines.push(truncateByWidth(`  $ ${card.command}`, width))
  if (card.description !== undefined) {
    lines.push(truncateByWidth(`  ${card.description}`, width))
  }
  if (card.cwd !== undefined) {
    lines.push(truncateByWidth(`  cwd: ${card.cwd}`, width))
  }
  if (card.taskId !== undefined) {
    lines.push(truncateByWidth(`  ${pick(zh, '任务', 'task')}: ${card.taskId}`, width))
  }
  if (card.outputPath !== undefined) {
    lines.push(truncateByWidth(`  ${pick(zh, '输出', 'output')}: ${card.outputPath}`, width))
  }
  if (card.outputWarning !== undefined) {
    lines.push(truncateByWidth(`  ⚠ ${pick(zh, '命令日志未保存', 'Command log was not saved')}`, width))
  }
  const resultLines = (card.result ?? '').split('\n').filter((line) => line !== '')
  const tailCount = expanded ? 40 : 6
  const shown = resultLines.slice(-tailCount)
  if (resultLines.length > shown.length) {
    lines.push(
      truncateByWidth(
        `  … ${pick(zh, `省略 ${resultLines.length - shown.length} 行`, `${resultLines.length - shown.length} lines hidden`)} · Ctrl+E ${pick(zh, '展开', 'expand')}`,
        width
      )
    )
  }
  for (const line of shown) lines.push(truncateByWidth(`  ${line}`, width))
  const footer: string[] = []
  if (card.exitCode !== undefined) footer.push(`exit_code: ${card.exitCode}`)
  if (card.finishedAt !== undefined) {
    footer.push(`${Math.max(0, card.finishedAt - card.startedAt)}ms`)
  }
  if (card.state === 'background') footer.push(pick(zh, '任务完成会推送通知', 'a notification arrives when done'))
  if (footer.length > 0) lines.push(truncateByWidth(`  ${footer.join(' · ')}`, width))
  const hint =
    card.state === 'running'
      ? pick(zh, 'Ctrl+E 展开输出 · Esc 打断', 'Ctrl+E expand · Esc interrupt')
      : card.state === 'background'
        ? pick(zh, 'Ctrl+E 展开输出 · 完成通知随后到达', 'Ctrl+E expand · completion follows')
        : pick(zh, 'Ctrl+E 展开/收起输出', 'Ctrl+E expand/collapse')
  lines.push(truncateByWidth(`  ${hint}`, width))
  return lines
}

/** VIS-02：计划卡片（目标、步骤焦点、状态符号、审批槽提示）。 */
export function planCardLines(
  card: PlanCard,
  width: number,
  options: CardRenderOptions = {}
): string[] {
  const zh = options.zh !== false
  const focus = Math.max(0, Math.min(options.focusIndex ?? 0, Math.max(0, card.steps.length - 1)))
  const modeLabel = pick(
    zh,
    { research: '调研中', pending: '待审批', approved: '已批准', idle: '未激活' }[card.mode],
    card.mode
  )
  const lines = [
    truncateByWidth(`◆ ${pick(zh, '计划', 'Plan')} · ${modeLabel}`, width),
    truncateByWidth(`  ${pick(zh, '目标', 'Goal')}: ${card.goal}`, width)
  ]
  for (const [index, step] of card.steps.entries()) {
    const marker = index === focus ? '❯' : ' '
    const blocked =
      step.blockedBy !== undefined && step.blockedBy.length > 0
        ? ` (${pick(zh, '阻塞', 'blocked')}: ${step.blockedBy.join(', ')})`
        : ''
    const note = step.note !== undefined ? ` — ${step.note}` : ''
    lines.push(
      truncateByWidth(
        `${marker} ${index + 1}. ${STEP_SYMBOLS[step.status]} ${step.title}${blocked}${note}`,
        width
      )
    )
  }
  const hint =
    card.mode === 'pending'
      ? pick(
          zh,
          '1 允许 · 3/Esc 拒绝 · e 编辑正文 · ↑↓ 移动焦点',
          '1 allow · 3/Esc deny · e edit text · ↑↓ move focus'
        )
      : card.mode === 'research'
        ? pick(zh, '↑↓ 移动焦点 · Esc 退出计划模式', '↑↓ move focus · Esc leave plan mode')
        : pick(zh, '计划已批准', 'plan approved')
  lines.push(truncateByWidth(`  ${hint}`, width))
  return lines
}

/** VIS-03：待办卡片（排序、状态符号、阻塞位置、折行、展开与 TTL）。 */
export function todoCardLines(
  card: TodoCard,
  width: number,
  options: CardRenderOptions = {}
): string[] {
  const zh = options.zh !== false
  const now = options.now ?? Date.now()
  const ttlMs = options.ttlMs ?? 60_000
  const expanded = options.expanded === true
  const completed = card.items.filter((item) => item.status === 'completed')
  const hidden = expanded
    ? 0
    : completed.filter((item) => now - (card.completedAt[item.id] ?? card.updatedAt) >= ttlMs).length
  const visible = card.items.filter((item) => {
    if (item.status !== 'completed' || expanded) return true
    return now - (card.completedAt[item.id] ?? card.updatedAt) < ttlMs
  })
  const done = completed.length
  const lines = [
    truncateByWidth(
      `◆ ${pick(zh, '待办', 'Todos')} ${done}/${card.items.length}`,
      width
    )
  ]
  for (const item of visible) {
    const blocked =
      item.status === 'blocked' && item.blockedBy !== undefined && item.blockedBy.length > 0
        ? ` (${pick(zh, '阻塞', 'blocked')}: ${item.blockedBy.join(', ')})`
        : ''
    lines.push(
      truncateByWidth(`  ${STEP_SYMBOLS[item.status]} ${item.content}${blocked}`, width)
    )
  }
  if (hidden > 0) {
    lines.push(
      truncateByWidth(
        `  … ${pick(zh, `隐藏 ${hidden} 项已完成（TTL）`, `${hidden} completed hidden (TTL)`)} · Ctrl+E ${pick(zh, '展开', 'expand')}`,
        width
      )
    )
  }
  if (card.items.length === 0) {
    lines.push(truncateByWidth(`  ${pick(zh, '（空列表）', '(empty)')}`, width))
  }
  return lines
}

/** VIS-04：追问卡片（题间切换、单选/多选光标、Other 输入、预览、确认退回）。 */
export function questionCardLines(
  card: QuestionCard,
  width: number,
  options: CardRenderOptions = {}
): string[] {
  const zh = options.zh !== false
  const index = Math.max(0, Math.min(options.questionIndex ?? 0, Math.max(0, card.questions.length - 1)))
  const question = card.questions[index]
  const cursor = Math.max(0, Math.min(options.cursor ?? 0, Math.max(0, (question?.options.length ?? 0))))
  const selected = options.selected ?? {}
  const picked = selected[question?.question ?? ''] ?? []
  const lines = [
    truncateByWidth(
      `◆ ${pick(zh, '提问', 'Question')} ${index + 1}/${card.questions.length} · ${question?.multiSelect === true ? pick(zh, '多选', 'multi') : pick(zh, '单选', 'single')}`,
      width
    )
  ]
  if (card.state === 'answered' && card.answers !== undefined) {
    for (const item of card.questions) {
      const answer = card.answers[item.question] ?? ''
      const note = card.annotations?.[item.question]?.notes
      lines.push(truncateByWidth(`  ✓ ${item.question} → ${answer}${note ? ` (${note})` : ''}`, width))
    }
    return lines
  }
  if (card.state === 'cancelled') {
    lines.push(truncateByWidth(`  ${pick(zh, '已取消，保持原提问结果身份', 'cancelled; original call result kept')}`, width))
    return lines
  }
  if (question === undefined) return lines
  lines.push(truncateByWidth(`  ${question.header}: ${question.question}`, width))
  for (const [optionIndex, option] of question.options.entries()) {
    const marker = optionIndex === cursor ? '❯' : ' '
    const checked = picked.includes(option.label) ? '◉' : '○'
    const preview = option.preview !== undefined ? ` · ${option.preview.split('\n')[0] ?? ''}` : ''
    lines.push(
      truncateByWidth(
        `  ${marker} ${checked} ${option.label} — ${option.description}${preview}`,
        width
      )
    )
  }
  const otherActive = cursor === question.options.length
  lines.push(
    truncateByWidth(
      `  ${otherActive ? '❯' : ' '} ◌ ${pick(zh, '其他（输入自定义答案）', 'Other (type a custom answer)')}${options.otherDraft ? `: ${options.otherDraft}` : ''}`,
      width
    )
  )
  if (card.allowFreeText) {
    lines.push(truncateByWidth(`  ${pick(zh, '可直接输入自定义答案后 Enter 提交本题', 'type a custom answer and Enter to submit')}`, width))
  }
  const notes = options.otherDraft !== undefined && options.otherDraft !== '' ? ' · 备注随答案提交' : ''
  lines.push(
    truncateByWidth(
      `  ${pick(zh, '↑↓ 光标 · 空格选择 · Tab 切题 · Enter 确认/下一题 · Esc 取消', '↑↓ cursor · space select · Tab switch · Enter confirm/next · Esc cancel')}${notes}`,
      width
    )
  )
  return lines
}
