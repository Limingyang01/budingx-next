// SP007 T10 — /stats 聚合（design §4.2，AC RD-04/05/06/07）。
// 扫 ~/.budingx/sessions/*/transcript.jsonl＋<session>/subagents/agent-*.jsonl；
// message 记录 usage 按模型按日累加；subagent 计 token 不计会话；旧转录无 model→unknown 桶。
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type ModelUsage = { input: number; output: number }
export type StatsData = {
  days: Record<string, Record<string, ModelUsage>>
  sessions: number
  sessionMessages: Record<string, number>
  toolUses: number
  subagentTokens: ModelUsage
}

export function emptyStats(): StatsData {
  return { days: {}, sessions: 0, sessionMessages: {}, toolUses: 0, subagentTokens: { input: 0, output: 0 } }
}

function addUsage(day: Record<string, ModelUsage>, model: string, usage: { inputTokens?: number; outputTokens?: number }): void {
  const entry = (day[model] ??= { input: 0, output: 0 })
  entry.input += usage.inputTokens ?? 0
  entry.output += usage.outputTokens ?? 0
}

/** 摄入一条转录记录（纯函数，便于单测）。isSubagent 时计 token 不计会话。 */
export function ingestRecord(stats: StatsData, record: any, opts: { isSubagent: boolean; sessionId: string }): void {
  if (!record || typeof record !== 'object') return
  const date = typeof record.ts === 'string' ? record.ts.slice(0, 10) : undefined
  if (record.type === 'message') {
    if (!opts.isSubagent) {
      stats.sessionMessages[opts.sessionId] = (stats.sessionMessages[opts.sessionId] ?? 0) + 1
    }
    if (record.role === 'assistant' && record.usage && date) {
      const model = typeof record.model === 'string' && record.model ? record.model : 'unknown'
      if (opts.isSubagent) {
        stats.subagentTokens.input += record.usage.inputTokens ?? 0
        stats.subagentTokens.output += record.usage.outputTokens ?? 0
      }
      addUsage((stats.days[date] ??= {}), model, record.usage)
    }
    if (Array.isArray(record.blocks)) {
      for (const block of record.blocks) {
        if (block && block.type === 'tool_use') stats.toolUses++
      }
    }
  }
}

export function dayTotals(stats: StatsData, fromDate?: string): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const [date, models] of Object.entries(stats.days)) {
    if (fromDate && date < fromDate) continue
    let sum = 0
    for (const usage of Object.values(models)) sum += usage.input + usage.output
    if (sum > 0) totals[date] = sum
  }
  return totals
}

function shiftDate(date: string, deltaDays: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

/** 连续活跃天数：longest 历史最长；current 截至 today（或 yesterday）的连续段。 */
export function computeStreaks(dayKeys: string[], today: string): { longest: number; current: number } {
  const active = new Set(dayKeys)
  const sorted = [...active].sort()
  let longest = 0
  let run = 0
  let previous: string | undefined
  for (const day of sorted) {
    if (previous && shiftDate(previous, 1) === day) run++
    else run = 1
    longest = Math.max(longest, run)
    previous = day
  }
  let anchor = today
  if (!active.has(anchor)) anchor = shiftDate(today, -1)
  let current = 0
  while (active.has(anchor)) {
    current++
    anchor = shiftDate(anchor, -1)
  }
  return { longest, current }
}

export type Overview = {
  favoriteModel: string
  totalTokens: number
  sessions: number
  activeDays: number
  longestSession: { sessionId: string; messages: number } | undefined
  longestStreak: number
  currentStreak: number
  mostActiveDay: { date: string; tokens: number } | undefined
  dayTotals: Record<string, number>
}

export function computeOverview(stats: StatsData, opts: { today: string; fromDate?: string }): Overview {
  const totals = dayTotals(stats, opts.fromDate)
  const modelTotals: Record<string, number> = {}
  let totalTokens = 0
  for (const [date, models] of Object.entries(stats.days)) {
    if (opts.fromDate && date < opts.fromDate) continue
    for (const [model, usage] of Object.entries(models)) {
      const sum = usage.input + usage.output
      modelTotals[model] = (modelTotals[model] ?? 0) + sum
      totalTokens += sum
    }
  }
  const favoriteModel = Object.entries(modelTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
  const dayKeys = Object.keys(totals)
  const streaks = computeStreaks(dayKeys, opts.today)
  let longestSession: { sessionId: string; messages: number } | undefined
  for (const [sessionId, messages] of Object.entries(stats.sessionMessages)) {
    if (!longestSession || messages > longestSession.messages) longestSession = { sessionId, messages }
  }
  let mostActiveDay: { date: string; tokens: number } | undefined
  for (const [date, tokens] of Object.entries(totals)) {
    if (!mostActiveDay || tokens > mostActiveDay.tokens) mostActiveDay = { date, tokens }
  }
  return {
    favoriteModel,
    totalTokens,
    sessions: stats.sessions,
    activeDays: dayKeys.length,
    longestSession,
    longestStreak: streaks.longest,
    currentStreak: streaks.current,
    mostActiveDay,
    dayTotals: totals
  }
}

export type ModelEntry = { model: string; tokens: number; input: number; output: number; percent: number }

export function computeModels(stats: StatsData, opts: { fromDate?: string } = {}): ModelEntry[] {
  const acc: Record<string, ModelUsage> = {}
  let total = 0
  for (const [date, models] of Object.entries(stats.days)) {
    if (opts.fromDate && date < opts.fromDate) continue
    for (const [model, usage] of Object.entries(models)) {
      const entry = (acc[model] ??= { input: 0, output: 0 })
      entry.input += usage.input
      entry.output += usage.output
      total += usage.input + usage.output
    }
  }
  return Object.entries(acc)
    .map(([model, usage]) => ({
      model,
      tokens: usage.input + usage.output,
      input: usage.input,
      output: usage.output,
      percent: total > 0 ? ((usage.input + usage.output) / total) * 100 : 0
    }))
    .sort((a, b) => b.tokens - a.tokens)
}

/** 模型日用量序列（折线用，按日期升序，缺日补 0）。 */
export function modelDailySeries(stats: StatsData, model: string, fromDate?: string): { dates: string[]; values: number[] } {
  const dates = Object.keys(stats.days).filter((date) => !fromDate || date >= fromDate).sort()
  const values = dates.map((date) => {
    const usage = stats.days[date]?.[model]
    return usage ? usage.input + usage.output : 0
  })
  return { dates, values }
}

export const STATS_CACHE_VERSION = 1
export type StatsCache = { version: number; computedThrough: string; stats: StatsData }

function readJsonl(file: string): any[] {
  const records: any[] = []
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return records
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line))
    } catch {
      // 损坏行跳过（不迁移不重算）
    }
  }
  return records
}

export type ScanOptions = { sessionsDir: string; today: string; range: 'all' | '7d' | '30d'; cachePath?: string }

/**
 * 扫描会话转录聚合。range 7d/30d 绕过缓存（fromDate=today-(days-1)）；
 * all 用缓存覆盖到昨天，今天恒实时。subagent 转录计 token 不计会话。
 */
export function scanStats(options: ScanOptions): { stats: StatsData; fromDate?: string } {
  const days = options.range === '7d' ? 7 : options.range === '30d' ? 30 : 0
  const fromDate = days > 0 ? shiftDate(options.today, -(days - 1)) : undefined
  let cache: StatsCache | undefined
  if (options.range === 'all' && options.cachePath && existsSync(options.cachePath)) {
    try {
      const parsed = JSON.parse(readFileSync(options.cachePath, 'utf8'))
      // 版本更旧→全量重算；computedThrough 必须 < today 才可作历史基础。
      if (parsed && parsed.version === STATS_CACHE_VERSION && parsed.stats && parsed.computedThrough < options.today) {
        cache = parsed
      }
    } catch {
      cache = undefined
    }
  }
  const stats: StatsData = cache ? cache.stats : emptyStats()
  const historicalSessions = new Set(cache ? Object.keys(cache.stats.sessionMessages) : [])
  // 缓存命中只重算今天；7d/30d 绕过缓存按 fromDate；all 无缓存全量。
  const skipBefore = cache ? options.today : fromDate
  const skipMs = skipBefore ? new Date(skipBefore + 'T00:00:00Z').getTime() : undefined
  let sessionDirs: string[] = []
  try {
    sessionDirs = readdirSync(options.sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    sessionDirs = []
  }
  const countedSessions = new Set<string>()
  let newSessions = 0
  const ingestFile = (file: string, isSubagent: boolean, sessionId: string): boolean => {
    let hasMessage = false
    for (const record of readJsonl(file)) {
      const date = typeof record.ts === 'string' ? record.ts.slice(0, 10) : undefined
      if (skipBefore && date && date < skipBefore) continue
      if (record?.type === 'message') hasMessage = true
      ingestRecord(stats, record, { isSubagent, sessionId })
    }
    return hasMessage
  }
  for (const sessionId of sessionDirs) {
    const dir = join(options.sessionsDir, sessionId)
    const transcript = join(dir, 'transcript.jsonl')
    let mtimeOk = true
    if (skipMs !== undefined) {
      try {
        mtimeOk = statSync(transcript).mtimeMs >= skipMs
      } catch {
        mtimeOk = false
      }
    }
    if (mtimeOk && existsSync(transcript)) {
      const hasMessage = ingestFile(transcript, false, sessionId)
      if (hasMessage) {
        countedSessions.add(sessionId)
        if (cache && !historicalSessions.has(sessionId)) newSessions++
      }
    }
    const subDir = join(dir, 'subagents')
    if (existsSync(subDir)) {
      let files: string[] = []
      try {
        files = readdirSync(subDir).filter((name) => name.startsWith('agent-') && name.endsWith('.jsonl'))
      } catch {
        files = []
      }
      for (const name of files) ingestFile(join(subDir, name), true, sessionId)
    }
  }
  stats.sessions = cache ? cache.stats.sessions + newSessions : countedSessions.size
  if (options.range === 'all' && options.cachePath) {
    const yesterday = shiftDate(options.today, -1)
    const payload: StatsCache = { version: STATS_CACHE_VERSION, computedThrough: yesterday, stats }
    try {
      writeFileSync(options.cachePath, JSON.stringify(payload), { mode: 0o600 })
    } catch {
      // 缓存写失败不影响本次结果
    }
  }
  return { stats, fromDate }
}
