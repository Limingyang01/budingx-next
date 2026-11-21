// SP007 T10 — /doctor 上下文警告（design §4.2，AC RD-09/RD-11）。纯函数，阈值同参考。
import { estimateText } from '../../core/context-budget.js'

export const MAX_INSTRUCTION_CHARS = 40000
export const MAX_AGENT_DESCRIPTION_TOKENS = 15000
export const MAX_MCP_SCHEMA_TOKENS = 25000

export type DoctorWarning = { section: string; issue: string; fix: string }

export type ContextWarningInput = {
  instructionChars: number
  agents: { name: string; description: string }[]
  mcpServers: { name: string; schema: string }[]
  unreachableRules: { rule: string; reason: string }[]
}

/** 四项上下文警告（并行收集，超阈值才产出；无问题返回空）。 */
export function contextWarnings(input: ContextWarningInput): DoctorWarning[] {
  const warnings: DoctorWarning[] = []
  if (input.instructionChars > MAX_INSTRUCTION_CHARS) {
    warnings.push({
      section: 'Context Usage Warnings',
      issue: '项目指令超过 ' + MAX_INSTRUCTION_CHARS + ' 字符（实际 ' + input.instructionChars + '）',
      fix: '精简 CLAUDE.md/AGENTS.md，或把长篇内容拆分到技能/文档按需加载'
    })
  }
  const agentTokens = input.agents.map((agent) => ({ name: agent.name, tokens: estimateText(agent.description) }))
  const agentTotal = agentTokens.reduce((acc, entry) => acc + entry.tokens, 0)
  if (agentTotal > MAX_AGENT_DESCRIPTION_TOKENS) {
    const top = [...agentTokens].sort((a, b) => b.tokens - a.tokens).slice(0, 5)
    warnings.push({
      section: 'Context Usage Warnings',
      issue: '代理描述总量超过 ' + MAX_AGENT_DESCRIPTION_TOKENS + ' token（实际 ' + agentTotal + '）：' +
        top.map((entry) => entry.name + '(' + entry.tokens + ')').join('、'),
      fix: '精简代理 description（whenToUse），避免每个代理都注入冗长说明'
    })
  }
  const serverTokens = input.mcpServers
    .map((server) => ({ name: server.name, tokens: estimateText(server.schema) }))
    .filter((entry) => entry.tokens > MAX_MCP_SCHEMA_TOKENS)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5)
  for (const server of serverTokens) {
    warnings.push({
      section: 'Context Usage Warnings',
      issue: 'MCP 服务器 ' + server.name + ' 工具 schema 超过 ' + MAX_MCP_SCHEMA_TOKENS + ' token（实际 ' + server.tokens + '）',
      fix: '减少该服务器暴露的工具数量，或启用 ToolSearch 延迟加载（BUDINGX_TOOL_SEARCH=auto）'
    })
  }
  for (const rule of input.unreachableRules) {
    warnings.push({
      section: 'Unreachable Permission Rules',
      issue: '权限规则不可达：' + rule.rule,
      fix: rule.reason
    })
  }
  return warnings
}
