// Agent file discovery and persistence (SP007 design §4.1, D14).
// Host-side IO companion to the pure core/agent-definitions module;
// follows the src/tui/skills.ts precedent. Only ~/.budingx and the project
// tree are touched; ~/.claude is never read.
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  BUILT_IN_AGENTS,
  parseAgentFile,
  serializeAgentFile,
  type AgentDefinition
} from '../core/agent-definitions.js'

export interface LoadAgentsOptions {
  cwd: string
  home: string
}

export interface LoadAgentsResult {
  agents: AgentDefinition[]
  warnings: string[]
}

const cache = new Map<string, LoadAgentsResult>()

/** Clear the discovery cache (called after every save/delete). */
export function invalidateAgentCache(): void {
  cache.clear()
}

function userAgentsDir(home: string): string {
  return join(home, '.budingx', 'agents')
}

/**
 * Project agent directories from the git root down to cwd (nearer wins).
 * A .git entry (directory or worktree file) marks the root; without one,
 * only the cwd level is inspected.
 */
export function projectAgentsDirs(cwd: string): string[] {
  const start = resolve(cwd)
  const chain: string[] = []
  let current = start
  let gitRoot: string | undefined
  for (;;) {
    chain.push(current)
    if (existsSync(join(current, '.git'))) {
      gitRoot = current
      break
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  const levels = gitRoot ? chain : [start]
  // chain is cwd→root; apply root→cwd so nearer directories override.
  return levels.reverse().map((dir) => join(dir, '.budingx', 'agents'))
}

function readAgentsDir(dir: string, source: 'user' | 'project', into: Map<string, AgentDefinition>, warnings: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir).filter((name) => name.endsWith('.md')).sort()
  } catch {
    return
  }
  for (const entry of entries) {
    const filePath = join(dir, entry)
    try {
      if (!statSync(filePath).isFile()) continue
    } catch {
      continue
    }
    let text: string
    try {
      text = readFileSync(filePath, 'utf8')
    } catch {
      warnings.push(`${filePath}: 读取失败`)
      continue
    }
    const { definition, warnings: fileWarnings } = parseAgentFile(text, { source, filePath })
    warnings.push(...fileWarnings)
    if (definition) into.set(definition.name, definition)
  }
}

/** Built-in → user → project (root→cwd); same name: later source wins. */
export function loadAgentDefinitions(options: LoadAgentsOptions): LoadAgentsResult {
  const key = `${resolve(options.home)}|${resolve(options.cwd)}`
  const hit = cache.get(key)
  if (hit) return { agents: hit.agents, warnings: hit.warnings }
  const found = new Map<string, AgentDefinition>()
  const warnings: string[] = []
  for (const agent of BUILT_IN_AGENTS) found.set(agent.name, { ...agent })
  readAgentsDir(userAgentsDir(options.home), 'user', found, warnings)
  for (const dir of projectAgentsDirs(options.cwd)) {
    readAgentsDir(dir, 'project', found, warnings)
  }
  const result: LoadAgentsResult = {
    agents: [...found.values()].sort((a, b) => a.name.localeCompare(b.name)),
    warnings
  }
  cache.set(key, result)
  return { agents: result.agents, warnings: result.warnings }
}

export interface SaveAgentOptions {
  location: 'project' | 'user'
  cwd: string
  home: string
  definition: AgentDefinition
}

/** Write <name>.md with 'wx' (never overwrite); returns the file path. */
export async function saveAgentFile(options: SaveAgentOptions): Promise<string> {
  const dir =
    options.location === 'user'
      ? userAgentsDir(options.home)
      : projectAgentsDirs(options.cwd)[0] ?? join(options.cwd, '.budingx', 'agents')
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, `${options.definition.name}.md`)
  const text = serializeAgentFile({ ...options.definition, source: options.location })
  writeFileSync(filePath, text, { encoding: 'utf8', flag: 'wx' })
  invalidateAgentCache()
  return filePath
}

/** Delete a user/project agent file; built-in definitions are protected. */
export async function deleteAgentFile(definition: AgentDefinition): Promise<void> {
  if (definition.source !== 'user' && definition.source !== 'project') {
    throw new Error('内置代理不可删除')
  }
  if (!definition.filePath) throw new Error('代理缺少文件路径')
  unlinkSync(definition.filePath)
  invalidateAgentCache()
}
