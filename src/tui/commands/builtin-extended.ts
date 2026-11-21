// SP006 §6.3：新增命令面（CMD-05 … CMD-11）。
// 七个命令全部通过注册表三型契约实现，副作用由 CommandOutcome 交给宿主。
import { homedir } from 'node:os'
import type { CommandContext, CommandDefinition, CommandResult } from './types.js'
import { exportSession } from '../export.js'
import { planInit } from '../init.js'
import { discoverSkills } from '../skills.js'
import { formatTaskList } from '../tasks.js'
import { runWorktreeCommand } from '../worktree.js'

function lang(context: CommandContext): 'zh' | 'en' {
  return context.lang ?? 'zh'
}

function text(value: string, outcome?: CommandResult['outcome']): CommandResult {
  return { kind: 'text', value, ...(outcome ? { outcome } : {}) }
}

const initCommand: CommandDefinition = {
  name: 'init',
  kind: 'prompt',
  summary: '生成项目指令（AGENTS.md）骨架，写文件仍需审批',
  progressMessage: '正在生成项目指令…',
  async run(_args, context) {
    const plan = planInit(context.cwd ?? process.cwd(), lang(context))
    if (!plan.ok) {
      const message = plan.message ?? '项目指令已存在，不会覆盖。'
      return text(message, { handled: true, message })
    }
    return text(plan.prompt ?? '', { handled: true, prompt: { text: plan.prompt ?? '', ...(plan.progress ? { progress: plan.progress } : {}) } })
  }
}

const btwCommand: CommandDefinition = {
  name: 'btw',
  kind: 'prompt',
  summary: '旁路提问：不写入主会话上下文，单独问模型并回显',
  progressMessage: '正在旁路提问…',
  async run(args, context) {
    const question = args.trim()
    if (!question) {
      const message = lang(context) === 'en' ? 'Usage: /btw <question>' : '用法：/btw <问题>'
      return text(message, { handled: true, message })
    }
    return text(question, { handled: true, sideQuestion: question })
  }
}

const worktreeCommand: CommandDefinition = {
  name: 'worktree',
  kind: 'local',
  summary: '列出、创建或移除隔离工作树（删除需确认）',
  async run(args, context) {
    const result = await runWorktreeCommand(
      args,
      {
        cwd: context.cwd ?? context.permission?.workspace.root ?? process.cwd(),
        ...(context.home ? { home: context.home } : {}),
        ...(context.confirm ? { confirm: context.confirm } : {})
      },
      lang(context)
    )
    return text(result.text)
  }
}

const tasksCommand: CommandDefinition = {
  name: 'tasks',
  kind: 'local',
  summary: '列出后台或未完成任务（状态、退出码、输出路径）与子代理',
  async run(_args, context) {
    const language = lang(context)
    const en = language === 'en'
    const shells = formatTaskList(context.tasks?.list() ?? [], language)
    // SP007 SA-14：子代理分组与后台 shell 六件套分离展示。
    const agents = context.agents?.list() ?? []
    if (agents.length === 0) return text(shells)
    const lines = agents.map((agent) =>
      `[${agent.agentId.slice(0, 8)}] ${agent.description} · ${agent.state} · ${agent.toolUses} tools · ${agent.tokens} tokens`
    )
    const header = en ? `Agents (${agents.length}):` : `子代理（${agents.length}）：`
    const footer = en ? 'TaskStop stops · ctrl+b backgrounds' : 'TaskStop 停止 · ctrl+b 后台化'
    return text(shells + '\n\n' + header + '\n' + lines.join('\n') + '\n' + footer)
  }
}

function mcpLines(context: CommandContext): string[] {
  const statuses = context.mcp?.statuses ?? []
  if (statuses.length === 0) {
    return [lang(context) === 'en' ? 'No MCP servers configured.' : '未配置 MCP 服务器。']
  }
  return statuses.map((status) => {
    if (status.connected) {
      return `${status.name} · 已连接 · 工具 ${status.tools} 个` +
        (status.serverName ? ` · ${status.serverName} ${status.serverVersion ?? ''}`.trimEnd() : '')
    }
    return `${status.name} · 未连接${status.error ? ' · ' + status.error : ''}`
  })
}

const mcpCommand: CommandDefinition = {
  name: 'mcp',
  kind: 'local-jsx',
  summary: '查看 MCP 服务器、连接状态与工具数',
  async run(_args, context) {
    const lines = mcpLines(context)
    return text(lines.join('\n'), {
      handled: true,
      ...(context.interactive ? { openList: { title: 'MCP 服务器', lines } } : {})
    })
  }
}

function skillLines(context: CommandContext): string[] {
  const skills = discoverSkills({
    homeDir: context.home ?? homedir(),
    workspaceDir: context.cwd ?? process.cwd()
  })
  if (skills.length === 0) {
    return [lang(context) === 'en' ? 'No skills discovered.' : '未发现技能。']
  }
  return skills.map((skill) => {
    const scope = skill.scope === 'project' ? '项目' : '用户'
    const state = skill.valid ? '' : ` · 不可用（${skill.error ?? '未知原因'}）`
    return `/${skill.name} · ${scope}${state}\n  ${skill.description || '（无描述）'}\n  ${skill.path}`
  })
}

const skillsCommand: CommandDefinition = {
  name: 'skills',
  kind: 'local-jsx',
  summary: '查看已发现技能（名称、描述、来源）',
  async run(_args, context) {
    const lines = skillLines(context)
    return text(lines.join('\n'), {
      handled: true,
      ...(context.interactive ? { openList: { title: '技能', lines } } : {})
    })
  }
}

function parseExportArgs(args: string): { format: 'jsonl' | 'text'; path?: string; error?: string } {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  let format: 'jsonl' | 'text' = 'jsonl'
  let path: string | undefined
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '--format' || token === '-f') {
      const value = tokens[index + 1]
      if (value !== 'jsonl' && value !== 'text') return { format, error: '--format 只能是 jsonl 或 text' }
      format = value
      index += 1
    } else if (token === '--path' || token === '-p') {
      const value = tokens[index + 1]
      if (!value) return { format, error: '--path 缺少路径' }
      path = value
      index += 1
    } else if (token.startsWith('--format=')) {
      const value = token.slice('--format='.length)
      if (value !== 'jsonl' && value !== 'text') return { format, error: '--format 只能是 jsonl 或 text' }
      format = value
    } else if (token.startsWith('--path=')) {
      path = token.slice('--path='.length) || undefined
    } else {
      return { format, error: `未知参数：${token}` }
    }
  }
  return { format, ...(path ? { path } : {}) }
}

const exportCommand: CommandDefinition = {
  name: 'export',
  kind: 'local',
  summary: '导出会话为 JSONL 或文本（默认写入 ~/.budingx/exports）',
  async run(args, context) {
    const parsed = parseExportArgs(args)
    if (parsed.error) return text(parsed.error)
    const result = exportSession(context.session.history, {
      sessionId: context.session.id,
      format: parsed.format,
      ...(parsed.path ? { path: parsed.path } : {}),
      ...(context.home ? { home: context.home } : {})
    })
    if (!result.ok) return text(result.error)
    return text(`已导出 ${result.bytes} 字节：${result.path}`)
  }
}

export const EXTENDED_COMMANDS: CommandDefinition[] = [
  initCommand,
  btwCommand,
  worktreeCommand,
  tasksCommand,
  mcpCommand,
  skillsCommand,
  exportCommand
]
