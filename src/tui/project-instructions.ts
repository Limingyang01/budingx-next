import { promises as fs, readFileSync, statSync, readdirSync, type Dirent } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/** SP006 §7.2：单文件与总量上限。 */
export const PROJECT_INSTRUCTION_FILE_LIMIT = 64 * 1024
export const PROJECT_INSTRUCTION_TOTAL_LIMIT = 128 * 1024

export interface ProjectInstructionSource {
  path: string
  bytes: number
  truncated?: boolean
}

export interface ProjectInstructions {
  files: string[]
  content: string
  sources: ProjectInstructionSource[]
  warnings: string[]
}

export interface LoadProjectInstructionsOptions {
  workspaceDir: string
  homeDir: string
  /** §7.1 第 4 项：子目录 AGENTS.md 默认不扫描。 */
  includeNested?: boolean
  maxNestedDepth?: number
  /** PI-02：向父目录发现的层数上限（默认 3，遇到 home 或根即停）。 */
  maxAncestorLevels?: number
}

type Candidate = { path: string; scope: 'user' | 'workspace' | 'nested' }
type Entry = { path: string; display: string; body: string; bytes: number; truncated: boolean }

const NESTED_SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.cache',
  'coverage'
])

function bytesOf(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

function clipBytes(text: string, limit: number): { text: string; truncated: boolean } {
  if (bytesOf(text) <= limit) return { text, truncated: false }
  let end = Math.min(text.length, limit)
  while (end > 0 && bytesOf(text.slice(0, end)) > limit) end--
  return { text: text.slice(0, end), truncated: true }
}

/**
 * §7.1 + PI-02 优先级顺序：
 * 用户级 → 工作区父目录（受限向上，最远者靠前）→ 工作区 AGENTS.md →
 * 工作区 CLAUDE.md → 子目录（仅显式开启）。更具体者靠后。
 */
function candidateFiles(
  options: LoadProjectInstructionsOptions,
  workspaceDir: string
): Candidate[] {
  const homeDir = resolve(options.homeDir)
  const files: Candidate[] = [{ path: join(homeDir, 'AGENTS.md'), scope: 'user' }]
  const ancestors: Candidate[] = []
  const maxAncestorLevels = options.maxAncestorLevels ?? 3
  let current = workspaceDir
  for (let level = 1; level <= maxAncestorLevels; level++) {
    const parent = resolve(current, '..')
    if (parent === current) break
    // 不越过用户主目录，也不把主目录本身当作项目级（用户级固定为 ~/.budingx）。
    if (parent === homeDir) break
    ancestors.push({ path: join(parent, 'AGENTS.md'), scope: 'nested' })
    ancestors.push({ path: join(parent, 'CLAUDE.md'), scope: 'nested' })
    current = parent
  }
  files.push(...ancestors.reverse())
  files.push({ path: join(workspaceDir, 'AGENTS.md'), scope: 'workspace' })
  files.push({ path: join(workspaceDir, 'CLAUDE.md'), scope: 'workspace' })
  if (!options.includeNested) return files
  const maxDepth = options.maxNestedDepth ?? 3
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return
    let entries: Dirent[] = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    const dirs = entries
      .filter((entry) => entry.isDirectory() && !NESTED_SKIP.has(entry.name) && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort()
    for (const name of dirs) {
      const child = join(dir, name)
      const agents = join(child, 'AGENTS.md')
      try {
        if (statSync(agents).isFile()) files.push({ path: agents, scope: 'nested' })
      } catch {
        /* 该层没有 AGENTS.md */
      }
      walk(child, depth + 1)
    }
  }
  walk(workspaceDir, 1)
  return files
}

export function displayInstructionPath(path: string, workspaceDir: string): string {
  const root = resolve(workspaceDir)
  const rel = relative(root, path)
  if (rel && !rel.startsWith('..') && !rel.split(sep).includes('..')) return rel.split(sep).join('/')
  return path
}

function trimBody(body: string): string {
  return body.replace(/\r\n/g, '\n').trim()
}

function renderBlock(display: string, body: string): string {
  return `<project-instructions source="${display}">\n${body}\n</project-instructions>`
}

function assemble(entries: Entry[], warnings: string[], workspaceDir: string): ProjectInstructions {
  const blocks: string[] = []
  const sources: ProjectInstructionSource[] = []
  const files: string[] = []
  let total = 0
  let stopped = false
  for (const entry of entries) {
    if (stopped) break
    const block = renderBlock(entry.display, entry.body)
    const blockBytes = bytesOf(block) + (blocks.length > 0 ? 2 : 0)
    if (total + blockBytes > PROJECT_INSTRUCTION_TOTAL_LIMIT) {
      const remaining = PROJECT_INSTRUCTION_TOTAL_LIMIT - total
      if (remaining > 128) {
        const clipped = clipBytes(block, remaining)
        blocks.push(clipped.text)
        sources.push({ path: entry.path, bytes: entry.bytes, truncated: true })
        files.push(entry.path)
        warnings.push(`项目指令超过 128 KiB 上限，已截断：${displayInstructionPath(entry.path, workspaceDir)}`)
        stopped = true
      } else {
        warnings.push(`项目指令超过 128 KiB 上限，已忽略：${displayInstructionPath(entry.path, workspaceDir)}`)
        stopped = true
      }
      break
    }
    blocks.push(block)
    total += blockBytes
    sources.push({
      path: entry.path,
      bytes: entry.bytes,
      ...(entry.truncated ? { truncated: true } : {})
    })
    files.push(entry.path)
    if (entry.truncated) {
      warnings.push(`项目指令单文件超过 64 KiB，已截断：${displayInstructionPath(entry.path, workspaceDir)}`)
    }
  }
  return { files, content: blocks.join('\n\n'), sources, warnings }
}

function toEntry(candidate: Candidate, text: string, workspaceDir: string): Entry {
  const body = trimBody(text)
  const clipped = clipBytes(body, PROJECT_INSTRUCTION_FILE_LIMIT)
  return {
    path: candidate.path,
    display: displayInstructionPath(candidate.path, workspaceDir),
    body: clipped.text,
    bytes: bytesOf(body),
    truncated: clipped.truncated
  }
}

function readWarning(error: unknown): 'missing' | 'failed' {
  const code = (error as { code?: string } | null)?.code
  return code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR' ? 'missing' : 'failed'
}

export async function loadProjectInstructions(
  options: LoadProjectInstructionsOptions
): Promise<ProjectInstructions> {
  const workspaceDir = resolve(options.workspaceDir)
  const warnings: string[] = []
  const entries: Entry[] = []
  for (const candidate of candidateFiles(options, workspaceDir)) {
    let text: string
    try {
      text = await fs.readFile(candidate.path, 'utf8')
    } catch (error) {
      if (readWarning(error) === 'failed') {
        warnings.push(`项目指令读取失败，已忽略：${displayInstructionPath(candidate.path, workspaceDir)}`)
      }
      continue
    }
    const entry = toEntry(candidate, text, workspaceDir)
    if (entry.body.length === 0) {
      warnings.push(`项目指令为空，已忽略：${displayInstructionPath(candidate.path, workspaceDir)}`)
      continue
    }
    entries.push(entry)
  }
  return assemble(entries, warnings, workspaceDir)
}

/** 同步版本：宿主在每个模型请求前取一次，保证文件改动下一回合生效。 */
export function loadProjectInstructionsSync(
  options: LoadProjectInstructionsOptions
): ProjectInstructions {
  const workspaceDir = resolve(options.workspaceDir)
  const warnings: string[] = []
  const entries: Entry[] = []
  for (const candidate of candidateFiles(options, workspaceDir)) {
    let text: string
    try {
      text = readFileSync(candidate.path, 'utf8')
    } catch (error) {
      if (readWarning(error) === 'failed') {
        warnings.push(`项目指令读取失败，已忽略：${displayInstructionPath(candidate.path, workspaceDir)}`)
      }
      continue
    }
    const entry = toEntry(candidate, text, workspaceDir)
    if (entry.body.length === 0) {
      warnings.push(`项目指令为空，已忽略：${displayInstructionPath(candidate.path, workspaceDir)}`)
      continue
    }
    entries.push(entry)
  }
  return assemble(entries, warnings, workspaceDir)
}
