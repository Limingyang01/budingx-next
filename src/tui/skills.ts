import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isCredentialLike } from '../workspace/policy.js'
import { bundledSkillEntries } from './skills-bundled.js'

/** SP006 §8.1 / SP009 addendum SA-01：技能条目；无效条目保留以便 /skills 面板解释原因。 */
export interface SkillEntry {
  name: string
  description: string
  body: string
  path: string
  scope: 'user' | 'project' | 'bundled'
  valid: boolean
  error?: string
  bodyStartLine?: number
  /** Real directory of the skill at discovery, used to reject retargeted resource roots. */
  resourceRoot?: string
  meta?: SkillMeta
}

export interface SkillMeta {
  allowedTools?: string
  whenToUse?: string
  argumentHint?: string
  arguments?: string
  context?: string
  userInvocable?: boolean
  disableModelInvocation?: boolean
}

export interface DiscoverSkillsOptions {
  homeDir: string
  workspaceDir: string
}

export interface ParsedFrontmatter {
  /** 是否存在（含旧式无围栏的 name:/description: 头）。 */
  present: boolean
  data: Record<string, string>
  body: string
  bodyStartLine?: number
  error?: string
}

const FRONTMATTER_LINE = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/
const LEGACY_KEYS = new Set([
  'name',
  'description',
  'license',
  'allowed-tools',
  'version',
  'user-invocable',
  'disable-model-invocation'
])
const RESOURCE_REFERENCE =
  /^ {0,3}@(?:"([^"\n]+)"|'([^'\n]+)'|((?:\.{1,2}[\\/]|[\\/]|[A-Za-z]:)\S+))[ \t]*$/
const MARKDOWN_FENCE = /^ {0,3}(\x60{3,}|~{3,})(.*)$/
const MAX_RESOURCE_BYTES = 64 * 1024
const MAX_SKILL_BYTES = 128 * 1024
const MAX_RESOURCE_DEPTH = 5
const MAX_RESOURCE_REFERENCES = 32
const RESOURCE_OPEN_FLAGS =
  constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseBody(lines: string[], start: number): { body: string; bodyStartLine: number } {
  const remainder = lines.slice(start)
  const firstNonempty = remainder.findIndex((line) => line.trim())
  return {
    body: remainder.join('\n').trim(),
    bodyStartLine: start + Math.max(0, firstNonempty) + 1
  }
}

/**
 * 解析 SKILL.md 头部。支持标准 `---` 围栏，也兼容旧式无围栏的
 * `name:/description:` 头（0.5.4 既有技能文件），避免静默丢弃用户技能。
 */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const data: Record<string, string> = {}
  if (lines[0]?.trim() === '---') {
    let end = -1
    for (let index = 1; index < lines.length; index++) {
      if (lines[index]?.trim() === '---') {
        end = index
        break
      }
    }
    if (end === -1) {
      return { present: true, data, body: '', error: 'frontmatter 未闭合' }
    }
    for (const line of lines.slice(1, end)) {
      const match = FRONTMATTER_LINE.exec(line)
      if (match) data[match[1]!] = unquote(match[2] ?? '')
    }
    return { present: true, data, ...parseBody(lines, end + 1) }
  }
  let legacyEnd = 0
  while (legacyEnd < lines.length) {
    const match = FRONTMATTER_LINE.exec(lines[legacyEnd] ?? '')
    if (!match || !LEGACY_KEYS.has(match[1]!)) break
    data[match[1]!] = unquote(match[2] ?? '')
    legacyEnd++
  }
  return { present: legacyEnd > 0, data, ...parseBody(lines, legacyEnd) }
}

function readDir(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * SP009 SA-01：项目级技能根 — 从工作目录向上逐层收集 `.budingx/skills`，
 * 遇到 git 仓库根或用户 home 停止（home 本身按用户级单独加载）。
 * 返回顺序为「近 → 远」，与参考仓 getProjectDirsUpToHome 的首胜语义一致。
 */
export function projectSkillRoots(workspaceDir: string, homeDir: string): string[] {
  const roots: string[] = []
  let dir = resolve(workspaceDir)
  const home = resolve(homeDir)
  for (;;) {
    if (dir === home) break
    const skillsDir = join(dir, '.budingx', 'skills')
    if (isDirectory(skillsDir)) roots.push(skillsDir)
    // git 根：这一层收集后停止向上（不越过仓库边界）。
    if (existsSync(join(dir, '.git'))) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return roots
}

function metaOf(data: Record<string, string>): SkillMeta | undefined {
  const meta: SkillMeta = {}
  const allowedTools = data['allowed-tools']?.trim()
  if (allowedTools !== undefined) meta.allowedTools = allowedTools
  const whenToUse = (data.when_to_use ?? data['when-to-use'])?.trim()
  if (whenToUse) meta.whenToUse = whenToUse
  const argumentHint = (data['argument-hint'] ?? data.argument_hint)?.trim()
  if (argumentHint) meta.argumentHint = argumentHint
  const args = data.arguments?.trim()
  if (args) meta.arguments = args
  const context = data.context?.trim()
  if (context) meta.context = context
  const userInvocable = data['user-invocable']?.trim().toLowerCase()
  if (userInvocable) meta.userInvocable = userInvocable !== 'false'
  const disableModelInvocation = data['disable-model-invocation']?.trim().toLowerCase()
  if (disableModelInvocation) meta.disableModelInvocation = disableModelInvocation === 'true'
  return Object.keys(meta).length > 0 ? meta : undefined
}

/** SKILL.md 名称合法性：不接受路径分隔符、空白与控制字符。 */
function legalName(name: string): boolean {
  return name.length > 0 && name.length <= 64 && !/[\\/\s\x00-\x1f\x7f]/.test(name)
}

function loadDir(skillsDir: string, scope: 'user' | 'project'): SkillEntry[] {
  const entries: SkillEntry[] = []
  let trustedBase: string
  try {
    trustedBase = realpathSync.native(dirname(dirname(skillsDir)))
    if (!lstatSync(dirname(skillsDir)).isDirectory() || !lstatSync(skillsDir).isDirectory()) return entries
    if (relative(join(trustedBase, '.budingx', 'skills'), realpathSync.native(skillsDir))) return entries
  } catch {
    return entries
  }
  for (const dir of readDir(skillsDir)) {
    const path = join(skillsDir, dir, 'SKILL.md')
    let text: string
    let resourceRoot: string
    try {
      resourceRoot = realpathSync.native(dirname(path))
      if (relative(join(trustedBase, '.budingx', 'skills', dir), resourceRoot)) continue
      text = readResource(join(resourceRoot, 'SKILL.md'), MAX_SKILL_BYTES).text
    } catch {
      continue
    }
    const parsed = parseFrontmatter(text)
    const declared = parsed.data.name?.trim()
    const name = declared || dir
    const body = parsed.body.trim()
    const error = !parsed.present
      ? '缺少 frontmatter'
      : !legalName(name)
        ? '名称非法'
        : (parsed.error ?? (body.length === 0 ? '正文为空' : undefined))
    const meta = metaOf(parsed.data)
    entries.push({
      name,
      description: parsed.data.description?.trim() ?? '',
      body,
      path,
      scope,
      resourceRoot,
      ...(parsed.bodyStartLine !== undefined ? { bodyStartLine: parsed.bodyStartLine } : {}),
      valid: error === undefined,
      ...(error ? { error } : {}),
      ...(meta ? { meta } : {})
    })
  }
  return entries
}

/**
 * SP009 SA-01/02：多级别技能发现。
 * 级别与顺序：用户级 → 项目级（近→远，向上遍历至 git 根/home）→ 内置级。
 * 同名首胜（用户级优先，项目级中近目录优先），同一物理文件（realpath）只加载一次。
 */
export function discoverSkills(options: DiscoverSkillsOptions): SkillEntry[] {
  const skillDirs: { dir: string; scope: 'user' | 'project' }[] = [
    { dir: join(options.homeDir, '.budingx', 'skills'), scope: 'user' },
    ...projectSkillRoots(options.workspaceDir, options.homeDir).map((dir) => ({
      dir,
      scope: 'project' as const
    }))
  ]
  const found = new Map<string, SkillEntry>()
  const seenFiles = new Set<string>()
  const add = (entry: SkillEntry): void => {
    const key = entry.name.toLowerCase()
    if (found.has(key)) return // 首胜：先加载的级别优先
    let identity = entry.path
    try {
      identity = realpathSync(entry.path)
    } catch {
      /* realpath 失败时退回原路径 */
    }
    if (seenFiles.has(identity)) return
    seenFiles.add(identity)
    found.set(key, entry)
  }
  for (const { dir, scope } of skillDirs) {
    for (const entry of loadDir(dir, scope)) add(entry)
  }
  // 内置级最后加载：同名时磁盘上的用户/项目技能优先。
  for (const entry of bundledSkillEntries()) add(entry)
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** 按命令名查找技能；调用方负责处理 invalid 的明确提示。 */
export function findSkill(skills: SkillEntry[], name: string): SkillEntry | undefined {
  const key = name.toLowerCase()
  return skills.find((skill) => skill.name.toLowerCase() === key)
}

export type SkillActivation =
  | { ok: true; body: string; allowedTools?: readonly string[] }
  | { ok: false; error: string }

class SkillResourceError extends Error {
  constructor(source: string, line: number, reference: string, reason: string) {
    const location = (source + ':' + line + ' @' + reference).replace(/\p{Cc}/gu, '�')
    super('[SKILL_RESOURCE] ' + location + '：' + reason)
  }
}

function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)
}

function readResource(path: string, limit = MAX_RESOURCE_BYTES): { text: string; bytes: number } {
  const before = lstatSync(path)
  if (!before.isFile()) throw new Error('目标不是常规文件')
  if (before.size > limit) throw new Error(`资源超过 ${limit / 1024} KiB 上限`)
  const fd = openSync(path, RESOURCE_OPEN_FLAGS)
  try {
    const opened = fstatSync(fd)
    if (
      !opened.isFile() ||
      opened.ino !== before.ino ||
      opened.dev !== before.dev ||
      relative(path, realpathSync.native(path))
    ) {
      throw new Error('读取期间资源路径发生变化')
    }
    const buffer = Buffer.alloc(limit + 1)
    let bytes = 0
    while (bytes < buffer.length) {
      const count = readSync(fd, buffer, bytes, buffer.length - bytes, null)
      if (count === 0) break
      bytes += count
    }
    if (bytes > limit) throw new Error(`资源超过 ${limit / 1024} KiB 上限`)
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes))
      if (text.includes('\0')) throw new Error('NUL')
      return { text: text.replace(/\r\n?/g, '\n').replace(/\n$/, ''), bytes }
    } catch {
      throw new Error('资源不是有效的 UTF-8 文本')
    }
  } finally {
    closeSync(fd)
  }
}

function expandResources(skill: SkillEntry, allowResource?: (path: string) => boolean): string {
  let totalBytes = Buffer.byteLength(skill.body)
  if (totalBytes > MAX_SKILL_BYTES) throw new Error('技能及资源总量超过 128 KiB 上限')
  if (!skill.body.includes('@')) return skill.body
  const stack: string[] = []
  let count = 0
  let root: string | undefined

  function expand(text: string, source: string, startLine: number, depth: number): string {
    let fence: string | undefined
    return text
      .split('\n')
      .map((line, index) => {
        const marker = MARKDOWN_FENCE.exec(line)
        if (fence) {
          const close = marker?.[1]
          if (close?.[0] === fence[0] && close.length >= fence.length && !marker?.[2]?.trim()) {
            fence = undefined
          }
          return line
        }
        const open = marker?.[1]
        if (open) {
          fence = open
          return line
        }
        const match = RESOURCE_REFERENCE.exec(line)
        if (!match) return line
        const reference = (match[1] ?? match[2] ?? match[3])!
        try {
          if (skill.scope === 'bundled') throw new Error('内置技能没有磁盘资源目录')
          if (depth >= MAX_RESOURCE_DEPTH) throw new Error('资源引用深度超过 5 层上限')
          if (++count > MAX_RESOURCE_REFERENCES) throw new Error('资源引用超过 32 个上限')
          const segments = reference.replaceAll('\\', '/').split('/')
          if (!segments[0] || segments.includes('..') || /[<>:"|?*\p{Cc}]/u.test(reference)) {
            throw new Error('资源路径必须位于技能根内')
          }
          if (!root) {
            const current = realpathSync.native(dirname(skill.path))
            if (skill.resourceRoot && relative(skill.resourceRoot, current)) {
              throw new Error('技能根路径在发现后发生变化')
            }
            root = current
            stack.push(realpathSync.native(skill.path))
          }
          const path = realpathSync.native(resolve(root, ...segments))
          if (!isWithin(root, path)) throw new Error('符号链接指向技能根外')
          if (isCredentialLike(basename(path)) || allowResource?.(path) === false) {
            throw new Error('资源被读取权限拒绝')
          }
          if (stack.some((ancestor) => !relative(ancestor, path))) throw new Error('循环引用')
          const resource = readResource(path)
          totalBytes += resource.bytes
          if (totalBytes > MAX_SKILL_BYTES) throw new Error('技能及资源总量超过 128 KiB 上限')
          stack.push(path)
          try {
            return expand(resource.text, path, 1, depth + 1)
          } finally {
            stack.pop()
          }
        } catch (error) {
          if (error instanceof SkillResourceError) throw error
          const reason =
            error instanceof Error && !('code' in error) ? error.message : '无法读取资源'
          throw new SkillResourceError(source, startLine + index, reference, reason)
        }
      })
      .join('\n')
  }

  return expand(skill.body, skill.path, skill.bodyStartLine ?? 1, 0)
}

/** Resolves both invocation paths against the same discovered skill and resource boundaries. */
export function activateSkill(skill: SkillEntry, invocation: 'manual' | 'model', allowResource?: (path: string) => boolean): SkillActivation {
  if (!skill.valid) return { ok: false, error: skill.error ?? '技能无效' }
  if (invocation === 'manual' && skill.meta?.userInvocable === false) {
    return { ok: false, error: '此技能已禁止用户手动调用' }
  }
  if (invocation === 'model' && skill.meta?.disableModelInvocation === true) {
    return { ok: false, error: '此技能已禁止模型调用' }
  }
  try {
    const body = expandResources(skill, allowResource)
    const tools = skill.meta?.allowedTools
    if (tools === undefined) return { ok: true, body }
    const names = tools
      .replace(/^\[(.*)\]$/, '$1')
      .split(/[\s,]+/)
      .map(unquote)
      .filter(Boolean)
    return { ok: true, body, allowedTools: [...new Set(names)] }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '技能资源读取失败' }
  }
}
