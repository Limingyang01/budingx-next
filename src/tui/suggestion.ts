// Next-prompt suggestion (SP006 波次 G).
//
// The input placeholder predicts what the user would naturally type next. It
// is generated from the conversation that just finished, so the hint matches
// the current task instead of a fixed sentence.
//
// Cost and latency are bounded on purpose: one request after a completed
// turn, no tools, a small output cap, a trimmed transcript and a hard timeout.
// Any failure is silent: no suggestion is better than a wrong or slow one.
import type { Message } from '../core/events.js'
import type { ApiMessage, ModelProvider } from '../core/provider.js'

/** 送给建议请求的对话节选上限（字符）。 */
const MAX_EXCERPT_CHARS = 3200
/** 单条消息在节选中的上限（字符）。 */
const MAX_MESSAGE_CHARS = 1200
/** 建议长度上限：中文按字符、英文按词（英文词数足够约束，字符放宽避免误杀）。 */
const MAX_SUGGESTION_CHARS_ZH = 24
const MAX_SUGGESTION_CHARS_EN = 80
const MAX_SUGGESTION_WORDS = 12
/** 建议请求的输出上限与超时。 */
const MAX_OUTPUT_TOKENS = 64
const DEFAULT_TIMEOUT_MS = 15_000

const SYSTEM_ZH = [
  '你在为编码助手 budingx 的输入框写「下一句」占位建议。',
  '依据是刚刚结束的这段对话：用户说过什么、正在推进什么目标、助手最后停在什么地方。',
  '要预测的是用户在输入框里会亲手打出的那句话，不是你认为他应该做的事。',
  '判断标准：他看到这句话会觉得「我正想这么说」。',
  '要求：只写一句短语（中文 2–20 字，英文 2–12 个词）；使用用户最近使用的语言；',
  '不加引号、列表、标点结尾或任何解释；不要复述助手的话；不要评价已完成的回答。',
  '如果下一步并不明显，只输出 NONE。',
  '只输出建议本身。'
].join('\n')

const SYSTEM_EN = [
  'You write the next-input placeholder for budingx, a coding agent CLI.',
  'Base it on the conversation that just ended: what the user asked for, the goal being pursued, and where the assistant stopped.',
  'Predict the line the user would type themselves, not what you think they should do.',
  'The test: would they think "I was about to type that"?',
  'Rules: one short phrase (2-12 words); use the language the user last used;',
  'no quotes, lists, trailing punctuation or explanation; do not restate the assistant; do not praise the answer.',
  'If the next step is not obvious, output only NONE.',
  'Output the suggestion only.'
].join('\n')

/** 建议请求的上下文节选：只保留可读文本，工具调用与结果不参与。 */
export function suggestionExcerpt(messages: readonly Message[], maxChars = MAX_EXCERPT_CHARS): string {
  const lines: string[] = []
  let used = 0
  for (let index = messages.length - 1; index >= 0 && used < maxChars; index--) {
    const message = messages[index]!
    if (message.role === 'tool') continue
    const text = message.blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()
    if (!text) continue
    const clipped = text.length > MAX_MESSAGE_CHARS
      ? `${text.slice(0, MAX_MESSAGE_CHARS)}…`
      : text
    const line = `${message.role === 'user' ? '用户' : '助手'}：${clipped}`
    used += line.length
    lines.unshift(line)
  }
  return lines.join('\n')
}

/** 最近对话以中文为主时返回 'zh'，否则 'en'。 */
export function conversationLanguage(messages: readonly Message[]): 'zh' | 'en' {
  let text = ''
  for (let index = messages.length - 1; index >= 0 && text.length < 600; index--) {
    const message = messages[index]!
    if (message.role !== 'user') continue
    text = message.blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('') + text
  }
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  return cjk >= 2 ? 'zh' : 'en'
}

/** 组装建议请求消息；没有可用上下文时返回 undefined。 */
export function buildSuggestionMessages(messages: readonly Message[]): ApiMessage[] | undefined {
  const excerpt = suggestionExcerpt(messages)
  if (!excerpt) return undefined
  const zh = conversationLanguage(messages) === 'zh'
  return [
    { role: 'system', content: zh ? SYSTEM_ZH : SYSTEM_EN },
    {
      role: 'user',
      content: zh
        ? `最近对话：\n${excerpt}\n\n只输出建议本身，或 NONE。`
        : `Recent conversation:\n${excerpt}\n\nOutput the suggestion only, or NONE.`
    }
  ]
}

/**
 * 清理模型输出：只接受一句能直接填进输入框的短建议。
 * 不符合要求时返回 undefined（宁可不显示，也不显示错位的提示）。
 */
export function sanitizeSuggestion(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  let text = raw.trim()
  if (!text) return undefined
  // 去掉模型偶尔加的引号、代码标记与包裹括号。
  text = text.replace(/^[`"'“”「」『』\s]+|[`"'“”「」『』\s]+$/g, '').trim()
  text = text.replace(/[。.]+$/, '').trim()
  if (!text) return undefined
  const lower = text.toLowerCase()
  if (/^(none|nothing|no suggestion|silence|n\/a)\b/i.test(lower)) return undefined
  if (/^(无|没有|无需|不建议|暂无|不需要)\S*$/.test(text)) return undefined
  // 单行、无 Markdown、无包裹结构。
  if (/[\n\r]/.test(text)) return undefined
  if (/\*\*|`|^[-*#]\s/.test(text)) return undefined
  if (/^[(\[\uff08\u3010].*[)\]\uff09\u3011]$/.test(text)) return undefined
  // 带标签前缀或评价式回答，说明模型没有按「用户口吻」输出。
  if (/^(建议|提示|答案|suggestion|answer|response|reply)\s*[:：]/i.test(text)) return undefined
  if (/^(让我|我来|我会|我可以|我先|以下是|下面|我将|let me|i'?ll\b|i will|i can|i'?m|here'?s|here is|sure[,，])/i.test(text)) return undefined
  if (/(谢谢|多谢|辛苦了|听起来不错|看起来不错|很好|thanks|thank you|looks good|sounds good)/i.test(lower)) return undefined
  // 疑问句不是「用户接下来会打的字」。
  if (/[?？]$/.test(text)) return undefined
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  if (cjk >= 2) {
    if (text.length > MAX_SUGGESTION_CHARS_ZH) return undefined
  } else {
    if (text.length > MAX_SUGGESTION_CHARS_EN) return undefined
    const words = text.split(/\s+/).filter(Boolean)
    if (words.length > MAX_SUGGESTION_WORDS) return undefined
  }
  return text
}

/** 生成下一句输入建议；不可用或失败时返回 undefined。 */
export async function generatePromptSuggestion(options: {
  provider: ModelProvider
  model: string
  history: readonly Message[]
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<string | undefined> {
  const model = options.model.trim()
  if (!model) return undefined
  const messages = buildSuggestionMessages(options.history)
  if (!messages) return undefined
  if (options.signal?.aborted) return undefined
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  timer.unref?.()
  const relay = (): void => controller.abort()
  options.signal?.addEventListener('abort', relay, { once: true })
  try {
    let raw = ''
    for await (const event of options.provider.stream({
      model,
      messages,
      maxTokens: MAX_OUTPUT_TOKENS,
      signal: controller.signal
    })) {
      if (event.type === 'text_delta') {
        raw += event.text
        if (raw.length > MAX_SUGGESTION_CHARS_EN * 4) break
        continue
      }
      if (event.type === 'failed') return undefined
      if (event.type === 'message_completed') break
    }
    return sanitizeSuggestion(raw)
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', relay)
  }
}
