// SP007 T10：/status /stats /doctor 诊断命令（design §4.2，RD-01…11）。
// local-jsx immediate：交互宿主挂对话框（outcome.openStatus/openStats/openDoctor），
// 无头不给 supportsNonInteractive（同参考：headless 视为未知命令）。文本回退用纯模块组装。
import type { CommandContext, CommandDefinition, CommandResult } from './types.js'
import { assembleStatusReport } from '../diagnostics/status-report.js'
import { scanStats, computeOverview } from '../diagnostics/stats.js'
import { buildDoctorReport } from '../diagnostics/doctor.js'
import { formatCount } from '../diagnostics/ansi-chart.js'

function text(value: string, outcome?: CommandResult['outcome']): CommandResult {
  return { kind: 'text', value, ...(outcome ? { outcome } : {}) }
}

function unavailable(context: CommandContext): string {
  return (context.lang ?? 'zh') === 'en' ? 'Diagnostics unavailable.' : '诊断数据不可用。'
}

const statusCommand: CommandDefinition = {
  name: 'status',
  kind: 'local-jsx',
  summary: '查看当前会话状态、配置来源与用量性能（/status）',
  immediate: true,
  async run(_args, context) {
    const port = context.diagnostics
    if (!port) return text(unavailable(context), { handled: true })
    const report = assembleStatusReport(port.statusInput())
    const lines = [...report.status, ...report.config, ...report.usage].map((field) => field.label + ': ' + field.value)
    return text(lines.join('\n'), { handled: true, ...(context.interactive ? { openStatus: true } : {}) })
  }
}

const statsCommand: CommandDefinition = {
  name: 'stats',
  kind: 'local-jsx',
  summary: '查看用量统计：热力图、模型分布、连续活跃天数（/stats）',
  immediate: true,
  async run(_args, context) {
    const port = context.diagnostics
    if (!port) return text(unavailable(context), { handled: true })
    const { stats } = scanStats({ sessionsDir: port.sessionsDir, today: port.today, range: 'all', cachePath: port.cachePath })
    const overview = computeOverview(stats, { today: port.today })
    const lines = [
      'Favorite model: ' + overview.favoriteModel,
      'Total tokens: ' + formatCount(overview.totalTokens),
      'Sessions: ' + overview.sessions,
      'Active days: ' + overview.activeDays,
      'Streak (longest/current): ' + overview.longestStreak + '/' + overview.currentStreak
    ]
    return text(lines.join('\n'), { handled: true, ...(context.interactive ? { openStats: true } : {}) })
  }
}

const doctorCommand: CommandDefinition = {
  name: 'doctor',
  kind: 'local-jsx',
  summary: '诊断安装、配置、MCP、键位与上下文警告（/doctor）',
  immediate: true,
  async run(_args, context) {
    const port = context.diagnostics
    if (!port) return text(unavailable(context), { handled: true })
    const report = buildDoctorReport(port.doctorInput())
    const lines = report.sections.flatMap((section) => [section.title, ...section.lines])
    return text(lines.join('\n'), { handled: true, ...(context.interactive ? { openDoctor: true } : {}) })
  }
}

export const DIAGNOSTICS_COMMANDS: CommandDefinition[] = [statusCommand, statsCommand, doctorCommand]

export function registerDiagnosticsCommands(registry: { register: (command: CommandDefinition) => unknown }): void {
  for (const command of DIAGNOSTICS_COMMANDS) registry.register(command)
}
