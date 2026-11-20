// SP006 §6.4：改动查看/回滚类命令迁移（行为与 0.5.4 一致）。
import type { CommandRegistry } from './registry.js'
import { diffCommand, undoCommand } from '../commands.js'
import { outcomeResult, pickFor } from './util.js'

export function registerViewCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'diff',
    kind: 'local-jsx',
    summary: '查看本会话改动（交互模式打开对话框）',
    supportsNonInteractive: true,
    async run(args, context) {
      return outcomeResult(diffCommand(args, context, pickFor(context)))
    }
  })

  registry.register({
    name: 'undo',
    kind: 'local',
    summary: '撤销最近一组改动或指定文件',
    supportsNonInteractive: true,
    async run(args, context) {
      return outcomeResult(undoCommand(args, context, pickFor(context)))
    }
  })

  registry.register({
    name: 'rewind',
    kind: 'local-jsx',
    summary: '回滚对话与文件到检查点',
    supportsNonInteractive: true,
    async run(args, context) {
      if (!args && context.interactive) return outcomeResult({ handled: true, openRewind: true })
      return outcomeResult(undoCommand(args, context, pickFor(context)))
    }
  })
}
