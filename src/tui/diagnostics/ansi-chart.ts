// SP007 T10 — /stats 折线与 ANSI 截图（design §4.2，AC RD-07/RD-08）。纯字符 asciichart。

/** 计数缩写：<1000 原样；≥1000 k；≥1e6 M（一位小数）。 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (abs >= 1000) return (value / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(Math.round(value))
}

export type LineChartOptions = { height?: number; width?: number }

/**
 * 纯字符折线（top3 模型日用量）。<2 个数据点不画（返回空）。
 * height 默认 8；width 为数据列数（默认 values.length）。y 轴顶端标最大值缩写。
 */
export function lineChart(values: number[], options: LineChartOptions = {}): string[] {
  if (values.length < 2) return []
  const height = Math.max(2, options.height ?? 8)
  const width = Math.max(2, options.width ?? values.length)
  const max = values.reduce((acc, value) => Math.max(acc, value), 0)
  // 重采样到 width 列（最近邻）。
  const columns: number[] = []
  for (let x = 0; x < width; x++) {
    const index = Math.min(values.length - 1, Math.round((x * (values.length - 1)) / (width - 1)))
    columns.push(values[index])
  }
  const grid: string[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => ' '))
  for (let x = 0; x < width; x++) {
    const ratio = max > 0 ? columns[x] / max : 0
    const filled = Math.round(ratio * (height - 1))
    for (let y = 0; y < filled; y++) grid[height - 1 - y][x] = '█'
    if (filled < height) grid[height - 1 - filled][x] = '▄'
  }
  const label = formatCount(max)
  const lines: string[] = []
  for (let y = 0; y < height; y++) {
    const axis = y === 0 ? label.padStart(6) : ' '.repeat(6)
    lines.push(axis + ' ┤' + grid[y].join(''))
  }
  lines.push(' '.repeat(6) + ' └' + '─'.repeat(width))
  return lines
}

const ANSI = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m' }

export type AnsiStats = {
  title: string
  favoriteModel: string
  totalTokens: number
  sessions: number
  activeDays: number
  longestStreak: number
  currentStreak: number
  models: { model: string; tokens: number; percent: number }[]
}

/** 手工 ANSI 色字符串（Ctrl+S 复制截图用，RD-08）。不含终端控制光标序列。 */
export function renderAnsi(stats: AnsiStats): string {
  const lines: string[] = []
  lines.push(ANSI.bold + ANSI.cyan + stats.title + ANSI.reset)
  lines.push(ANSI.dim + 'Favorite model: ' + ANSI.reset + stats.favoriteModel)
  lines.push('Total tokens: ' + ANSI.green + formatCount(stats.totalTokens) + ANSI.reset)
  lines.push('Sessions: ' + stats.sessions + ' · Active days: ' + stats.activeDays)
  lines.push('Streak (longest/current): ' + stats.longestStreak + '/' + stats.currentStreak)
  lines.push(ANSI.bold + 'Models' + ANSI.reset)
  for (const entry of stats.models) {
    lines.push('  ' + ANSI.yellow + entry.model + ANSI.reset + ' ' + entry.percent.toFixed(1) + '% · ' + formatCount(entry.tokens))
  }
  return lines.join('\n')
}
