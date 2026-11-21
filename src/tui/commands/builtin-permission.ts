// SP006 §6.4：权限与计划类命令迁移（行为与 0.5.4 一致）。
import type { CommandRegistry } from './registry.js'
import {
  denialsCommand,
  memoryCommand,
  permissionCommand,
  planCommand,
  rulesCommand
} from '../commands.js'
import { outcomeResult, pickFor } from './util.js'

export function registerPermissionCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'permission',
    kind: 'local-jsx',
    summary: '查看或切换权限模式（交互模式打开规则面板）',
    supportsNonInteractive: true,
    async run(args, context) {
      if (!args && context.interactive && context.permission) {
        return outcomeResult({ handled: true, openRules: true })
      }
      return outcomeResult(permissionCommand(args, context, pickFor(context)))
    }
  })

  registry.register({
    name: 'rules',
    kind: 'local-jsx',
    summary: '管理权限规则（交互模式打开面板）',
    supportsNonInteractive: true,
    async run(args, context) {
      if (!args && context.interactive && context.permission) {
        return outcomeResult({ handled: true, openRules: true })
      }
      return outcomeResult(rulesCommand(args, context, pickFor(context)))
    }
  })

  registry.register({
    name: 'permissions',
    aliases: ['allowed-tools'],
    kind: 'local-jsx',
    summary: '权限白名单面板',
    supportsNonInteractive: true,
    async run(args, context) {
      if (context.interactive && context.permission) {
        return outcomeResult({ handled: true, openRules: true })
      }
      return outcomeResult(rulesCommand(args, context, pickFor(context)))
    }
  })

  registry.register({
    name: 'denials',
    kind: 'local',
    summary: '查看拒绝历史',
    supportsNonInteractive: true,
    async run(_args, context) {
      return outcomeResult(denialsCommand(context, pickFor(context)))
    }
  })

  registry.register({
    name: 'plan',
    kind: 'local',
    summary: '进入或退出规划模式',
    supportsNonInteractive: true,
    async run(args, context) {
      return outcomeResult(planCommand(args, context, pickFor(context)))
    }
  })

  registry.register({
    name: 'memory',
    kind: 'local',
    summary: '查看或写入项目/会话记忆',
    supportsNonInteractive: true,
    async run(args, context) {
      return outcomeResult(memoryCommand(args, context, pickFor(context)))
    }
  })
}
