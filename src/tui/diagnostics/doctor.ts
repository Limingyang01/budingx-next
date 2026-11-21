// SP007 T10 — /doctor 警告式报告与临时产物清理（design §4.2，AC RD-09/10/11/15）。
// 非 PASS/FAIL、无交互 Fix 屏（D4，按参考实际行为）。纯本地零网络；凭据只显来源。
import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { DoctorWarning } from './doctor-warnings.js'

export type DoctorSection = { title: string; lines: string[] }

export type DoctorInput = {
  runtime: { kind: string; version: string; nodeVersion: string; entryPath: string; searchAvailable: boolean }
  installations: string[]
  configCorrupt: boolean
  mcpFailed: { name: string; error?: string }[]
  keybindingWarnings: string[]
  envIssues: { name: string; issue: string }[]
  agentParseErrors: string[]
  contextWarnings: DoctorWarning[]
}

export type DoctorReport = { sections: DoctorSection[]; warningCount: number }

function warningLines(warning: DoctorWarning): string[] {
  return ['Warning: ' + warning.issue, 'Fix: ' + warning.fix]
}

/** 组装分区报告：Diagnostics 信息恒在；其余分区无问题隐藏。 */
export function buildDoctorReport(input: DoctorInput): DoctorReport {
  const sections: DoctorSection[] = []
  sections.push({
    title: 'Diagnostics',
    lines: [
      '运行类型: ' + input.runtime.kind,
      '版本: ' + input.runtime.version,
      'Node: ' + input.runtime.nodeVersion,
      '入口: ' + input.runtime.entryPath,
      '搜索: ' + (input.runtime.searchAvailable ? '可用' : '不可用（rg 未安装）')
    ]
  })
  if (input.installations.length > 0) {
    sections.push({ title: 'Multiple installations', lines: input.installations.map((item) => 'Warning: ' + item) })
  }
  if (input.configCorrupt) {
    sections.push({
      title: 'Invalid Settings',
      lines: ['Warning: 配置文件损坏，已保留备份并未擦除', 'Fix: 检查 ~/.budingx/config.json 或从备份恢复']
    })
  }
  if (input.mcpFailed.length > 0) {
    sections.push({
      title: 'MCP',
      lines: input.mcpFailed.flatMap((server) => [
        'Warning: MCP 服务器 ' + server.name + ' 连接失败' + (server.error ? '：' + server.error : ''),
        'Fix: 检查 ~/.budingx/mcp.json 中该服务器命令与参数，或运行 /mcp 查看详情'
      ])
    })
  }
  if (input.keybindingWarnings.length > 0) {
    sections.push({ title: 'Keybinding', lines: input.keybindingWarnings.map((message) => 'Warning: ' + message) })
  }
  if (input.envIssues.length > 0) {
    sections.push({
      title: 'Environment Variables',
      lines: input.envIssues.flatMap((entry) => ['Warning: ' + entry.name + ' ' + entry.issue, 'Fix: 修正或移除该环境变量'])
    })
  }
  if (input.agentParseErrors.length > 0) {
    sections.push({ title: 'Agent Parse Errors', lines: input.agentParseErrors.map((message) => 'Warning: ' + message) })
  }
  const unreachable = input.contextWarnings.filter((warning) => warning.section === 'Unreachable Permission Rules')
  if (unreachable.length > 0) {
    sections.push({ title: 'Unreachable Permission Rules', lines: unreachable.flatMap(warningLines) })
  }
  const context = input.contextWarnings.filter((warning) => warning.section === 'Context Usage Warnings')
  if (context.length > 0) {
    sections.push({ title: 'Context Usage Warnings', lines: context.flatMap(warningLines) })
  }
  const warningCount = sections.reduce((acc, section) => acc + section.lines.filter((line) => line.startsWith('Warning:')).length, 0)
  return { sections, warningCount }
}

export const STALE_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * 自动清理过期临时产物（RD-10，D8）：os.tmpdir 下 budingx-clipboard-* 超 24h。
 * 本仓无 PID 版本锁机制，不清理不存在的锁。返回清理计数。
 */
export function cleanupStaleTemp(options: { tmpDir: string; now?: number; maxAgeMs?: number }): { cleaned: number } {
  const now = options.now ?? Date.now()
  const maxAge = options.maxAgeMs ?? STALE_TEMP_MAX_AGE_MS
  let cleaned = 0
  let names: string[] = []
  try {
    names = readdirSync(options.tmpDir)
  } catch {
    return { cleaned }
  }
  for (const name of names) {
    if (!name.startsWith('budingx-clipboard-')) continue
    const file = join(options.tmpDir, name)
    try {
      const stat = statSync(file)
      if (!stat.isFile()) continue
      if (now - stat.mtimeMs > maxAge) {
        unlinkSync(file)
        cleaned++
      }
    } catch {
      // 单个文件清理失败不影响其余
    }
  }
  return { cleaned }
}
