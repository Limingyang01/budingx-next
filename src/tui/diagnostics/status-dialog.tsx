// SP007 T10 — /status 对话框（design §4.2，AC RD-01/02/03）。三页签 Status/Config/Usage。
import { Box, Text } from 'ink'
import { useMemo, useState, type RefObject } from 'react'
import type { CommandContext } from '../commands/types.js'
import { usePanelInput, type PanelInput } from '../panels.js'
import { assembleStatusReport, type StatusField } from './status-report.js'

const TABS = ['Status', 'Config', 'Usage'] as const

function dialogHeight(): number {
  const rows = process.stdout.rows ?? 40
  return Math.max(15, Math.min(Math.floor(rows * 0.8), 30))
}

export function StatusDialog({ context, close, input }: {
  context: CommandContext; close: (notice?: string) => void
  input: RefObject<PanelInput | undefined>
}) {
  const pick = (zh: string, en: string) => (context.lang === 'zh' ? zh : en)
  const report = useMemo(() => {
    const input = context.diagnostics?.statusInput()
    return input ? assembleStatusReport(input) : undefined
  }, [context.diagnostics])
  const [tab, setTab] = useState(0)
  usePanelInput(input, (_text, key) => {
    if (key.escape) return close(pick('Status 面板已关闭', 'Status dialog dismissed'))
    if (key.tab) return setTab((value) => (value + 1) % TABS.length)
  }, [tab])
  const fields: StatusField[] = report ? (tab === 0 ? report.status : tab === 1 ? report.config : report.usage) : []
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" height={dialogHeight()}>
      <Text bold>{pick('状态', 'Status')}</Text>
      <Text>
        {TABS.map((name, index) => (
          <Text key={name} color={index === tab ? '#56b6c2' : undefined} bold={index === tab}>
            {index === tab ? '[' + name + ']' : ' ' + name + ' '}
          </Text>
        ))}
      </Text>
      {!report && <Text dimColor>{pick('诊断数据不可用', 'Diagnostics unavailable')}</Text>}
      {fields.map((field) => (
        <Text key={field.label}><Text bold>{field.label}: </Text>{field.value}</Text>
      ))}
      <Text dimColor>{pick('Tab 切换页签 · Esc 关闭', 'Tab switch · Esc close')}</Text>
    </Box>
  )
}
