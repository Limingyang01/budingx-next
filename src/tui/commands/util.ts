// SP006：注册表与既有命令实现的桥接工具。
import type { CommandContext, CommandOutcome, CommandResult } from './types.js'

export type Picker = (zh: string, en: string) => string

export function picker(lang: 'zh' | 'en'): Picker {
  return (zh, en) => (lang === 'zh' ? zh : en)
}

export function pickFor(context: CommandContext): Picker {
  return picker(context.lang ?? 'en')
}

/** 把既有 CommandOutcome 包成三型契约的文本结果，并保留宿主副作用。 */
export function outcomeResult(outcome: CommandOutcome): CommandResult {
  return {
    kind: 'text',
    value: outcome.message ?? outcome.error ?? '',
    outcome
  }
}
