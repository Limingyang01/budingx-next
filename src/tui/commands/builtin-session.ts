// SP006 §6.4：会话类命令迁移（行为与 0.5.4 一致）。
import type { CommandRegistry } from './registry.js'
import { commandHelp, formatTokens, resumeCommand, sessionsCommand, skillHelpSection } from '../commands.js'
import { outcomeResult, pickFor } from './util.js'

export function registerSessionCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'help',
    kind: 'local',
    summary: '显示命令帮助与已发现技能',
    supportsNonInteractive: true,
    async run(_args, context) {
      const lang = context.lang ?? 'en'
      const pick = pickFor(context)
      return outcomeResult({
        handled: true,
        message: commandHelp(lang, context.interactive) + skillHelpSection(context, pick)
      })
    }
  })

  registry.register({
    name: 'exit',
    aliases: ['quit'],
    kind: 'local',
    summary: '退出 budingx',
    immediate: true,
    supportsNonInteractive: true,
    async run(_args, context) {
      context.exit()
      return outcomeResult({ handled: true, exit: true })
    }
  })

  registry.register({
    name: 'clear',
    aliases: ['new', 'reset'],
    kind: 'local',
    summary: '清空会话历史（保留项目规则）',
    immediate: true,
    supportsNonInteractive: true,
    async run(_args, context) {
      const pick = pickFor(context)
      context.session.clearHistory()
      return outcomeResult({
        handled: true,
        message: pick('会话已清空（项目规则保留）', 'Conversation cleared (project rules kept)')
      })
    }
  })

  registry.register({
    name: 'sessions',
    kind: 'local',
    summary: '列出已保存的会话',
    supportsNonInteractive: true,
    async run(_args, context) {
      return outcomeResult(sessionsCommand(context, pickFor(context)))
    }
  })

  registry.register({
    name: 'resume',
    kind: 'local-jsx',
    summary: '恢复已保存的会话（交互模式打开选择面板）',
    supportsNonInteractive: true,
    async run(args, context) {
      if (!args && context.interactive) return outcomeResult({ handled: true, openResume: true })
      return outcomeResult(resumeCommand(args, context, pickFor(context)))
    }
  })

  registry.register({
    name: 'continue',
    kind: 'local',
    summary: '恢复当前工作区最近的会话',
    supportsNonInteractive: true,
    async run(_args, context) {
      const pick = pickFor(context)
      const latest = context.sessions?.list()[0]
      if (!latest) {
        return outcomeResult({
          handled: true,
          error: pick('当前工作区没有可恢复的会话', 'No resumable session in this workspace')
        })
      }
      return outcomeResult(resumeCommand(latest.sessionId, context, pick))
    }
  })

  registry.register({
    name: 'compact',
    kind: 'local',
    summary: '手动压缩历史以释放 token',
    supportsNonInteractive: true,
    async run(args, context) {
      const pick = pickFor(context)
      const result = await context.session.compactNow(args || undefined)
      if (!result.ok) {
        return outcomeResult({
          handled: true,
          error: pick(`压缩失败：${result.message}`, `Compact failed: ${result.message}`)
        })
      }
      return outcomeResult({
        handled: true,
        message: pick(
          `已压缩：${formatTokens(result.before)} → ${formatTokens(result.after)} token`,
          `Compacted: ${formatTokens(result.before)} → ${formatTokens(result.after)} tokens`
        )
      })
    }
  })
}
