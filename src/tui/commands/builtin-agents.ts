// SP007 T9：/agents 管理面板与 /agent 派发命令（design §4.1）。
// /agents 为 local-jsx：交互宿主挂 AgentsMenu（outcome.openAgents），无头给文本清单。
// /agent 为 prompt：注入「使用 Agent 工具」指令令模型派发子代理；缺参给用法。
import { homedir } from 'node:os'
import type { CommandContext, CommandDefinition, CommandResult } from './types.js'
import { loadAgentDefinitions } from '../agents.js'

function lang(context: CommandContext): 'zh' | 'en' {
  return context.lang ?? 'zh'
}

function text(value: string, outcome?: CommandResult['outcome']): CommandResult {
  return { kind: 'text', value, ...(outcome ? { outcome } : {}) }
}

const SOURCE_LABEL: Record<string, { zh: string; en: string }> = {
  'built-in': { zh: '内置', en: 'built-in' },
  user: { zh: '用户', en: 'user' },
  project: { zh: '项目', en: 'project' }
}

export function agentListLines(context: CommandContext): string[] {
  const { agents } = loadAgentDefinitions({
    cwd: context.cwd ?? process.cwd(),
    home: context.home ?? homedir()
  })
  const en = lang(context) === 'en'
  if (agents.length === 0) return [en ? 'No agents available.' : '没有可用的子代理。']
  return agents.map((agent) => {
    const source = SOURCE_LABEL[agent.source]?.[en ? 'en' : 'zh'] ?? agent.source
    const model = agent.model && agent.model !== 'inherit' ? ` · ${agent.model}` : ''
    return `${agent.name} · ${source}${model}\n  ${agent.description}`
  })
}

const agentsCommand: CommandDefinition = {
  name: 'agents',
  kind: 'local-jsx',
  summary: '管理子代理：查看、创建、编辑、删除（.budingx/agents/*.md）',
  immediate: true,
  async run(_args, context) {
    const lines = agentListLines(context)
    return text(lines.join('\n'), {
      handled: true,
      ...(context.interactive ? { openAgents: true } : {})
    })
  }
}

const agentCommand: CommandDefinition = {
  name: 'agent',
  kind: 'prompt',
  summary: '派发子代理执行任务：/agent <类型> <任务描述>',
  progressMessage: '正在派发子代理…',
  async run(args, context) {
    const trimmed = args.trim()
    const spaceAt = trimmed.search(/\s/)
    const type = spaceAt < 0 ? trimmed : trimmed.slice(0, spaceAt)
    const prompt = spaceAt < 0 ? '' : trimmed.slice(spaceAt + 1).trim()
    const en = lang(context) === 'en'
    if (!type || !prompt) {
      const message = en ? 'Usage: /agent <type> <prompt>' : '用法：/agent <类型> <任务描述>'
      return text(message, { handled: true, message })
    }
    const instruction = en
      ? `Use the Agent tool with subagent_type="${type}" to handle this task, then report the result: ${prompt}`
      : `使用 Agent 工具，subagent_type="${type}"，处理以下任务并转述结果：${prompt}`
    return text(instruction, { handled: true, prompt: { text: instruction } })
  }
}

export const AGENTS_COMMANDS: CommandDefinition[] = [agentsCommand, agentCommand]

export function registerAgentsCommands(registry: { register: (command: CommandDefinition) => unknown }): void {
  for (const command of AGENTS_COMMANDS) registry.register(command)
}
