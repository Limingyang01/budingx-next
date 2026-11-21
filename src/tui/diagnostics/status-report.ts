// SP007 T10 — /status 字段组装（design §4.2，AC RD-01/02/03）。纯函数；面板只渲染。
// 不显示权限模式（同参考）；凭据只显来源不显值（RD-15 脱敏）。

export type StatusField = { label: string; value: string }

export type StatusReportInput = {
  version: string
  sessionId: string
  cwd: string
  model: string
  profileLabel?: string
  baseUrlHost: string
  credentialSource: string
  mcp: { connected: number; failed: number; pending: number }
  settingSources: string[]
  warnings: string[]
  config: { source: string; protocol?: string; model: string; tools: boolean; vision?: boolean }
  usage: { requests: number; inputTokens: number; outputTokens: number; elapsedMs: number }
  performance: {
    requestMs: { p50: number; p95: number; last: number }
    firstTokenMs?: { p50: number; p95: number; last: number }
    memoryRssBytes: number
  }
}

export type StatusReport = { status: StatusField[]; config: StatusField[]; usage: StatusField[] }

function ms(value: number): string {
  if (value >= 1000) return (value / 1000).toFixed(2) + 's'
  return Math.round(value) + 'ms'
}

export function assembleStatusReport(input: StatusReportInput): StatusReport {
  const modelValue = input.profileLabel ? input.model + '（' + input.profileLabel + '）' : input.model
  const mcpValue = input.mcp.connected + ' connected / ' + input.mcp.failed + ' failed / ' +
    input.mcp.pending + ' pending · /mcp'
  const sources = input.settingSources.filter((source) => source && source.trim().length > 0)
  const status: StatusField[] = [
    { label: 'Version', value: input.version },
    { label: 'Session ID', value: input.sessionId },
    { label: 'cwd', value: input.cwd },
    { label: 'Model', value: modelValue },
    { label: 'API', value: input.baseUrlHost },
    { label: '凭据来源', value: input.credentialSource },
    { label: 'MCP', value: mcpValue }
  ]
  if (sources.length > 0) status.push({ label: 'Setting sources', value: sources.join(', ') })
  status.push({ label: 'System Diagnostics', value: input.warnings.length > 0 ? input.warnings.join('；') : '无警告' })

  const config: StatusField[] = [
    { label: '来源优先级', value: 'cli > env > file > default（当前 ' + input.config.source + '）' },
    { label: '协议', value: input.config.protocol ?? 'openai' },
    { label: '模型', value: input.config.model },
    { label: '工具', value: input.config.tools ? '支持' : '不支持' },
    { label: '视觉', value: input.config.vision === undefined ? '未知（错误驱动降级）' : input.config.vision ? '支持' : '不支持' }
  ]

  const perf = input.performance
  const usage: StatusField[] = [
    { label: '请求数', value: String(input.usage.requests) },
    { label: '输入 token', value: String(input.usage.inputTokens) },
    { label: '输出 token', value: String(input.usage.outputTokens) },
    { label: '耗时', value: ms(input.usage.elapsedMs) },
    { label: '请求 p50/p95', value: ms(perf.requestMs.p50) + ' / ' + ms(perf.requestMs.p95) },
    { label: '首 token p50/p95', value: perf.firstTokenMs ? ms(perf.firstTokenMs.p50) + ' / ' + ms(perf.firstTokenMs.p95) : '无样本' },
    { label: '进程 RSS', value: (perf.memoryRssBytes / (1024 * 1024)).toFixed(1) + ' MB' }
  ]
  return { status, config, usage }
}
