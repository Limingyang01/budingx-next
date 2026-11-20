import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** SP006 §8.1：技能条目；无效条目保留以便 /skills 面板解释原因。 */
export interface SkillEntry {
  name: string
  description: string
  body: string
  path: string
  scope: 'user' | 'project'
  valid: boolean
  error?: string
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

/**
 * 发现两类根下的 `<root>/skills/<dir>/SKILL.md`：用户级与项目级。
 * 同名时项目级覆盖用户级（§8.1 规则 4）。
 */
export function discoverSkills(options: DiscoverSkillsOptions): SkillEntry[] {
  const roots: { root: string; scope: 'user' | 'project' }[] = [
    { root: join(options.homeDir, '.budingx'), scope: 'user' },
    { root: join(options.workspaceDir, '.budingx'), scope: 'project' }
  ]
  const found = new Map<string, SkillEntry>()
  for (const { root, scope } of roots) {
    const skillsDir = join(root, 'skills')
    for (const dir of readDir(skillsDir)) {
      const path = join(skillsDir, dir, 'SKILL.md')
      let text: string
      try {
        text = readFileSync(path, 'utf8')
      } catch {
        continue
      }
      const parsed = parseFrontmatter(text)
      const name = parsed.data.name?.trim() || dir
      const body = parsed.body.trim()
      const error = !parsed.present
        ? '缺少 frontmatter'
        : parsed.error ?? (body.length === 0 ? '正文为空' : undefined)
      const entry: SkillEntry = {
        name,
        description: parsed.data.description?.trim() ?? '',
        body,
        path,
        scope,
        valid: error === undefined,
        ...(error ? { error } : {})
      }
      found.set(name.toLowerCase(), entry)
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** 按命令名查找技能；调用方负责处理 invalid 的明确提示。 */
export function findSkill(skills: SkillEntry[], name: string): SkillEntry | undefined {
  const key = name.toLowerCase()
  return skills.find((skill) => skill.name.toLowerCase() === key)
}
