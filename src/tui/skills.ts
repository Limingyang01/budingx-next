import { existsSync, realpathSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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
  /** SP009 SA-03：扩展 frontmatter 键，先解析保存（本轮不强制约束）。 */
  meta?: SkillMeta
}

export interface SkillMeta {
  allowedTools?: string
  whenToUse?: string
  argumentHint?: string
  arguments?: string
  context?: string
  userInvocable?: boolean
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
  error?: string
}

const FRONTMATTER_LINE = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/
const LEGACY_KEYS = new Set(['name', 'description', 'license', 'allowed-tools', 'version'])

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
    return { present: true, data, body: lines.slice(end + 1).join('\n').trim() }
  }
  let legacyEnd = 0
  while (legacyEnd < lines.length) {
    const match = FRONTMATTER_LINE.exec(lines[legacyEnd] ?? '')
    if (!match || !LEGACY_KEYS.has(match[1]!)) break
    data[match[1]!] = unquote(match[2] ?? '')
    legacyEnd++
  }
  if (legacyEnd === 0) return { present: false, data, body: normalized.trim() }
  return {
    present: true,
    data,
    body: lines.slice(legacyEnd).join('\n').trim()
  }
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
  if (allowedTools) meta.allowedTools = allowedTools
  const whenToUse = (data.when_to_use ?? data['when-to-use'])?.trim()
  if (whenToUse) meta.whenToUse = whenToUse
  const argumentHint = (data['argument-hint'] ?? data.argument_hint)?.trim()
  if (argumentHint) meta.argumentHint = argumentHint
  const args = data.arguments?.trim()
  if (args) meta.arguments = args
  const context = data.context?.trim()
  if (context) meta.context = context
  const userInvocable = data['user-invocable']?.trim()
  if (userInvocable) meta.userInvocable = userInvocable !== 'false'
  return Object.keys(meta).length > 0 ? meta : undefined
}

/** SKILL.md 名称合法性：不接受路径分隔符、空白与控制字符。 */
function legalName(name: string): boolean {
  return name.length > 0 && name.length <= 64 && !/[\\/\s\x00-\x1f\x7f]/.test(name)
}

function loadDir(skillsDir: string, scope: 'user' | 'project'): SkillEntry[] {
  const entries: SkillEntry[] = []
  for (const dir of readDir(skillsDir)) {
    const path = join(skillsDir, dir, 'SKILL.md')
    let text: string
    try {
      text = readFileSync(path, 'utf8')
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
        : parsed.error ?? (body.length === 0 ? '正文为空' : undefined)
    const meta = metaOf(parsed.data)
    entries.push({
      name,
      description: parsed.data.description?.trim() ?? '',
      body,
      path,
      scope,
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
