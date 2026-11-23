// SP005 §4：上下文预算核算与压缩（纯逻辑，零 IO）。
// 压缩保留项来自结构化状态（用户约束 / 已批准计划 / 未完成工具调用），
// 不用文本摘要替代，保证压缩后约束、计划与工具状态不丢。
import type { Message, MessageBlock } from './events.js'

/** 触发压缩的比例（SP005 旧公式，0.9.1 起弃用，保留导出避免外部引用断裂）。 */
export const COMPACT_TRIGGER_RATIO = 0.85
/**
 * 自动压缩缓冲（SP009 0.9.1 LC-05，对齐参考仓 AUTOCOMPACT_BUFFER_TOKENS）。
 * 触发点 = 上下文窗口 − 缓冲：接近真实窗口才压缩，而不是早早按固定比例裁掉。
 */
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000
/** 压缩目标比例：压缩后压到目标预算的这个比例以内。 */
export const COMPACT_FLOOR_RATIO = 0.6
/** 最多保留的约束条数（超出取最近）。 */
export const MAX_PRESERVED_CONSTRAINTS = 8
/** 连续压缩失败次数达到该值时熔断。 */
export const COMPACTION_CIRCUIT_LIMIT = 3
/** 未完成工具调用在压缩后的占位内容前缀。 */
export const COMPACTED_TOOL_MARKER = '[compacted]'
/** 保留项注入块的标签。 */
export const PRESERVED_CONTEXT_MARKER = '<preserved_context>'

/** 上下文预算的核算输入（纯数据）。 */
export type ContextBudgetInput = {
  /** 参与估算的消息。 */
  messages: Message[]
  /** 模型上下文窗口上限（token）。 */
  maxTokens: number
  /** 预留的输出 token。 */
  reservedOutputTokens?: number
  /** token 估算器；缺省用内置字符启发式。 */
  estimate?: (messages: Message[]) => number
  /**
   * 强制压缩：忽略触发阈值直接尝试裁剪。
   * 用于模型已明确报告上下文溢出、而本地估算未必超限的场景
   * （真实分词器与本地启发式不一致）。
   */
  force?: boolean
  /**
   * 模型生成的历史摘要（SP009 0.9.1 LC-06）。提供时，被裁剪回合的信息以一条
   * 摘要消息保留在压缩边界处，而不是静默丢弃——对齐参考仓「模型摘要压缩」手段。
   */
  summaryText?: string
}

/** 单条保留项：压缩后必须仍在上下文中的结构化事实。 */
export type PreservedItem = {
  kind: 'constraint' | 'plan' | 'tool_state'
  /** 稳定标识，便于断言与调试。 */
  id: string
  /** 注入回请求的文本。 */
  text: string
  /** 保留原因（可读）。 */
  reason: string
}

/** 一次压缩的结果。 */
export type CompactionResult = {
  /** 是否真的执行了压缩。 */
  compacted: boolean
  /** 压缩后参与请求的消息。 */
  messages: Message[]
  /** 被替换掉的原始消息数量。 */
  replacedCount: number
  /** 被替换掉的原始消息索引区间（闭区间）。 */
  replacedRange?: { from: number; to: number }
  /** 保留项。 */
  preserved: PreservedItem[]
  /** 压缩后估算长度。 */
  estimatedTokens: number
  /** 预算内是否达标。 */
  withinBudget: boolean
  /** 未能达标时的原因。 */
  overflowReason?: 'single_message_too_large' | 'preserved_exceeds_budget' | 'no_compactable_range'
  /**
   * 压缩产生的合成消息与最终顺序（SP005 review H5）。
   * 转录据此可重放压缩，而不是在恢复时把压缩静默撤销。
   */
  artifacts?: { order: string[]; synthetic: Message[]; droppedIds: string[] }
}

/** 压缩器端口：core 内部只持有纯函数实现。 */
export interface ContextBudgetManager {
  /** 核算当前请求的估算长度。 */
  estimate(input: ContextBudgetInput): number
  /** 尝试把历史压缩到预算内；幂等。 */
  compact(input: ContextBudgetInput, preserved: PreservedItem[]): CompactionResult
}

/** 硬约束句式：命中即认为该条用户消息是显式约束。 */
const CONSTRAINT_HINTS = ['不要', '禁止', '不得', '必须', '只能', '不允许']

/** 内置 token 估算：CJK 按 1 字 ≈ 1 token，ASCII 按 4 字符 ≈ 1 token。 */
export function estimateTokens(messages: readonly Message[]): number {
  let total = 0
  for (const message of messages) {
    for (const block of message.blocks) {
      total += estimateText(blockText(block))
    }
  }
  return total
}

/** 单段文本的 token 估算。 */
export function estimateText(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const char of text) {
    if (char.charCodeAt(0) > 0x2e80) cjk++
    else other++
  }
  return cjk + Math.ceil(other / 4)
}

/** 取消息块的可读文本。 */
function blockText(block: MessageBlock): string {
  switch (block.type) {
    case 'text':
    case 'thinking':
      return block.text
    case 'tool_use':
      return `${block.name} ${JSON.stringify(block.input ?? {})}`
    case 'tool_result':
      return block.content
    case 'context':
      return block.content
    case 'interrupt_mark':
      return ''
    default:
      return ''
  }
}

/** 消息的纯文本（用于约束抽取）。 */
function messageText(message: Message): string {
  return message.blocks
    .filter((block): block is Extract<MessageBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

/** 是否命中硬约束句式。 */
export function isConstraintText(text: string): boolean {
  return CONSTRAINT_HINTS.some((hint) => text.includes(hint))
}

/**
 * 单条保留项的最大估算 token 数。
 * 保留的是「约束本身」，不是整条可能非常长的消息；
 * 超长时按句子切出前若干条约束句并显式标注已截断，
 * 避免单条保留项把整个上下文预算占满。
 */
export const MAX_PRESERVED_ITEM_TOKENS = 400

/**
 * 从用户消息中抽取约束保留项（取最近 MAX_PRESERVED_CONSTRAINTS 条）。
 * maxItemTokens：单条保留项允许占用的估算 token 上限；
 * 缺省用 MAX_PRESERVED_ITEM_TOKENS。调用方通常传入预算相关的值，
 * 保证「保留项本身不会占满整个上下文预算」。
 */
export function collectConstraintItems(
  messages: Message[],
  maxItemTokens?: number
): PreservedItem[] {
  const limit = maxItemTokens ?? MAX_PRESERVED_ITEM_TOKENS
  const items: PreservedItem[] = []
  for (const message of messages) {
    if (message.role !== 'user') continue
    const text = messageText(message).trim()
    if (!text || !isConstraintText(text)) continue
    items.push({
      kind: 'constraint',
      id: message.id,
      text: capPreservedText(text, limit),
      reason: '用户显式约束，压缩后必须保留'
    })
  }
  return items.slice(-MAX_PRESERVED_CONSTRAINTS)
}

/**
 * 裁剪保留项文本：优先保留含约束关键词的句子，超长时截断并显式标注。
 * 保留项被裁剪不影响「约束不丢」这一保证，只影响保留的冗余度。
 */
export function capPreservedText(text: string, maxTokens = MAX_PRESERVED_ITEM_TOKENS): string {
  const limit = Math.max(1, maxTokens)
  if (estimateText(text) <= limit) return text
  const sentences = text.split(/(?<=[。！？；\n])/).filter((part) => part.trim())
  const kept: string[] = []
  let tokens = 0
  for (const sentence of sentences) {
    const cost = estimateText(sentence)
    if (tokens + cost > limit) break
    kept.push(sentence)
    tokens += cost
  }
  const constraintSentences = kept.filter((sentence) => isConstraintText(sentence))
  const head = (constraintSentences.length > 0 ? constraintSentences : kept).join('')
  const marker = `\n[preserved-truncated] 该约束原文约 ${estimateText(text)} token，仅保留 ${estimateText(head)} token。`
  const budgetForMarker = Math.max(0, limit - estimateText(marker))
  const finalHead = estimateText(head) <= budgetForMarker ? head : head.slice(0, Math.max(0, budgetForMarker))
  return `${finalHead}${marker}`
}

/** 未完成的工具调用（只有 tool_use 没有 tool_result）。 */
export function unfinishedToolCalls(messages: Message[]): { callId: string; name: string }[] {
  const answered = new Set<string>()
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === 'tool_result') answered.add(block.callId)
    }
  }
  const pending: { callId: string; name: string }[] = []
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === 'tool_use' && !answered.has(block.id)) pending.push({ callId: block.id, name: block.name })
    }
  }
  return pending
}

/** 目标预算：扣除预留输出后的可用 token。 */
export function targetTokens(input: ContextBudgetInput): number {
  return Math.max(0, input.maxTokens - (input.reservedOutputTokens ?? 0))
}

/**
 * 触发阈值（SP009 0.9.1 LC-05）：上下文窗口 − 缓冲。
 * 对齐参考仓「有效窗口 − AUTOCOMPACT_BUFFER_TOKENS」的自动压缩触发机制；
 * 不再用 SP005 的 0.85×(窗口−预留) 旧公式。压缩目标预算仍由 compactFloor 决定。
 */
export function triggerTokens(input: ContextBudgetInput): number {
  return Math.max(1, input.maxTokens - AUTOCOMPACT_BUFFER_TOKENS)
}

/** 压缩目标上限。 */
export function compactFloor(input: ContextBudgetInput): number {
  return Math.floor(targetTokens(input) * COMPACT_FLOOR_RATIO)
}

/**
 * 为输出预留的 token 数（SP005 review M3）。
 * 会话循环与 `/context` 必须读同一个函数，否则用户看到的阈值与真实行为不一致。
 */
export function reservedOutputFor(maxTokens: number, reservedOutputTokens?: number): number {
  return reservedOutputTokens ?? Math.floor(maxTokens / 4)
}

/** 归一化后的预算：上限与预留输出。 */
export function normalizeBudget(
  maxTokens: number,
  reservedOutputTokens?: number
): { maxTokens: number; reservedOutputTokens: number } {
  return { maxTokens, reservedOutputTokens: reservedOutputFor(maxTokens, reservedOutputTokens) }
}

/**
 * 把保留项收敛到预算以内（SP005 review H4）。
 * 保留约束很重要，但把超预算的请求发给模型只会换来一次溢出错误，
 * 因此单条先按预算均分裁剪，仍放不下时只保留最近且装得下的部分。
 */
export function clampPreservedItems(
  preserved: PreservedItem[],
  budget: number
): { items: PreservedItem[]; truncated: boolean } {
  if (preserved.length === 0) return { items: [], truncated: false }
  const costOf = (item: PreservedItem): number =>
    estimateTokens([{ id: item.id, role: 'user', blocks: [{ type: 'text', text: item.text }] }])
  const total = preserved.reduce((sum, item) => sum + costOf(item), 0)
  if (total <= budget) return { items: preserved, truncated: false }

  const limit = Math.max(1, Math.floor(budget / preserved.length))
  const capped = preserved.map((item) => ({ ...item, text: capPreservedText(item.text, limit) }))
  const kept: PreservedItem[] = []
  let used = 0
  for (const item of capped) {
    const cost = costOf(item)
    if (used + cost > budget) break
    kept.push(item)
    used += cost
  }
  if (kept.length === 0) {
    const newest = preserved[preserved.length - 1]
    kept.push({ ...newest, text: capPreservedText(newest.text, Math.max(1, budget)) })
  }
  return { items: kept, truncated: true }
}

/** 消息是否是「可压缩单元」的起点（用户消息视为回合边界）。 */
function isBoundary(message: Message): boolean {
  return message.role === 'user'
}

/** 生成未完成工具调用的占位失败结果（绝不伪造成功）。 */
export function compactedToolResult(callId: string): MessageBlock {
  return {
    type: 'tool_result',
    callId,
    isError: true,
    content: `${COMPACTED_TOOL_MARKER} 该工具调用在上下文压缩前未完成，结果未知，请重新确认其状态。`
  }
}

/** 把保留项渲染为一条 user 消息（压缩边界之后注入）。 */
function preservedMessage(preserved: PreservedItem[]): Message | undefined {
  if (preserved.length === 0) return undefined
  const lines = preserved.map((item) => `- [${item.kind}] ${item.text}`)
  return {
    id: `preserved-${preserved.map((item) => item.id).join('-')}`,
    role: 'user',
    blocks: [
      {
        type: 'text',
        text: `${PRESERVED_CONTEXT_MARKER}\n压缩前保留的关键事实（不得忽略）：\n${lines.join('\n')}\n</preserved_context>`
      }
    ]
  }
}

/** 已被回答的工具调用 ID。 */
function answeredCallIds(messages: Message[]): Set<string> {
  const answered = new Set<string>()
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === 'tool_result') answered.add(block.callId)
    }
  }
  return answered
}

/** 找出可裁剪的历史回合边界（用户消息所在位置）。 */
function boundariesOf(messages: Message[]): number[] {
  const result: number[] = []
  for (let index = 0; index < messages.length; index++) {
    if (isBoundary(messages[index])) result.push(index)
  }
  return result
}

/**
 * 判定「无法压缩达标」的具体原因。
 * - single_message_too_large：存在单条消息本身就超过压缩目标线。
 * - preserved_exceeds_budget：保留项（约束/计划/工具状态）本身就占满了预算。
 * - no_compactable_range：还有历史可裁剪但本次没能裁掉，或根本没有可裁剪边界。
 */
function overflowReasonOf(
  messages: Message[],
  floor: number,
  target: number,
  preserved: PreservedItem[],
  hasCuttableRange: boolean
): 'single_message_too_large' | 'preserved_exceeds_budget' | 'no_compactable_range' | undefined {
  const largest = messages.reduce(
    (max, message) => Math.max(max, estimateTokens([message])),
    0
  )
  if (largest > floor) return 'single_message_too_large'
  const preservedTokens = estimateTokens(
    preserved.map((item) => ({
      id: item.id,
      role: 'user',
      blocks: [{ type: 'text', text: item.text }]
    }))
  )
  if (preservedTokens > target) return 'preserved_exceeds_budget'
  if (hasCuttableRange) return undefined
  return 'no_compactable_range'
}

/** 默认压缩器实现（纯函数、幂等）。 */
export function createContextBudgetManager(): ContextBudgetManager {
  const estimateOf = (input: ContextBudgetInput): number =>
    input.estimate ? input.estimate(input.messages) : estimateTokens(input.messages)

  const compact = (input: ContextBudgetInput, preserved: PreservedItem[]): CompactionResult => {
    const messages = input.messages
    const estimatedBefore = estimateOf(input)
    const trigger = triggerTokens(input)
    const floor = compactFloor(input)
    const target = targetTokens(input)
    // 保留项本身不能占满预算，否则压缩只会产出一个更糟的请求。
    const clamped = clampPreservedItems(preserved, floor)
    const effectivePreserved = clamped.items
    const base: CompactionResult = {
      compacted: false,
      messages: [...messages],
      replacedCount: 0,
      preserved: effectivePreserved,
      estimatedTokens: estimatedBefore,
      withinBudget: estimatedBefore <= target
    }
    if (!input.force && estimatedBefore <= trigger) return base
    if (messages.length === 0) {
      return { ...base, withinBudget: false, overflowReason: 'no_compactable_range' }
    }

    const answered = answeredCallIds(messages)
    const boundaries = boundariesOf(messages)

    // 当前请求是最后一条用户消息；它之前的回合才可裁剪。
    const lastUserIndex = boundaries.length > 0 ? boundaries[boundaries.length - 1] : messages.length - 1
    const cuttableBoundaries = boundaries.filter((index) => index < lastUserIndex)
    if (cuttableBoundaries.length === 0) {
      // 没有历史回合可裁剪：只有当单条消息本身就超预算时才区分原因。
      const reason = overflowReasonOf(messages, floor, target, effectivePreserved, false)
      return {
        ...base,
        withinBudget: false,
        ...(reason ? { overflowReason: reason } : {})
      }
    }

    const preservedEntry = preservedMessage(effectivePreserved)
    // SP009 0.9.1 LC-06：模型摘要作为一条 user 消息保留在压缩边界，
    // 承载被裁剪回合的关键信息（对齐参考仓模型摘要压缩手段）。
    const summaryEntry: Message | undefined =
      input.summaryText && input.summaryText.trim()
        ? {
            id: `compaction-summary-${estimateText(input.summaryText)}`,
            role: 'user',
            blocks: [
              {
                type: 'text',
                text: `<compacted_summary>\n以下是早期对话的摘要（历史已被压缩，据此继续工作）：\n${input.summaryText.trim()}\n</compacted_summary>`
              }
            ]
          }
        : undefined
    const tail = messages.slice(lastUserIndex)

    // 从最旧的回合开始整体丢弃，直到估算长度进入 floor 以内。
    // 候选长度 = 已保留 + 保留项 + 未丢弃的历史回合 + 当前回合。
    let droppedFrom = cuttableBoundaries[0]
    let droppedTo = -1
    const carriedTools: Message[] = []
    for (let index = 0; index < cuttableBoundaries.length; index++) {
      const start = cuttableBoundaries[index]
      const end = index + 1 < cuttableBoundaries.length ? cuttableBoundaries[index + 1] : lastUserIndex
      const segment = messages.slice(start, end)
      const remaining = messages.slice(end, lastUserIndex)
      const candidate = [
        ...carriedTools,
        ...(summaryEntry ? [summaryEntry] : []),
        ...(preservedEntry ? [preservedEntry] : []),
        ...segment,
        ...remaining,
        ...tail
      ]
      if (!input.force && estimateOf({ ...input, messages: candidate }) <= floor) break
      // force 模式：模型已报告溢出，本地估算不可信，
      // 因此即使估算已经在 floor 以内也要继续丢弃最旧回合，
      // 直到没有可裁剪的回合为止。
      // 丢弃该回合；其中未完成的工具调用合成为显式失败占位。
      for (const message of segment) {
        for (const block of message.blocks) {
          if (block.type === 'tool_use' && !answered.has(block.id)) {
            // 必须同时保留 tool_use 与合成结果：只有结果没有调用会被
            // normalizeForApi 当作孤儿结果丢掉，占位就到不了模型。
            carriedTools.push({
              id: `compacted-assistant-${block.id}`,
              role: 'assistant',
              blocks: [{ type: 'tool_use', id: block.id, name: block.name, input: block.input }]
            })
            carriedTools.push({
              id: `compacted-${block.id}`,
              role: 'tool',
              blocks: [compactedToolResult(block.id)]
            })
          }
        }
      }
      droppedTo = end - 1
    }

    if (droppedTo < droppedFrom) {
      // 一个回合都丢不掉：可能是单条消息本身就超预算（不可压缩），
      // 也可能保留项本身就把预算占满。
      const estimated = estimateOf(input)
      const reason = overflowReasonOf(messages, floor, target, effectivePreserved, true)
      return {
        ...base,
        estimatedTokens: estimated,
        withinBudget: estimated <= target,
        ...(estimated > target && reason ? { overflowReason: reason } : {})
      }
    }

    const droppedMessages = messages.slice(droppedFrom, droppedTo + 1)
    void droppedMessages
    const survivors = messages.filter(
      (_message, index) => index < droppedFrom || index > droppedTo
    )
    const result: Message[] = [...carriedTools]
    if (summaryEntry) result.push(summaryEntry)
    if (preservedEntry) result.push(preservedEntry)
    result.push(...survivors)
    const estimatedAfter = estimateOf({ ...input, messages: result })

    const compacted: CompactionResult = {
      compacted: true,
      messages: result,
      replacedCount: droppedTo - droppedFrom + 1,
      replacedRange: { from: droppedFrom, to: droppedTo },
      preserved: effectivePreserved,
      estimatedTokens: estimatedAfter,
      withinBudget: estimatedAfter <= target,
      artifacts: {
        order: result.map((message) => message.id),
        synthetic: [...carriedTools, ...(summaryEntry ? [summaryEntry] : []), ...(preservedEntry ? [preservedEntry] : [])],
        droppedIds: messages
          .slice(droppedFrom, droppedTo + 1)
          .map((message) => message.id)
      }
    }
    if (!compacted.withinBudget && !compacted.overflowReason) {
      // 用压缩后的存活消息判因：被丢弃的超大消息不应再算作原因。
      const reason = overflowReasonOf(result, floor, target, effectivePreserved, true)
      compacted.overflowReason = reason ?? 'no_compactable_range'
    }
    return compacted
  }

  return { estimate: estimateOf, compact }
}
