// SP006 §6.4：配置类命令迁移（行为与 0.5.4 一致）。
import { maskKey } from '../../storage/profiles.js'
import { selectProfile } from '../model-management.js'
import type { CommandRegistry } from './registry.js'
import { contextCommand, costCommand, effortCommand } from '../commands.js'
import { outcomeResult, pickFor } from './util.js'

export function registerConfigCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'config',
    kind: 'local',
    summary: '显示端点、模型、密钥掩码与超时',
    supportsNonInteractive: true,
    async run(_args, context) {
      const pick = pickFor(context)
      const config = context.getConfig()
      return outcomeResult({
        handled: true,
        message: [
          pick(`端点：${config.baseUrl}`, `Endpoint: ${config.baseUrl}`),
          pick(`模型：${config.model || '（未配置）'}`, `Model: ${config.model || '(not configured)'}`),
          pick(`密钥：${maskKey(config.apiKey)}`, `API key: ${maskKey(config.apiKey)}`),
          pick(`来源：${config.source}`, `Source: ${config.source}`),
          pick(`超时：${config.timeoutMs} ms`, `Timeout: ${config.timeoutMs} ms`)
        ].join('\n')
      })
    }
  })

  registry.register({
    name: 'models',
    kind: 'local-jsx',
    summary: '打开模型管理（管道模式列出档案）',
    supportsNonInteractive: true,
    async run(args, context) {
      const pick = pickFor(context)
      if (args) return outcomeResult({ handled: true, error: pick('用法：/models', 'Usage: /models') })
      if (context.interactive) return outcomeResult({ handled: true, openModels: true })
      const stored = context.configStore.load()
      if (stored.models.length === 0) {
        return outcomeResult({ handled: true, message: pick('尚未存储模型档案', 'No model profiles stored yet') })
      }
      const lines = stored.models.map(
        (profile) =>
          `${profile.id === stored.defaultModelId ? '*' : ' '} ${profile.label} — ${profile.model} (${profile.baseUrl})`
      )
      return outcomeResult({ handled: true, message: lines.join('\n') })
    }
  })

  registry.register({
    name: 'model',
    kind: 'local',
    summary: '查看或切换当前模型档案',
    supportsNonInteractive: true,
    async run(args, context) {
      const pick = pickFor(context)
      if (!args) {
        const config = context.getConfig()
        return outcomeResult({
          handled: true,
          message: pick(`模型：${config.model || '（未配置）'}`, `Model: ${config.model || '(not configured)'}`)
        })
      }
      const stored = context.configStore.load()
      const profile = stored.models.find((entry) => entry.id === args || entry.label === args)
      if (!profile) {
        return outcomeResult({
          handled: true,
          error: pick(`未知模型档案：${args}`, `Unknown model profile: ${args}`)
        })
      }
      selectProfile(context, profile)
      return outcomeResult({
        handled: true,
        message: pick(
          `已切换到 ${profile.label}；会话保留，自下一回合生效`,
          `Model switched to ${profile.label}; the conversation is kept and the switch applies from the next turn`
        )
      })
    }
  })

  registry.register({
    name: 'effort',
    kind: 'local-jsx',
    summary: '选择或设置思考强度',
    supportsNonInteractive: true,
    async run(args, context) {
      if (!args && context.interactive) return outcomeResult({ handled: true, openEffort: true })
      return outcomeResult(effortCommand(args, context, pickFor(context)))
    }
  })

  registry.register({
    name: 'context',
    kind: 'local-jsx',
    summary: '查看上下文占用网格',
    supportsNonInteractive: true,
    async run(_args, context) {
      if (context.interactive) return outcomeResult({ handled: true, openContext: true })
      return outcomeResult(contextCommand(context, pickFor(context)))
    }
  })

  registry.register({
    name: 'cost',
    aliases: ['usage'],
    kind: 'local',
    summary: '累计 token 与预估费用',
    supportsNonInteractive: true,
    async run(_args, context) {
      return outcomeResult(costCommand(context, pickFor(context)))
    }
  })
}
