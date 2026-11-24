import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  promises as fs,
  readSync,
  readdirSync,
  realpathSync,
  type Dirent,
  type Stats
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Marked } from 'marked'
import { isCredentialLike } from '../workspace/policy.js'

/** SP006 §7.2：单文件与总量上限。 */
export const PROJECT_INSTRUCTION_FILE_LIMIT = 64 * 1024
export const PROJECT_INSTRUCTION_TOTAL_LIMIT = 128 * 1024
const MAX_INCLUDE_DEPTH = 5
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
const IMPORT_REFERENCE = /(?<![\p{L}\p{N}_.@/\\-])@((?:\\ |[^\s@<>()\[\]{}"'`])+)/gu
const markdown = new Marked({ gfm: true }).use({
  tokenizer: {
    del(source) {
      // A home-relative path must not open a GFM single-tilde strikethrough.
      if (!source.startsWith('~/') && !source.startsWith('~\\')) return false
    }
  }
})

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
  scopedFiles?: string[]
  scopedContent?: string
}

export interface LoadProjectInstructionsOptions {
  workspaceDir: string
  homeDir: string
  /** §7.1 第 4 项：子目录 AGENTS.md 默认不扫描。 */
  includeNested?: boolean
  maxNestedDepth?: number
  /** 与工作区相对的目录或绝对目录。只发现从工作区根到该目录的局部规则。 */
  targetDir?: string
  /** PI-02：向父目录发现的层数上限（默认 3，遇到 home 或根即停）。 */
  maxAncestorLevels?: number
  allowImport?: (path: string, fromUserConfig: boolean) => boolean
}

type Candidate = { path: string; root: string; user?: boolean; local?: boolean }
type ImportReference = { path: string; offset: number }
type InstructionFile = { path: string; stat: Stats }
type ReadResult = { body: string; truncated: boolean; bytes: number }
type Reader = Generator<InstructionFile, ProjectInstructions, ReadResult | undefined>

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

function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function ignoredDirectory(name: string): boolean {
  return NESTED_SKIP.has(name) || name.startsWith('.')
}

function missing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR'
}

function canonical(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

function pathKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

function scopedDirectories(workspace: string, targetDir: string, maxDepth: number): string[] | undefined {
  const target = resolve(workspace, targetDir)
  if (!isWithin(workspace, target)) return undefined
  if (!relative(workspace, target)) return []
  const root = canonical(workspace)
  // A new file's parent directory may not exist yet. Validate its nearest existing ancestor.
  for (let dir = target; ; dir = dirname(dir)) {
    try {
      const info = lstatSync(dir)
      const expected = resolve(root, relative(workspace, dir))
      if (!info.isDirectory() || pathKey(realpathSync.native(dir)) !== pathKey(expected)) return undefined
      break
    } catch (error) {
      if (!missing(error) || dir === workspace) return undefined
    }
  }
  const dirs: string[] = []
  let dir = workspace
  for (const name of relative(workspace, target).split(sep).slice(0, Math.max(0, maxDepth))) {
    if (!name || ignoredDirectory(name)) break
    dir = join(dir, name)
    dirs.push(dir)
  }
  return dirs
}

/** 用户 → 工作区父目录（最远者靠前）→ 根 AGENTS.md、CLAUDE.md → 局部 AGENTS.md。 */
function candidateFiles(
  options: LoadProjectInstructionsOptions,
  workspace: string,
  home: string,
  warnings: string[]
): Candidate[] {
  const files: Candidate[] = [{ path: join(home, 'AGENTS.md'), root: home, user: true }]
  const ancestors: Candidate[] = []
  const maxAncestorLevels = options.maxAncestorLevels ?? 3
  let current = workspace
  for (let level = 1; level <= maxAncestorLevels; level++) {
    const parent = dirname(current)
    if (parent === current || !relative(home, parent)) break
    ancestors.push({ path: join(parent, 'AGENTS.md'), root: parent })
    ancestors.push({ path: join(parent, 'CLAUDE.md'), root: parent })
    current = parent
  }
  files.push(
    ...ancestors.reverse(),
    { path: join(workspace, 'AGENTS.md'), root: workspace },
    { path: join(workspace, 'CLAUDE.md'), root: workspace }
  )

  const maxDepth = options.maxNestedDepth ?? 3
  const addLocal = (dir: string) => files.push({ path: join(dir, 'AGENTS.md'), root: workspace, local: true })
  if (options.targetDir !== undefined) {
    const dirs = scopedDirectories(workspace, options.targetDir, maxDepth)
    if (dirs) dirs.forEach(addLocal)
    else warnings.push(`[RULES_SCOPE] 局部规则目录不在可信工作区或无效：${options.targetDir}`)
  } else if (options.includeNested) {
    const walk = (dir: string, depth: number): void => {
      if (depth > maxDepth) return
      let entries: Dirent[]
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      const dirs = entries
        .filter((entry) => entry.isDirectory() && !ignoredDirectory(entry.name))
        .map((entry) => entry.name)
        .sort()
      for (const name of dirs) {
        const child = join(dir, name)
        addLocal(child)
        walk(child, depth + 1)
      }
    }
    walk(workspace, 1)
  }
  return files
}

export function displayInstructionPath(path: string, workspaceDir: string): string {
  const root = resolve(workspaceDir)
  const rel = relative(root, path)
  return rel && isWithin(root, path) ? rel.split(sep).join('/') : path
}

function clipUtf8(buffer: Buffer, limit: number): string {
  let end = Math.min(buffer.length, limit)
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--
  return buffer.toString('utf8', 0, end)
}

function resultFromRead(stat: Stats, buffer: Buffer): ReadResult {
  const truncated = buffer.length > PROJECT_INSTRUCTION_FILE_LIMIT
  const body = new TextDecoder('utf-8', { fatal: true })
    .decode(buffer.subarray(0, PROJECT_INSTRUCTION_FILE_LIMIT), { stream: truncated })
    .replace(/\r\n?/g, '\n')
  return { body, truncated, bytes: truncated ? stat.size : Buffer.byteLength(body.trim()) }
}

function matchesOpenedFile(expected: Stats, actual: Stats): boolean {
  return actual.isFile() && actual.dev === expected.dev && actual.ino === expected.ino
}

// Marked's container tokens can remove list and quote prefixes. Match leaf raw lines against
// the original text in reading order to retain the source offset for diagnostics.
function importsOf(source: string, truncated: boolean): ImportReference[] {
  const references: ImportReference[] = []
  let cursor = 0
  markdown.walkTokens(markdown.lexer(source), (token) => {
    if (token.type === 'table' || token.type === 'list' || ('tokens' in token && token.tokens)) return
    const leaf = token.type === 'text' && !('inRawBlock' in token && token.inRawBlock)
    for (const line of token.raw.split('\n')) {
      if (!line) continue
      const offset = source.indexOf(line, cursor)
      if (offset < 0) continue
      cursor = offset + line.length
      if (!leaf) continue
      for (const match of line.matchAll(IMPORT_REFERENCE)) {
        const path = match[1].replace(/(?<=[^./\\])[.,;!?]+$/u, '').replaceAll('\\ ', ' ')
        if (path === 'import') continue
        if (truncated && offset + match.index + match[0].length === source.length) continue
        references.push({ path, offset: offset + match.index })
      }
    }
  })
  return references
}

function renderBlock(display: string, body: string): string {
  const escaped = display
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
  return `<project-instructions source="${escaped}">\n${body}\n</project-instructions>`
}

function* readInstructions(options: LoadProjectInstructionsOptions): Reader {
  const workspace = resolve(options.workspaceDir)
  const home = resolve(options.homeDir)
  const realHome = canonical(home)
  const config = join(home, '.budingx')
  const blockedRoots = [join(home, '.claude'), join(realHome, '.claude')]
  const warnings: string[] = []
  const files: string[] = []
  const sources: ProjectInstructionSource[] = []
  const blocks: string[] = []
  const scopedFiles: string[] = []
  const scopedBlocks: string[] = []
  const stack = new Set<string>()
  const seen = new Set<string>()
  const roots = new Map<string, string>([[config, join(realHome, '.budingx')], [home, realHome]])
  let total = 0
  let full = false

  const display = (path: string) => displayInstructionPath(path, workspace)
  const isBlocked = (path: string) => blockedRoots.some((root) => isWithin(root, path))

  function* visit(
    candidate: Candidate,
    depth: number,
    origin?: string
  ): Generator<InstructionFile, void, ReadResult | undefined> {
    if (full) return
    const { path, root } = candidate
    const warn = (code: string, reason: string) => {
      warnings.push(`[RULES_${code}] ${origin ?? display(path)}：${reason}`)
    }
    if (isBlocked(path)) {
      if (origin) warn('IMPORT_OUTSIDE', '超出可信根')
      return
    }

    const realRoot = roots.get(root) ?? canonical(root)
    roots.set(root, realRoot)
    const expected = resolve(realRoot, relative(root, path))
    if (isBlocked(expected)) {
      if (origin) warn('IMPORT_OUTSIDE', '超出可信根')
      return
    }
    let stat: Stats
    let real: string
    try {
      let current = realRoot
      stat = lstatSync(current)
      for (const segment of relative(realRoot, expected).split(sep)) {
        if (stat.isSymbolicLink()) break
        if (!segment) continue
        current = join(current, segment)
        stat = lstatSync(current)
      }
      if (stat.isSymbolicLink()) {
        warn(origin ? 'IMPORT_SYMLINK' : 'SYMLINK', '符号链接，已忽略')
        return
      }
      real = realpathSync.native(expected)
    } catch (error) {
      if (origin) warn('IMPORT_INVALID', '文件不存在或无法访问')
      else if (!missing(error)) warn('READ', '项目指令读取失败，已忽略')
      return
    }
    if (pathKey(real) !== pathKey(expected)) {
      warn(origin ? 'IMPORT_SYMLINK' : 'SYMLINK', '符号链接，已忽略')
      return
    }
    if (!stat.isFile()) {
      if (origin) warn('IMPORT_INVALID', '目标不是常规文件')
      return
    }
    const key = pathKey(real)
    if (origin && (isCredentialLike(basename(real)) || options.allowImport?.(real, candidate.user === true) === false)) {
      warn('IMPORT_DENIED', '导入被读取权限拒绝')
      return
    }
    if (stack.has(key)) {
      warn('IMPORT_CYCLE', '循环导入')
      return
    }
    if (seen.has(key)) {
      if (origin) warn('IMPORT_DUPLICATE', '重复导入')
      return
    }
    seen.add(key)
    const read = yield { path: real, stat }
    if (!read) {
      warn(origin ? 'IMPORT_INVALID' : 'READ', '项目指令读取失败，已忽略')
      return
    }
    const body = read.body.trim()
    if (!body) {
      warn(origin ? 'IMPORT_INVALID' : 'EMPTY', '项目指令为空，已忽略')
      return
    }
    if (read.truncated) warn('FILE_LIMIT', '项目指令单文件超过 64 KiB，已截断')

    const block = renderBlock(display(path), body)
    const buffer = Buffer.from(block)
    const separator = total > 0 ? 2 : 0
    const remaining = PROJECT_INSTRUCTION_TOTAL_LIMIT - total - separator
    const clipped = buffer.length > remaining
    if (clipped) {
      full = true
      warn('TOTAL_LIMIT', `项目指令超过 128 KiB 上限，已${remaining > 128 ? '截断' : '忽略'}`)
      if (remaining <= 128) return
    }
    const rendered = clipped ? clipUtf8(buffer, remaining) : block
    // Reserve the includer's bytes before traversal so imports cannot crowd it out.
    total += Buffer.byteLength(rendered) + separator

    if (!full && read.body.includes('@')) {
      stack.add(key)
      const importRoots = candidate.user ? [workspace, config] : [workspace]
      let line = 1
      let lineStart = 0
      let newline = read.body.indexOf('\n')
      for (const reference of importsOf(read.body, read.truncated)) {
        if (full) break
        while (newline >= 0 && newline < reference.offset) {
          line++
          lineStart = newline + 1
          newline = read.body.indexOf('\n', lineStart)
        }
        const column = reference.offset - lineStart + 1
        const location = `${display(path)}:${line}:${column} @${reference.path}`
        if (depth >= MAX_INCLUDE_DEPTH) {
          warnings.push(`[RULES_IMPORT_DEPTH] ${location}：导入深度超过 ${MAX_INCLUDE_DEPTH}`)
          continue
        }
        const pathPart = process.platform === 'win32' && /^[A-Za-z]:[/\\]/u.test(reference.path)
          ? reference.path.slice(2) : reference.path
        if (/[:\p{Cc}]/u.test(pathPart)) {
          warnings.push(`[RULES_IMPORT_INVALID] ${location}：无效文件路径`)
          continue
        }
        const imported = reference.path.startsWith('~/') || reference.path.startsWith('~\\')
          ? resolve(home, reference.path.slice(2))
          : resolve(dirname(path), reference.path)
        const importRoot = importRoots.find((root) => isWithin(root, imported))
        if (!importRoot || isBlocked(imported)) {
          warnings.push(`[RULES_IMPORT_OUTSIDE] ${location}：超出可信根`)
          continue
        }
        yield* visit(
          { path: imported, root: importRoot, user: importRoot === config, local: candidate.local },
          depth + 1,
          location
        )
      }
      stack.delete(key)
    }

    blocks.push(rendered)
    files.push(path)
    sources.push({ path, bytes: read.bytes, ...(clipped || read.truncated ? { truncated: true } : {}) })
    if (candidate.local) {
      scopedBlocks.push(rendered)
      scopedFiles.push(path)
    }
  }

  for (const candidate of candidateFiles(options, workspace, home, warnings)) {
    if (full) break
    yield* visit(candidate, 0)
  }
  return {
    files,
    content: blocks.join('\n\n'),
    sources,
    warnings,
    ...(options.targetDir !== undefined ? { scopedFiles, scopedContent: scopedBlocks.join('\n\n') } : {})
  }
}

export async function loadProjectInstructions(options: LoadProjectInstructionsOptions): Promise<ProjectInstructions> {
  const reader = readInstructions(options)
  let next = reader.next()
  while (!next.done) {
    const { path, stat } = next.value
    let result: ReadResult | undefined
    try {
      const file = await fs.open(path, OPEN_FLAGS)
      try {
        const opened = await file.stat()
        if (matchesOpenedFile(stat, opened)) {
          const buffer = await file.read({ buffer: Buffer.alloc(PROJECT_INSTRUCTION_FILE_LIMIT + 4) })
          result = resultFromRead(opened, buffer.buffer.subarray(0, buffer.bytesRead))
        }
      } finally {
        await file.close()
      }
    } catch {
      // The shared traversal reports a read failure with the originating instruction location.
    }
    next = reader.next(result)
  }
  return next.value
}

/** 同步版本：宿主在每个模型请求前取一次，保证文件改动下一回合生效。 */
export function loadProjectInstructionsSync(options: LoadProjectInstructionsOptions): ProjectInstructions {
  const reader = readInstructions(options)
  let next = reader.next()
  while (!next.done) {
    const { path, stat } = next.value
    let result: ReadResult | undefined
    try {
      const file = openSync(path, OPEN_FLAGS)
      try {
        const opened = fstatSync(file)
        if (matchesOpenedFile(stat, opened)) {
          const buffer = Buffer.alloc(PROJECT_INSTRUCTION_FILE_LIMIT + 4)
          const length = readSync(file, buffer)
          result = resultFromRead(opened, buffer.subarray(0, length))
        }
      } finally {
        closeSync(file)
      }
    } catch {
      // The shared traversal reports a read failure with the originating instruction location.
    }
    next = reader.next(result)
  }
  return next.value
}
