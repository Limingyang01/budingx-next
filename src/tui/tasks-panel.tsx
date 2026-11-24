import { stripVTControlCharacters } from 'node:util'
import { Box, Text, useWindowSize } from 'ink'
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { AgentState } from '../core/agent-runtime.js'
import type { CommandOutcome } from '../core/exec.js'
import { usePanelInput, type PanelInput } from './panels.js'

type TaskStatus = AgentState | CommandOutcome

export type TasksPanelRow = {
  id: string
  kind: 'shell' | 'agent'
  title: string
  status: TaskStatus
  exitCode?: number
  exitReason?: string
}

type TaskLog = { text: string; truncated?: boolean } | { reason: 'no-log' | 'unavailable' }
type TaskStop = 'requested' | 'already-finished' | 'unavailable'

export type TasksPanelPort = {
  list(): readonly TasksPanelRow[]
  readLog(row: TasksPanelRow): TaskLog
  stop(row: TasksPanelRow): { result: TaskStop } | Promise<{ result: TaskStop }>
}

const ZH_STATUS: Record<TaskStatus, string> = {
  running: '运行中',
  backgrounded: '后台运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  timeout: '超时',
  blocked: '已阻止'
}

const taskKey = ({ kind, id }: TasksPanelRow) => `${kind}:${id}`
const isRunning = ({ status }: TasksPanelRow) => status === 'running' || status === 'backgrounded'

function terminalLines(text: string): string[] {
  return stripVTControlCharacters(text).trimEnd().split(/\r?\n/).map((line) => line
    .replace(/\t/g, '    ')
    .replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, ''))
}

function readTaskLog(tasks: TasksPanelPort, row: TasksPanelRow): TaskLog {
  try {
    return tasks.readLog(row)
  } catch {
    return { reason: 'unavailable' }
  }
}

export function TasksPanel({ tasks, lang, close, input }: {
  tasks?: TasksPanelPort
  lang: 'zh' | 'en'
  close: () => void
  input: RefObject<PanelInput | undefined>
}) {
  const [selectedKey, setSelectedKey] = useState<string>()
  const [detailKey, setDetailKey] = useState<string>()
  const [snapshot, setSnapshot] = useState<{
    rows: readonly TasksPanelRow[]
    log?: { key: string; data: TaskLog }
  }>(() => ({ rows: tasks?.list() ?? [] }))
  const [logOffset, setLogOffset] = useState(0)
  const [confirm, setConfirm] = useState<TasksPanelRow>()
  const confirmRef = useRef<TasksPanelRow | undefined>(undefined)
  const [stopState, setStopState] = useState<{
    key: string
    result: TaskStop | 'pending'
  }>()
  const pick = (zh: string, en: string) => lang === 'zh' ? zh : en
  const { rows: terminalRows } = useWindowSize()
  const viewportSize = Math.min(10, Math.max(1, terminalRows - 10))
  const rows = [
    ...snapshot.rows.filter((row) => row.kind === 'shell'),
    ...snapshot.rows.filter((row) => row.kind === 'agent')
  ]
  const selectedIndex = Math.max(0, rows.findIndex((row) => taskKey(row) === selectedKey))
  const viewportStart = Math.max(0, selectedIndex - viewportSize + 1)
  const detail = rows.find((row) => taskKey(row) === detailKey)
  const active = detailKey ? detail : rows[selectedIndex]
  const notice = active && stopState?.key === taskKey(active) ? stopState.result : undefined
  const log = snapshot.log?.key === detailKey ? snapshot.log?.data : undefined
  const lines = log && 'text' in log && log.text.trim() ? terminalLines(log.text) : []
  const maxLogOffset = Math.max(0, lines.length - viewportSize)
  const logEnd = lines.length - Math.min(logOffset, maxLogOffset)
  const typeLabel = (row: TasksPanelRow) =>
    row.kind === 'shell' ? 'Shell' : pick('子代理', 'Agent')
  const statusLabel = (row: TasksPanelRow) =>
    lang === 'zh' ? ZH_STATUS[row.status] : row.status
  const title = (row: TasksPanelRow) => terminalLines(row.title).join(' ')

  useEffect(() => {
    const refresh = () => {
      const rows = tasks?.list() ?? []
      const detail = rows.find((row) => taskKey(row) === detailKey)
      setSnapshot({
        rows,
        ...(tasks && detail ? { log: { key: taskKey(detail), data: readTaskLog(tasks, detail) } } : {})
      })
    }
    refresh()
    const timer = setInterval(refresh, 500)
    return () => clearInterval(timer)
  }, [tasks, detailKey, stopState])

  async function stopTask(row: TasksPanelRow) {
    const key = taskKey(row)
    setStopState({ key, result: 'pending' })
    try {
      setStopState({ key, result: (await tasks?.stop(row))?.result ?? 'unavailable' })
    } catch {
      setStopState({ key, result: 'unavailable' })
    }
  }

  usePanelInput(input, (text, key) => {
    const shortcut = !key.ctrl && !key.meta && !key.super ? text.toLowerCase() : ''
    if (confirm) {
      if (!confirmRef.current || !(shortcut === 'y' || shortcut === 'n' || key.escape)) return
      confirmRef.current = undefined
      setConfirm(undefined)
      if (shortcut === 'y') void stopTask(confirm)
      return
    }
    if (key.escape) {
      if (detailKey) {
        setDetailKey(undefined)
        setLogOffset(0)
      } else {
        close()
      }
      return
    }
    if (shortcut === 's' && active && stopState?.result !== 'pending') {
      if (!isRunning(active)) {
        setStopState({ key: taskKey(active), result: 'already-finished' })
        return
      }
      confirmRef.current = active
      setConfirm(active)
      return
    }
    if (detailKey) {
      if (key.upArrow) setLogOffset((offset) => Math.min(maxLogOffset, offset + 1))
      if (key.downArrow) setLogOffset((offset) => Math.max(0, Math.min(maxLogOffset, offset) - 1))
      if (key.pageUp) setLogOffset((offset) => Math.min(maxLogOffset, offset + viewportSize))
      if (key.pageDown)
        setLogOffset((offset) => Math.max(0, Math.min(maxLogOffset, offset) - viewportSize))
      return
    }
    if (key.return && active) {
      setSelectedKey(taskKey(active))
      setDetailKey(taskKey(active))
    }
    if (key.upArrow || key.downArrow) {
      const target = rows[selectedIndex + (key.upArrow ? -1 : 1)]
      if (target) setSelectedKey(taskKey(target))
    }
  }, [tasks, rows, selectedIndex, detailKey, confirm, stopState, maxLogOffset, viewportSize])

  const stopMessage = {
    pending: pick('正在请求停止…', 'Requesting stop…'),
    requested: pick('已请求停止。', 'Stop requested.'),
    'already-finished': pick('任务已结束。', 'Task already finished.'),
    unavailable: pick('当前会话无法停止该任务。', 'This session cannot stop the task.')
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray">
      <Text bold>{detailKey ? pick('任务详情', 'Task details') : pick('后台任务', 'Background tasks')}</Text>
      {!detailKey && rows.length === 0 &&
        <Text dimColor>{pick('当前会话没有后台任务。', 'No background tasks in this session.')}</Text>}
      {!detailKey && rows.slice(viewportStart, viewportStart + viewportSize).map((row, index) => {
        const selected = viewportStart + index === selectedIndex
        return (
          <Text key={taskKey(row)} color={selected ? '#56b6c2' : undefined} wrap="truncate-end">
            {selected ? '> ' : '  '}{typeLabel(row)} · {statusLabel(row)} · {title(row)} [{row.id.slice(0, 8)}]
          </Text>
        )
      })}
      {detailKey && !detail && <Text dimColor>{pick('当前会话已无法查看该任务。', 'Task is unavailable in this session.')}</Text>}
      {detail && (
        <>
          <Text bold wrap="truncate-end">{title(detail)} [{detail.id.slice(0, 8)}]</Text>
          <Text>{typeLabel(detail)} · {statusLabel(detail)}</Text>
          {detail.exitCode !== undefined && <Text>{pick('退出码', 'Exit code')} {detail.exitCode}</Text>}
          {!isRunning(detail) && detail.exitReason && (
            <Text wrap="truncate-end">{pick('退出原因', 'Exit reason')} {terminalLines(detail.exitReason).join(' ')}</Text>
          )}
          {log && 'text' in log && (
            <>
              <Text bold>
                {pick('日志尾部', 'Log tail')}
                {log.truncated && pick('（早期输出已截断）', ' (earlier output truncated)')}
              </Text>
              {lines.slice(Math.max(0, logEnd - viewportSize), logEnd).map((line, index) =>
                <Text key={index} wrap="truncate-start">{line || ' '}</Text>
              )}
              {lines.length === 0 && <Text dimColor>{pick('暂无日志输出。', 'No log output yet.')}</Text>}
            </>
          )}
          {log && 'reason' in log && (
            <Text dimColor>{log.reason === 'no-log'
              ? pick('该任务未记录日志。', 'No log is recorded for this task.')
              : pick('当前会话无法读取任务日志。', 'Task log is unavailable in this session.')}</Text>
          )}
        </>
      )}
      {notice && !confirm && <Text color="yellow">{stopMessage[notice]}</Text>}
      {confirm ? (
        <>
          <Text color="yellow" wrap="truncate-end">{pick(`停止 ${title(confirm)}？`, `Stop ${title(confirm)}?`)}</Text>
          <Text dimColor>{pick('y 确认停止 · n/Esc 返回', 'y Stop · n/Esc Cancel')}</Text>
        </>
      ) : (
        <Text dimColor>{detailKey
          ? pick('↑↓/PgUp/PgDn 日志 · s 停止 · Esc 返回', 'Up/Down/PgUp/PgDn log · s Stop · Esc back')
          : pick('↑↓ 选择 · Enter 详情 · s 停止 · Esc 关闭', 'Up/Down select · Enter details · s Stop · Esc close')}</Text>
      )}
    </Box>
  )
}
