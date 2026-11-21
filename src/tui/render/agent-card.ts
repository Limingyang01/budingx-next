// SP007 T9：子代理卡片纯渲染（design §4.1 卡片段）。
// 与后台 shell 六件套分离：代理卡片由 agent_* 事件驱动，标题=description，
// 8 色按 agentType（general-purpose 无色），运行中仅显最后 3 条工具＋ctrl+o 展开提示，
// ≥2s 显 ctrl+b 后台化提示，完成显 Done(工具数·tokens·时长)，并行≥2 显树行。
import { AGENT_COLORS } from '../../core/agent-definitions.js'
import type { AgentState } from '../../core/agent-runtime.js'

export type AgentCardInput = {
  agentId: string
  agentType: string
  description: string
  color?: string
  state: AgentState
  background: boolean
  toolUses: number
  tokens: number
  lastTools: string[]
  startedAt: number
  finishedAt?: number
  result?: string
}

export type AgentCard = {
  title: string
  color?: string
  lines: string[]
  footer?: string
}

/** general-purpose 无色；其余按 agentType 稳定取 8 色之一（定义显式 color 优先）。 */
export function agentColor(agentType: string, explicit?: string): string | undefined {
  if (explicit) return explicit
  if (agentType === 'general-purpose') return undefined
  let hash = 0
  for (let index = 0; index < agentType.length; index += 1) {
    hash = (hash * 31 + agentType.charCodeAt(index)) >>> 0
  }
  return AGENT_COLORS[hash % AGENT_COLORS.length]
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

function usageSuffix(record: AgentCardInput): string {
  return `${record.toolUses} tool uses · ${record.tokens} tokens`
}

/** 单张代理卡片。compact＝高度不足单行；now 用于运行时长与 ctrl+b 提示。 */
export function agentCardLines(record: AgentCardInput, options?: { now?: number; compact?: boolean }): AgentCard {
  const now = options?.now ?? Date.now()
  const color = agentColor(record.agentType, record.color)
  const title = record.description
  if (record.state === 'running' || record.state === 'backgrounded') {
    const elapsed = now - record.startedAt
    if (options?.compact) {
      return { title, color, lines: [`In progress… · ${usageSuffix(record)}`] }
    }
    const lines: string[] = []
    if (record.toolUses === 0) {
      lines.push('Initializing…')
    } else {
      const lastThree = record.lastTools.slice(-3)
      lines.push(...lastThree)
      if (record.toolUses > 3) lines.push(`+${record.toolUses - 3} more tool uses (ctrl+o expand)`)
    }
    if (record.state === 'backgrounded') {
      return { title, color, lines, footer: 'Backgrounded agent (↓ manage)' }
    }
    let footer = `In progress… · ${usageSuffix(record)}`
    if (elapsed >= 2000) footer += ' · ctrl+b to background'
    return { title, color, lines, footer }
  }
  const duration = formatDuration((record.finishedAt ?? now) - record.startedAt)
  if (record.state === 'completed') {
    return { title, color, lines: [`Done (${usageSuffix(record)} · ${duration})`] }
  }
  if (record.state === 'cancelled') {
    return { title, color: 'red', lines: [`Cancelled (${usageSuffix(record)} · ${duration})`] }
  }
  return { title, color: 'red', lines: [`Failed (${usageSuffix(record)} · ${duration})`] }
}

/** 并行代理树：≥2 个运行中代理时显「Running N agents…」＋├─/└─ 树行。 */
export function agentTreeLines(records: readonly AgentCardInput[], options?: { now?: number }): string[] {
  const running = records.filter((record) => record.state === 'running' || record.state === 'backgrounded')
  if (running.length < 2) return []
  const lines = [`Running ${running.length} agents…`]
  running.forEach((record, index) => {
    const branch = index === running.length - 1 ? '└─' : '├─'
    const card = agentCardLines(record, { ...(options?.now !== undefined ? { now: options.now } : {}), compact: true })
    lines.push(`${branch} ${record.description} · ${card.lines[0]}`)
  })
  return lines
}
