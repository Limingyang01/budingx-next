// SP006 §6：内置命令注册入口。
import type { CommandDefinition } from './types.js'
import { createCommandRegistry, type CommandRegistry } from './registry.js'
import { registerSessionCommands } from './builtin-session.js'
import { registerConfigCommands } from './builtin-config.js'
import { registerPermissionCommands } from './builtin-permission.js'
import { registerViewCommands } from './builtin-view.js'
import { EXTENDED_COMMANDS } from './builtin-extended.js'
import { AGENTS_COMMANDS } from './builtin-agents.js'

export type {
  CommandContext,
  CommandDefinition,
  CommandKind,
  CommandOutcome,
  CommandResult,
  ModalSlot
} from './types.js'
export { createCommandRegistry, parseCommandInput } from './registry.js'
export type { CommandRegistry, ParsedCommandInput, ResolvedCommand } from './registry.js'

/** 注册本轮全部内置命令（22 条既有 + 后续新增）。 */
export function registerBuiltinCommands(registry: CommandRegistry): CommandRegistry {
  registerSessionCommands(registry)
  registerConfigCommands(registry)
  registerPermissionCommands(registry)
  registerViewCommands(registry)
  for (const command of EXTENDED_COMMANDS) registry.register(command)
  for (const command of AGENTS_COMMANDS) registry.register(command)
  return registry
}

let defaultRegistry: CommandRegistry | undefined

export function getDefaultRegistry(): CommandRegistry {
  if (!defaultRegistry) {
    defaultRegistry = registerBuiltinCommands(createCommandRegistry())
  }
  return defaultRegistry
}
