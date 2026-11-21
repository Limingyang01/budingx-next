// SP007 §4.5：评估 runner 的通用工具（路径解析、文件快照、glob 匹配、格式化）。
// 约定：与仓库脚本一致——ESM、2 空格缩进、无分号。
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.budingx', 'artifacts', '.cache'])
const REGEX_SPECIALS = '\\^$.|+()[]{}'

/** 仓库根目录（scripts/eval/lib → 上溯三级）。 */
export function repoRoot() {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '..', '..', '..')
}

/** 统一使用 POSIX 风格相对路径，避免 Windows 分隔符污染断言。 */
export function toPosix(path) {
  return path.split(sep).join('/')
}

/** 递归列出工作区内的文件（相对 POSIX 路径，排序稳定）。 */
export function listFiles(root) {
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        walk(full)
      } else if (entry.isFile()) {
        out.push(toPosix(relative(root, full)))
      }
    }
  }
  walk(root)
  return out.sort()
}

/** 目录内容快照：相对路径 → Buffer。 */
export function snapshotFiles(root) {
  const map = new Map()
  for (const rel of listFiles(root)) {
    try {
      map.set(rel, readFileSync(join(root, rel)))
    } catch {
      // 读不到的文件视为不可比对，不让快照本身把评估打断。
    }
  }
  return map
}

/** 两个快照的差异（新增/修改/删除）。 */
export function diffSnapshots(before, after) {
  const added = []
  const modified = []
  const removed = []
  for (const [rel, content] of after) {
    if (!before.has(rel)) added.push(rel)
    else if (!before.get(rel).equals(content)) modified.push(rel)
  }
  for (const rel of before.keys()) {
    if (!after.has(rel)) removed.push(rel)
  }
  return { added, modified, removed }
}

/** 把 glob 模式编译为正则：支持 **、*、?。 */
export function globToRegExp(pattern) {
  let out = '^'
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 2
        } else {
          out += '.*'
          i += 1
        }
      } else {
        out += '[^/]*'
      }
    } else if (ch === '?') {
      out += '[^/]'
    } else if (REGEX_SPECIALS.includes(ch)) {
      out += '\\' + ch
    } else {
      out += ch
    }
  }
  return new RegExp(out + '$')
}

/** 路径是否命中 glob。 */
export function matchesGlob(path, pattern) {
  return globToRegExp(pattern).test(toPosix(path))
}

/** 路径是否命中任一 glob。 */
export function matchesAny(path, patterns) {
  return (patterns || []).some((pattern) => matchesGlob(path, pattern))
}

/** 复制目录树（用于 fixture 快照）。 */
export function copyTree(from, to) {
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
}

/** 删除目录树（评估结束后清理临时工作区）。 */
export function removeTree(path) {
  rmSync(path, { recursive: true, force: true })
}

/** 目录/文件是否存在。 */
export function exists(path) {
  return existsSync(path)
}

/** 读取文本文件，失败返回 null。 */
export function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** 写文本文件（fixture 准备用）。 */
export function writeText(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** 人类可读的耗时。 */
export function formatDuration(ms) {
  if (ms < 1000) return ms + 'ms'
  const seconds = ms / 1000
  if (seconds < 60) return seconds.toFixed(1) + 's'
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds - minutes * 60)
  return minutes + 'm ' + rest + 's'
}

/** token 数量格式化（与 TUI /stats 的口径一致）。 */
export function formatTokens(count) {
  if (!Number.isFinite(count)) return '0'
  if (count < 1000) return String(count)
  if (count < 1000000) return (count / 1000).toFixed(1) + 'k'
  return (count / 1000000).toFixed(1) + 'M'
}
