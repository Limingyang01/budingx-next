// SP004 T6 · `git status --porcelain=v1 -z --branch` 纯解析（design §7.1）。
// 只做文本解析，不触碰文件系统：便于 L0 单测覆盖冲突/重命名/Unicode 路径。

export type PorcelainBranch = {
  name: string
  ahead?: number
  behind?: number
}

export type PorcelainEntry = {
  path: string
  /** 索引状态位（第一位）。 */
  index: string
  /** 工作区状态位（第二位）。 */
  worktree: string
}

export type ParsedPorcelain = {
  staged: string[]
  unstaged: string[]
  untracked: string[]
  conflicted: string[]
  /** 结构化条目（含两字符状态码），用于判定改动操作类型。 */
  entries: PorcelainEntry[]
  branch?: PorcelainBranch
}

/** 两字符状态码中表示冲突的组合（merge/rebase 未解决）。 */
const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

/** 带源路径的条目（重命名/复制）：`-z` 下源路径是紧随其后的独立 NUL 段。 */
const RENAME_OR_COPY = new Set(['R', 'C'])

function parseBranch(header: string): PorcelainBranch | undefined {
  // 形式：`## main`、`## main...origin/main [ahead 1, behind 2]`、
  // `## No commits yet on master`、`## HEAD (no branch)`。
  const text = header.slice(3).trim()
  if (text === '' || text.startsWith('HEAD')) return undefined
  const withoutNoCommits = text.startsWith('No commits yet on ') ? text.slice('No commits yet on '.length) : text
  const [namesPart, trackingPart] = withoutNoCommits.split(' [')
  const name = namesPart.split('...')[0]?.trim()
  if (name === undefined || name === '') return undefined
  const branch: PorcelainBranch = { name }
  if (trackingPart !== undefined) {
    const ahead = /ahead (\d+)/.exec(trackingPart)
    const behind = /behind (\d+)/.exec(trackingPart)
    if (ahead) branch.ahead = Number.parseInt(ahead[1], 10)
    if (behind) branch.behind = Number.parseInt(behind[1], 10)
  }
  return branch
}

export function parsePorcelain(raw: string): ParsedPorcelain {
  const result: ParsedPorcelain = { staged: [], unstaged: [], untracked: [], conflicted: [], entries: [] }
  const records = raw.split('\0').filter((record) => record !== '')
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record.startsWith('## ')) {
      const branch = parseBranch(record)
      if (branch !== undefined) result.branch = branch
      continue
    }
    if (record.length < 4) continue
    const x = record[0]
    const y = record[1]
    // 三个字符前缀：`XY ` 后紧跟路径（-z 下路径不加引号）。
    const path = record.slice(3)
    if (x === '?' && y === '?') {
      result.untracked.push(path)
      result.entries.push({ path, index: x, worktree: y })
      continue
    }
    if (x === '!' && y === '!') continue
    result.entries.push({ path, index: x, worktree: y })
    const code = `${x}${y}`
    if (CONFLICT_CODES.has(code)) {
      result.conflicted.push(path)
      continue
    }
    if (x !== ' ' && x !== '?') result.staged.push(path)
    if (y !== ' ' && y !== '?') result.unstaged.push(path)
    // 重命名/复制条目后紧跟源路径段：跳过，避免被当成新条目。
    if (RENAME_OR_COPY.has(x) || RENAME_OR_COPY.has(y)) index += 1
  }
  return result
}