// SP006 §6.1/§6.4：命令注册表（独立实现）
import type { CommandDefinition } from './types.js'

export interface ParsedCommandInput {
  /** 用户实际输入的命令名（小写，可能是别名）。 */
  name: string
  args: string
}

export interface ResolvedCommand {
  /** 用户输入的命令名（小写，可能是别名）。 */
  command: string
  args: string
  definition: CommandDefinition
  /** 命中的是别名（true）还是正式名（false）。 */
  alias: boolean
}

export interface CommandRegistry {
  register(definition: CommandDefinition): void
  get(name: string): CommandDefinition | undefined
  list(options?: { includeHidden?: boolean }): CommandDefinition[]
  resolve(input: string): ResolvedCommand | undefined
}

const NAME_PATTERN = /^[a-z][a-z0-9_-]*$/

/** 解析 "/name args"：命令名到首个空白为止，参数保留内部空格并去掉两端。 */
export function parseCommandInput(input: string): ParsedCommandInput | undefined {
  const text = input.trim()
  if (!text.startsWith('/')) return undefined
  const body = text.slice(1)
  if (body.length === 0) return undefined
  const separator = body.search(/\s/)
  const name = (separator < 0 ? body : body.slice(0, separator)).toLowerCase()
  if (!NAME_PATTERN.test(name)) return undefined
  const args = separator < 0 ? '' : body.slice(separator + 1).trim()
  return { name, args }
}

export function createCommandRegistry(): CommandRegistry {
  const byName = new Map<string, CommandDefinition>()
  const byAlias = new Map<string, CommandDefinition>()
  const order: CommandDefinition[] = []

  function claim(name: string, definition: CommandDefinition): void {
    const key = name.toLowerCase()
    if (byName.has(key) || byAlias.has(key)) {
      throw new Error(`命令重复注册：/${key}`)
    }
  }

  return {
    register(definition) {
      const name = definition.name.toLowerCase()
      if (!NAME_PATTERN.test(name)) {
        throw new TypeError(`非法命令名：${definition.name}`)
      }
      if (!definition.summary || definition.summary.trim().length === 0) {
        throw new TypeError(`命令 /${name} 缺少 summary`)
      }
      claim(name, definition)
      const aliases = (definition.aliases ?? []).map((alias) => alias.toLowerCase())
      for (const alias of aliases) {
        if (!NAME_PATTERN.test(alias)) throw new TypeError(`非法命令别名：${alias}`)
        claim(alias, definition)
      }
      byName.set(name, definition)
      for (const alias of aliases) byAlias.set(alias, definition)
      order.push(definition)
    },

    get(name) {
      const key = name.replace(/^\//, '').toLowerCase()
      return byName.get(key) ?? byAlias.get(key)
    },

    list(options) {
      return order.filter((definition) => options?.includeHidden || !definition.hidden)
    },

    resolve(input) {
      const parsed = parseCommandInput(input)
      if (!parsed) return undefined
      const direct = byName.get(parsed.name)
      if (direct) return { command: parsed.name, args: parsed.args, definition: direct, alias: false }
      const aliased = byAlias.get(parsed.name)
      if (aliased) return { command: parsed.name, args: parsed.args, definition: aliased, alias: true }
      return undefined
    }
  }
}
