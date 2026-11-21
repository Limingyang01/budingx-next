// SP007 T10 — /stats 对话框（design §4.2，AC RD-04…08）。Overview/Models 页，r 循环范围。
import { Box, Text } from 'ink'
import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { CommandContext } from '../commands/types.js'
import { usePanelInput, type PanelInput } from '../panels.js'
import { scanStats, computeOverview, computeModels, modelDailySeries, dayTotals } from './stats.js'
import { heatmapGrid } from './heatmap.js'
import { lineChart, formatCount, renderAnsi } from './ansi-chart.js'

const RANGES = ['all', '7d', '30d'] as const
type Range = (typeof RANGES)[number]

export function StatsDialog({ context, close, input }: {
  context: CommandContext; close: (notice?: string) => void
  input: RefObject<PanelInput | undefined>
}) {
  const pick = (zh: string, en: string) => (context.lang === 'zh' ? zh : en)
  const port = context.diagnostics
  const [page, setPage] = useState(0)
  const [rangeIndex, setRangeIndex] = useState(0)
  const [modelScroll, setModelScroll] = useState(0)
  const [copied, setCopied] = useState(false)
  const range: Range = RANGES[rangeIndex]
  const data = useMemo(() => {
    if (!port) return undefined
    const ranged = scanStats({ sessionsDir: port.sessionsDir, today: port.today, range, cachePath: port.cachePath })
    const all = range === 'all' ? ranged.stats : scanStats({ sessionsDir: port.sessionsDir, today: port.today, range: 'all', cachePath: port.cachePath }).stats
    return {
      overview: computeOverview(ranged.stats, { today: port.today, fromDate: ranged.fromDate }),
      models: computeModels(ranged.stats, { fromDate: ranged.fromDate }),
      heatmap: heatmapGrid(dayTotals(all), { endDate: port.today, weeks: 12 }),
      series: (model: string) => modelDailySeries(ranged.stats, model, ranged.fromDate)
    }
  }, [port, range])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  usePanelInput(input, (_text, key) => {
    if (key.escape || (key.ctrl && (key.return || _text === 'c' || _text === 'd'))) {
      return close(pick('Stats 面板已关闭', 'Stats dialog dismissed'))
    }
    if (key.tab) return setPage((value) => (value + 1) % 2)
    if (_text === 'r') { setRangeIndex((value) => (value + 1) % RANGES.length); setModelScroll(0); return }
    if (key.upArrow) return setModelScroll((value) => Math.max(0, value - 2))
    if (key.downArrow) return setModelScroll((value) => value + 2)
    if (key.ctrl && _text === 's') {
      if (data && port?.copyToClipboard) {
        const ok = port.copyToClipboard(renderAnsi({
          title: 'budingx statistics (' + range + ')',
          favoriteModel: data.overview.favoriteModel,
          totalTokens: data.overview.totalTokens,
          sessions: data.overview.sessions,
          activeDays: data.overview.activeDays,
          longestStreak: data.overview.longestStreak,
          currentStreak: data.overview.currentStreak,
          models: data.models.slice(0, 8)
        }))
        if (ok) setCopied(true)
      }
    }
  }, [data, range, port])
  const overview = data?.overview
  const models = data?.models ?? []
  const visibleModels = models.slice(modelScroll, modelScroll + 8)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray">
      <Text bold>{pick('用量统计', 'Statistics')} <Text dimColor>({range})</Text></Text>
      <Text>
        <Text color={page === 0 ? '#56b6c2' : undefined} bold={page === 0}>{page === 0 ? '[Overview]' : ' Overview '}</Text>
        <Text color={page === 1 ? '#56b6c2' : undefined} bold={page === 1}>{page === 1 ? '[Models]' : ' Models '}</Text>
      </Text>
      {!data && <Text dimColor>{pick('诊断数据不可用', 'Diagnostics unavailable')}</Text>}
      {data && page === 0 && overview && (
        <Box flexDirection="column">
          {data.heatmap.rows.map((row, index) => <Text key={index} dimColor>{row}</Text>)}
          <Text><Text bold>{pick('常用模型', 'Favorite model')}: </Text>{overview.favoriteModel}</Text>
          <Text><Text bold>{pick('总 token', 'Total tokens')}: </Text>{formatCount(overview.totalTokens)}</Text>
          <Text><Text bold>{pick('会话数', 'Sessions')}: </Text>{overview.sessions}</Text>
          <Text><Text bold>{pick('活跃天数', 'Active days')}: </Text>{overview.activeDays}</Text>
          <Text><Text bold>{pick('最长连续', 'Longest streak')}: </Text>{overview.longestStreak} · <Text bold>{pick('当前连续', 'Current')}: </Text>{overview.currentStreak}</Text>
          {overview.longestSession && <Text><Text bold>{pick('最长会话', 'Longest session')}: </Text>{overview.longestSession.messages} {pick('条消息', 'messages')}</Text>}
          {overview.mostActiveDay && <Text><Text bold>{pick('最活跃日', 'Most active day')}: </Text>{overview.mostActiveDay.date} ({formatCount(overview.mostActiveDay.tokens)})</Text>}
        </Box>
      )}
      {data && page === 1 && (
        <Box flexDirection="column">
          {models.slice(0, 3).map((entry) => {
            const series = data.series(entry.model)
            const chart = lineChart(series.values, { height: 8, width: Math.min(52, Math.max(20, (process.stdout.columns ?? 80) - 7)) })
            return (
              <Box key={entry.model} flexDirection="column">
                <Text bold>{entry.model}</Text>
                {chart.length === 0 ? <Text dimColor>{pick('数据不足（<2 天）', 'Not enough data (<2 days)')}</Text> : chart.map((line, index) => <Text key={index}>{line}</Text>)}
              </Box>
            )
          })}
          {visibleModels.map((entry) => (
            <Text key={entry.model}>{entry.model}  {entry.percent.toFixed(1)}%  In: {formatCount(entry.input)} · Out: {formatCount(entry.output)}</Text>
          ))}
        </Box>
      )}
      {copied && <Text color="green">{pick('已复制 ANSI 截图到剪贴板', 'ANSI screenshot copied to clipboard')}</Text>}
      <Text dimColor>{pick('Tab 切页 · r 范围(all/7d/30d) · ↑↓ 滚动 · Ctrl+S 复制 · Esc 关闭', 'Tab page · r range · up/down scroll · Ctrl+S copy · Esc close')}</Text>
    </Box>
  )
}
