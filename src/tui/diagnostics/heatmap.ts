// SP007 T10 — /stats 热力图（design §4.2，AC RD-06）。纯函数：周列×7 行强度字符。
// 恒 all-time（参考行为）；endDate 所在周为最后一列，向前 weeks-1 周。

const LEVELS = [' ', '░', '▒', '▓', '█']

export type Heatmap = { rows: string[]; columns: number; max: number; total: number }

/** 计数→强度字符（0→空格；按 max 比例分 4 档）。 */
export function intensityChar(count: number, max: number): string {
  if (count <= 0 || max <= 0) return LEVELS[0]
  const ratio = count / max
  if (ratio <= 0.25) return LEVELS[1]
  if (ratio <= 0.5) return LEVELS[2]
  if (ratio <= 0.75) return LEVELS[3]
  return LEVELS[4]
}

function toDateKey(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return y + '-' + m + '-' + d
}

/**
 * 生成 7 行（周日→周六）×weeks 列的热力图。dayTotals 键为 YYYY-MM-DD。
 * 超出 endDate 的未来日期留空；缺省日期计 0。
 */
export function heatmapGrid(dayTotals: Record<string, number>, options: { endDate: string; weeks: number }): Heatmap {
  const weeks = Math.max(1, options.weeks)
  const end = new Date(options.endDate + 'T00:00:00Z')
  // 对齐到 endDate 所在周的周六（最后一列的周末）。
  const endWeekday = end.getUTCDay() // 0=Sun..6=Sat
  const lastSaturday = new Date(end)
  lastSaturday.setUTCDate(end.getUTCDate() + (6 - endWeekday))
  const max = Object.values(dayTotals).reduce((acc, value) => Math.max(acc, value), 0)
  let total = 0
  const rows: string[] = []
  for (let weekday = 0; weekday < 7; weekday++) {
    let row = ''
    for (let week = 0; week < weeks; week++) {
      // 最后一列周末 lastSaturday，向前 (weeks-1-week) 周，再回退到该周 weekday。
      const cell = new Date(lastSaturday)
      cell.setUTCDate(lastSaturday.getUTCDate() - (weeks - 1 - week) * 7 - (6 - weekday))
      const key = toDateKey(cell)
      if (cell.getTime() > end.getTime()) {
        row += LEVELS[0]
        continue
      }
      const count = dayTotals[key] ?? 0
      total += count
      row += intensityChar(count, max)
    }
    rows.push(row)
  }
  return { rows, columns: weeks, max, total }
}
