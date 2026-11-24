import { Box, Text, type Key } from 'ink'
import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { CommandContext } from './commands.js'
import { formatTokens } from './commands.js'
import { exportSelectedSession } from './commands/builtin-extended.js'
import type { ExportFormat } from './export.js'

export type PanelInput = { key: (text: string, key: Key) => void; paste: (text: string) => void }
const searchText = (value: string) => value.normalize('NFKC').toLowerCase()

export function usePanelInput(
  input: RefObject<PanelInput | undefined>,
  handler: (text: string, key: Key) => void,
  deps: unknown[],
  paste: (text: string) => void = () => {}
) {
  useEffect(() => {
    input.current = { key: handler, paste }
    return () => { input.current = undefined }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/** 0.5.4 /resume：当前工作区会话选择面板（严格 cwd 过滤）。 */
export function ResumePicker({ context, close, input, onPick }: {
  context: CommandContext; close: (notice?: string) => void
  input: RefObject<PanelInput | undefined>; onPick: (sessionId: string) => void
}) {
  const pick = (zh: string, en: string) => (context.lang === 'zh' ? zh : en)
  const searchIndex = useMemo(() => {
    const entries = context.sessions?.searchIndex?.() ??
      context.sessions?.list().map((entry) => ({ ...entry, body: '' })) ?? []
    return entries.map(({ body, ...entry }) => ({
      ...entry, indexedTitle: searchText(entry.title), indexedBody: searchText(body)
    }))
  }, [context.sessions])
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const needle = searchText(query.trim())
  const sessions = useMemo(() => searchIndex.map((entry) => ({
    ...entry,
    titleMatch: !needle || entry.indexedTitle.includes(needle),
    bodyMatch: needle !== '' && entry.indexedBody.includes(needle)
  })).filter((entry) => entry.titleMatch || entry.bodyMatch), [searchIndex, needle])
  const selected = Math.min(index, Math.max(0, sessions.length - 1))
  const viewportStart = Math.max(0, selected - 7)
  function appendQuery(text: string) {
    setQuery((value) => (value + text.replace(/\p{Cc}/gu, '')).slice(0, 256))
    setIndex(0)
  }
  usePanelInput(input, (text, key) => {
    if (key.escape) return close()
    if (key.upArrow) return setIndex((v) => Math.max(0, v - 1))
    if (key.downArrow) return setIndex((v) => Math.min(Math.max(0, sessions.length - 1), v + 1))
    if (key.return) {
      if (sessions[selected]) onPick(sessions[selected].sessionId)
      return
    }
    if (key.backspace || key.delete) {
      setQuery((value) => Array.from(value).slice(0, -1).join(''))
      setIndex(0)
      return
    }
    if (text && !key.ctrl && !key.meta && !key.tab) appendQuery(text)
  }, [sessions, selected], appendQuery)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray">
      <Text bold>{pick('恢复会话（当前工作区）', 'Resume session (this workspace)')}</Text>
      <Text>{pick('搜索标题或正文：', 'Search titles or messages: ')}{query || '…'}</Text>
      {sessions.length === 0 && <Text dimColor>{needle
        ? pick('没有匹配的会话', 'No matching sessions')
        : pick('当前工作区没有已保存的会话', 'No saved sessions in this workspace')}</Text>}
      {sessions.slice(viewportStart, viewportStart + 12).map((entry, i) => (
        <Text key={entry.sessionId} color={i + viewportStart === selected ? '#56b6c2' : undefined}>
          {i + viewportStart === selected ? '❯ ' : '  '}{entry.title}  {entry.updatedAt}  {pick('回合', 'turns')} {entry.turns}
          {entry.bodyMatch && !entry.titleMatch ? pick(' · 正文命中', ' · message match') : ''}
        </Text>
      ))}
      <Text dimColor>{pick('↑↓ 选择 · Enter 恢复 · Esc 关闭', 'up/down · Enter resume · Esc close')}</Text>
    </Box>
  )
}

/** SP009 /export：选择要导出的会话（当前会话 + 已保存会话）。 */
export function ExportPicker({ context, current, close, input, options }: {
  context: CommandContext
  current: { id: string; history: readonly unknown[] }
  close: (notice?: string) => void
  input: RefObject<PanelInput | undefined>
  options?: { format: ExportFormat; path?: string }
}) {
  const pick = (zh: string, en: string) => (context.lang === 'zh' ? zh : en)
  const entries = useMemo(() => {
    const saved = (context.sessions?.list() ?? []).filter((entry) => entry.sessionId !== current.id)
    return [
      { sessionId: current.id, title: pick('当前会话', 'Current session'), updatedAt: '', turns: current.history.length },
      ...saved
    ]
  }, [context.sessions, current.id, current.history.length])
  const [index, setIndex] = useState(0)
  const selected = Math.min(index, Math.max(0, entries.length - 1))
  const format = options?.format ?? 'jsonl'
  usePanelInput(input, (text, key) => {
    if (key.escape) return close()
    if (key.upArrow) return setIndex((v) => Math.max(0, v - 1))
    if (key.downArrow) return setIndex((v) => Math.min(entries.length - 1, v + 1))
    if (key.return && entries[selected])
      close(exportSelectedSession(context, { sessionId: entries[selected].sessionId, format, path: options?.path }).message)
  }, [entries, selected, format, options?.path])
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray">
      <Text bold>{pick('导出会话', 'Export session')} ({format.toUpperCase()})</Text>
      {entries.map((entry, i) => (
        <Text key={entry.sessionId} color={i === selected ? '#56b6c2' : undefined}>
          {i === selected ? '❯ ' : '  '}{entry.title}
          {entry.updatedAt ? `  ${entry.updatedAt}` : ''}
          {entry.turns ? `  ${pick('条', 'msgs')} ${entry.turns}` : ''}
        </Text>
      ))}
      <Text dimColor>{pick('↑↓ 选择 · Enter 导出 · Esc 关闭', 'up/down · Enter export · Esc close')}</Text>
    </Box>
  )
}

/** 0.5.4 /rewind：对话+文件检查点选择面板。 */
export function RewindPicker({ context, close, input, onPick }: {
  context: CommandContext; close: (notice?: string) => void
  input: RefObject<PanelInput | undefined>; onPick: (messageId: string) => void
}) {
  const pick = (zh: string, en: string) => (context.lang === 'zh' ? zh : en)
  const checkpoints = useMemo(() => context.session.rewindCheckpoints, [context.session])
  const [index, setIndex] = useState(Math.max(0, checkpoints.length - 1))
  const selected = Math.min(index, Math.max(0, checkpoints.length - 1))
  usePanelInput(input, (text, key) => {
    if (key.escape) return close()
    if (key.upArrow) return setIndex((v) => Math.max(0, v - 1))
    if (key.downArrow) return setIndex((v) => Math.min(Math.max(0, checkpoints.length - 1), v + 1))
    if (key.return && checkpoints[selected]) onPick(checkpoints[selected].id)
  }, [checkpoints, selected])
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray">
      <Text bold>{pick('回滚到检查点（对话+文件）', 'Rewind to checkpoint (conversation + files)')}</Text>
      {checkpoints.length === 0 && <Text dimColor>{pick('没有可回滚的对话检查点', 'No conversation checkpoints')}</Text>}
      {checkpoints.map((entry, i) => (
        <Text key={entry.id} color={i === selected ? '#56b6c2' : undefined}>
          {i === selected ? '❯ ' : '  '}{entry.text.slice(0, 60)}
        </Text>
      ))}
      <Text dimColor>{pick('↑↓ 选择 · Enter 回滚 · Esc 关闭（不回滚外部副作用）', 'up/down · Enter rewind · Esc close (no external side-effect rollback)')}</Text>
    </Box>
  )
}

const GRID_COLS = 20
const GRID_ROWS = 5
/** 0.5.4 /context：System/Tools/History 占用彩色网格。 */
export function ContextGrid({ context, close, input }: {
  context: CommandContext; close: (notice?: string) => void
  input: RefObject<PanelInput | undefined>
}) {
  const pick = (zh: string, en: string) => (context.lang === 'zh' ? zh : en)
  usePanelInput(input, (_text, key) => { if (key.escape || key.return) close() }, [])
  const usage = context.contextUsage?.usage()
  const budget = context.context?.budget()
  const max = usage?.maxTokens ?? budget?.maxTokens ?? 200000
  const history = budget?.estimatedTokens ?? usage?.usedTokens ?? 0
  const system = 1200
  const tools = 800
  const used = Math.min(max, history + system + tools)
  const cells = GRID_COLS * GRID_ROWS
  const sysCells = Math.round((system / max) * cells)
  const toolCells = Math.round((tools / max) * cells)
  const histCells = Math.round((history / max) * cells)
  const grid: string[] = []
  for (let i = 0; i < cells; i++) {
    grid.push(i < sysCells ? 'sys' : i < sysCells + toolCells ? 'tool' : i < sysCells + toolCells + histCells ? 'hist' : 'free')
  }
  const color = (kind: string) => kind === 'sys' ? 'gray' : kind === 'tool' ? 'blue' : kind === 'hist' ? 'green' : undefined
  const rows: string[][] = []
  for (let r = 0; r < GRID_ROWS; r++) rows.push(grid.slice(r * GRID_COLS, (r + 1) * GRID_COLS))
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray">
      <Text bold>{pick('上下文窗口占用', 'Context window usage')}</Text>
      {rows.map((row, r) => (
        <Text key={r}>{row.map((kind, c) => <Text key={c} color={color(kind)} dimColor={kind === 'free'}>■ </Text>)}</Text>
      ))}
      <Text><Text color="gray">■</Text> System {formatTokens(system)}  <Text color="blue">■</Text> Tools {formatTokens(tools)}  <Text color="green">■</Text> History {formatTokens(history)}</Text>
      <Text dimColor>{pick(`已用 ${formatTokens(used)} / ${formatTokens(max)} token`, `Used ${formatTokens(used)} / ${formatTokens(max)} tokens`)}</Text>
      <Text dimColor>{pick('Esc/Enter 关闭', 'Esc/Enter close')}</Text>
    </Box>
  )
}
