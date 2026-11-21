// SP007 T10 — /doctor 对话框（design §4.2，AC RD-09/10/11）。警告式静态报告，打开时清理过期临时产物。
import { Box, Text } from 'ink'
import { useMemo, useState, type RefObject } from 'react'
import { tmpdir } from 'node:os'
import type { CommandContext } from '../commands/types.js'
import { usePanelInput, type PanelInput } from '../panels.js'
import { buildDoctorReport, cleanupStaleTemp } from './doctor.js'

export function DoctorDialog({ context, close, input }: {
  context: CommandContext; close: (notice?: string) => void
  input: RefObject<PanelInput | undefined>
}) {
  const pick = (zh: string, en: string) => (context.lang === 'zh' ? zh : en)
  // 打开时自动清理过期临时产物（唯一自动修复，D8）；useState 初始化只跑一次。
  const [cleaned] = useState(() => cleanupStaleTemp({ tmpDir: tmpdir() }).cleaned)
  const report = useMemo(() => {
    const doctorInput = context.diagnostics?.doctorInput()
    return doctorInput ? buildDoctorReport(doctorInput) : undefined
  }, [context.diagnostics])
  usePanelInput(input, (_text, key) => {
    if (key.escape || key.return) return close(pick('budingx 诊断已关闭', 'budingx diagnostics dismissed'))
  }, [])
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray">
      <Text bold>{pick('诊断', 'Diagnostics')}</Text>
      {!report && <Text dimColor>{pick('诊断数据不可用', 'Diagnostics unavailable')}</Text>}
      {report && report.sections.map((section) => (
        <Box key={section.title} flexDirection="column" marginTop={1}>
          <Text bold color="#56b6c2">{section.title}</Text>
          {section.lines.map((line, index) => (
            <Text key={index} color={line.startsWith('Warning:') ? 'yellow' : line.startsWith('Fix:') ? 'green' : undefined}>{line}</Text>
          ))}
        </Box>
      ))}
      {report && (
        <Text dimColor>
          {report.warningCount === 0 ? pick('没有发现问题', 'No issues found') : pick('共 ' + report.warningCount + ' 条警告', report.warningCount + ' warning(s)')}
          {cleaned > 0 ? pick(' · 已清理 ' + cleaned + ' 个过期临时文件', ' · cleaned ' + cleaned + ' stale temp file(s)') : ''}
        </Text>
      )}
      <Text dimColor>{pick('Enter/Esc 关闭', 'Enter/Esc close')}</Text>
    </Box>
  )
}
