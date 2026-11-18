// SP004 T7 · 改动归属与提交范围分析（design §7.2，AC GW-02 / GW-03）。
// 纯逻辑：以 Git 状态 + Agent 自己的改动记录（checkpoint）判定哪些改动可以进入提交范围。
// 禁止 reset/stash/clean：本模块不执行任何 Git 写命令，也不触碰用户文件。
import { isAbsolute, relative, sep } from 'node:path'
import type { ChangeRecord } from '../workspace/checkpoint.js'
import type { GitStatus } from './status.js'

export type ChangeOperation = 'add' | 'modify' | 'delete' | 'rename'

export type IncludeChange = {
  path: string
  operation: ChangeOperation
  /** true = 该文件既有用户改动又有 Agent 改动（GW-03），不自动纳入可提交范围。 */
  mixed?: boolean
}

export type AnalyzeChangesResult = {
  /** 可纳入提交范围的 Agent 改动（混合文件带 mixed 标记，交由宿主决策）。 */
  include: IncludeChange[]
  /** 用户既有改动（未混淆的完整文件）。 */
  userOwned: string[]
  /** Agent 声明过但当前已无改动的路径。 */
  untouched: string[]
  /** 混合修改文件（同文件既有用户改动也有 Agent 改动）。 */
  mixed: string[]
  /** 冲突未解决文件：不进入可提交范围。 */
  conflicted: string[]
}

export type AnalyzeChangesInput = {
  status: GitStatus
  /** Agent 自己的改动路径（仓库相对路径，通常来自 checkpoint 记录）。 */
  ownPaths: string[]
  /** 宿主已知的、Agent 开始前就存在改动的路径；用于识别混合修改。 */
  userPaths?: string[]
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

function normalize(path: string): string {
  return toPosix(path).replace(/^\.\/+/, '')
}

function operationOf(index: string, worktree: string): ChangeOperation {
  if (index === '?') return 'add'
  if (index === 'R' || worktree === 'R') return 'rename'
  if (index === 'A') return 'add'
  if (index === 'D' || worktree === 'D') return 'delete'
  return 'modify'
}

/**
 * 把 checkpoint 记录转成仓库相对路径；越界记录被忽略。
 * 工作区写入记录本来就是工作区相对路径（`src/workspace/write.ts` 的 `resolved.relative`），
 * 宿主也可能写入绝对路径，两种形式都要接受，但只保留确实落在 root 内的路径。
 */
export function ownPathsFromCheckpoints(records: ChangeRecord[], root: string): string[] {
  const own = new Set<string>()
  for (const record of records) {
    const relativePath = isAbsolute(record.path) ? relative(root, record.path) : record.path
    if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) continue
    const normalized = toPosix(relativePath).replace(/^\.\/+/, '')
    if (normalized === '') continue
    own.add(normalized)
  }
  return [...own].sort()
}

/** 拆分 Git 状态：哪些是 Agent 的改动、哪些是用户既有改动、哪些有冲突。 */
export function analyzeChanges(input: AnalyzeChangesInput): AnalyzeChangesResult {
  const { status } = input
  const ownPaths = new Set(input.ownPaths.map(normalize))
  const userPaths = new Set((input.userPaths ?? []).map(normalize))
  const conflicted = new Set(status.conflicted.map(normalize))

  const result: AnalyzeChangesResult = {
    include: [],
    userOwned: [],
    untouched: [],
    mixed: [],
    conflicted: [...conflicted].sort()
  }

  // 结构化条目优先（能区分 add/delete/rename）；缺省时退化为路径列表。
  const entries =
    status.changes !== undefined && status.changes.length > 0
      ? status.changes.map((entry) => ({
          path: normalize(entry.path),
          operation: operationOf(entry.index, entry.worktree)
        }))
      : [
          ...status.staged.map((path) => ({ path: normalize(path), operation: 'modify' as const })),
          ...status.unstaged.map((path) => ({ path: normalize(path), operation: 'modify' as const })),
          ...status.untracked.map((path) => ({ path: normalize(path), operation: 'add' as const }))
        ]

  const seen = new Set<string>()
  const statusPaths = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.path)) continue
    seen.add(entry.path)
    statusPaths.add(entry.path)
    if (conflicted.has(entry.path)) continue
    if (ownPaths.has(entry.path)) {
      const mixed = userPaths.has(entry.path)
      if (mixed) result.mixed.push(entry.path)
      result.include.push({
        path: entry.path,
        operation: entry.operation,
        ...(mixed ? { mixed: true } : {})
      })
      continue
    }
    result.userOwned.push(entry.path)
  }

  for (const path of ownPaths) {
    if (!statusPaths.has(path)) result.untouched.push(path)
  }

  result.include.sort((a, b) => a.path.localeCompare(b.path))
  result.userOwned.sort()
  result.untouched.sort()
  result.mixed.sort()
  return result
}