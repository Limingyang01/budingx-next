// Ignore rules (SP003 design §3.4, AC WT-12).
// The gitignore semantics are implemented here from the published rules;
// no third party ignore library is used and no reference implementation code
// is reused. Supported: comments, blank lines, `!` negation, trailing `/`
// for directories, leading `/` anchoring, patterns containing `/` anchored
// to the directory that owns the rule file, `*` and `?` inside a segment and
// `**` across segments. Rules of a deeper directory override the rules of a
// shallower one, and within one file the last matching rule wins.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, posix, relative, resolve, sep } from 'node:path'

type Rule = {
  negate: boolean
  directoryOnly: boolean
  anchored: boolean
  segments: string[]
}

type RuleFile = {
  base: string
  rules: Rule[]
}

export type IgnoreMatcher = {
  /** Whether a path is ignored. The path must be absolute. */
  isIgnored(absolutePath: string): boolean
  /** Whether a directory can be skipped entirely during a traversal. */
  isIgnoredDirectory(absolutePath: string): boolean
}

const DEFAULT_IGNORED_DIRECTORIES = ['.git', '.hg', 'node_modules']

/** Directories that are always ignored, independent of any rule file. */
export function isDefaultIgnoredDirectory(name: string): boolean {
  return DEFAULT_IGNORED_DIRECTORIES.includes(name)
}

function parseRuleFile(content: string): Rule[] {
  const rules: Rule[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.replace(/(?<!\\) +$/, '')
    if (!line || line.startsWith('#')) continue
    let negate = false
    if (line.startsWith('!')) {
      negate = true
      line = line.slice(1)
    }
    if (!line) continue
    if (/^\\[!#]/.test(line)) line = line.slice(1)
    let directoryOnly = false
    if (line.endsWith('/')) {
      directoryOnly = true
      line = line.slice(0, -1)
    }
    if (!line) continue
    const anchored = line.includes('/')
    const segments = line.split('/').filter((segment) => segment.length > 0)
    if (segments.length === 0) continue
    rules.push({ negate, directoryOnly, anchored, segments })
  }
  return rules
}

/** Match a single path segment against a glob pattern segment. */
export function matchSegment(pattern: string, value: string): boolean {
  let p = 0
  let v = 0
  let star = -1
  let backtrack = 0
  while (v < value.length) {
    if (p < pattern.length) {
      const token = pattern[p]
      if (token === '*') {
        star = p
        backtrack = v
        p++
        continue
      }
      if (token === '?' || token === value[v]) {
        p++
        v++
        continue
      }
    }
    if (star >= 0) {
      p = star + 1
      backtrack++
      v = backtrack
      continue
    }
    return false
  }
  while (p < pattern.length && pattern[p] === '*') p++
  return p === pattern.length
}

/** Match the whole relative path against the rule segments (`**` aware). */
export function matchSegments(
  segments: string[],
  pathSegments: string[],
  matchPart = matchSegment
): boolean {
  function walk(patternIndex: number, pathIndex: number): boolean {
    if (patternIndex === segments.length) return pathIndex === pathSegments.length
    const segment = segments[patternIndex]
    if (segment === '**') {
      for (let skip = pathIndex; skip <= pathSegments.length; skip++) {
        if (walk(patternIndex + 1, skip)) return true
      }
      return false
    }
    if (pathIndex >= pathSegments.length) return false
    if (!matchPart(segment, pathSegments[pathIndex])) return false
    return walk(patternIndex + 1, pathIndex + 1)
  }
  return walk(0, 0)
}

function matchIgnoreSegment(pattern: string, value: string): boolean {
  const normalized = pattern.replace(/\\ /g, ' ').replace(/\[!/g, '[^')
  if (normalized.includes('[')) {
    // Prefix both values so wildcard classes also apply to dotfiles.
    return posix.matchesGlob('_' + value, '_' + normalized)
  }
  return matchSegment(normalized, value)
}

function ruleMatches(rule: Rule, pathSegments: string[], isDirectory: boolean): boolean {
  if (rule.directoryOnly && !isDirectory) return false
  if (rule.anchored) return matchSegments(rule.segments, pathSegments, matchIgnoreSegment)
  // A pattern without a slash matches the name at any depth.
  const last = pathSegments.at(-1)
  if (!last) return false
  if (rule.segments.length !== 1) return false
  return matchIgnoreSegment(rule.segments[0], last)
}

export function createIgnoreMatcher(root: string): IgnoreMatcher {
  const rootReal = resolve(root)
  const cache = new Map<string, RuleFile[]>()

  function loadDirectoryRules(directory: string): RuleFile[] {
    const cached = cache.get(directory)
    if (cached) return cached
    const rules: RuleFile[] = []
    for (const name of ['.gitignore', '.ignore']) {
      const file = join(directory, name)
      if (!existsSync(file)) continue
      try {
        const content = readFileSync(file, 'utf8')
        rules.push({ base: directory, rules: parseRuleFile(content) })
      } catch {
        // A rule file that cannot be read must not break the traversal.
      }
    }
    cache.set(directory, rules)
    return rules
  }

  function applicableRules(absolutePath: string): RuleFile[] {
    const segments = relative(rootReal, absolutePath).split(sep).filter(Boolean)
    const directories: string[] = [rootReal]
    let current = rootReal
    for (let index = 0; index < segments.length - 1; index++) {
      current = join(current, segments[index])
      directories.push(current)
    }
    const files: RuleFile[] = []
    for (const directory of directories) files.push(...loadDirectoryRules(directory))
    return files
  }

  function evaluate(absolutePath: string, isDirectory: boolean): boolean {
    const segments = relative(rootReal, absolutePath).split(sep).filter(Boolean)
    if (segments.length === 0) return false
    if (segments.some((segment) => isDefaultIgnoredDirectory(segment))) return true
    let ignored = false
    for (const file of applicableRules(absolutePath)) {
      const relativePath = relative(file.base, absolutePath)
      if (relativePath === '..' || relativePath.startsWith('..' + sep)) continue
      const pathSegments = relativePath.split(sep).filter(Boolean)
      for (const rule of file.rules) {
        if (!ruleMatches(rule, pathSegments, isDirectory)) continue
        ignored = !rule.negate
      }
    }
    return ignored
  }

  /** A path is ignored when one of its parent directories is ignored. */
  function hasIgnoredParent(absolutePath: string): boolean {
    const segments = relative(rootReal, absolutePath).split(sep).filter(Boolean)
    let current = rootReal
    for (let index = 0; index < segments.length - 1; index++) {
      current = join(current, segments[index])
      if (evaluate(current, true)) return true
    }
    return false
  }

  return {
    isIgnored(absolutePath: string): boolean {
      const target = resolve(absolutePath)
      if (hasIgnoredParent(target)) return true
      return evaluate(target, safeIsDirectory(target))
    },
    isIgnoredDirectory(absolutePath: string): boolean {
      const target = resolve(absolutePath)
      if (hasIgnoredParent(target)) return true
      // A directory that does not exist yet can still match a directory rule.
      return evaluate(target, true)
    }
  }
}

function safeIsDirectory(target: string): boolean {
  try {
    return existsSync(target) && statSync(target).isDirectory()
  } catch {
    return false
  }
}

/**
 * File-glob semantics for the Glob tool, @ completion and permission rules:
 * a star never crosses a separator, a double star crosses any number of
 * segments, a question mark matches one character. The pattern is always
 * matched against the whole relative path, so a bare `*.ts` only matches
 * files at the base level while a leading double-star pattern matches at
 * any depth.
 */
export function matchGlob(pattern: string, relativePath: string): boolean {
  const segments = pattern
    .replace(/^\/+/, '')
    .split('/')
    .filter((segment) => segment.length > 0)
  const pathSegments = relativePath
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0)
  if (segments.length === 0) return false
  return matchSegments(segments, pathSegments)
}
