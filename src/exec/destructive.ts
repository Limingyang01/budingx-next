// SP004 T20 · 破坏性命令警告层（设计 §4.6，CE-18）。
// 对齐参考 F-08：只提示不阻断，不影响权限判定；底线拒绝由权限策略负责。
import { tokenizeCommand } from './readonly-commands.js'

export interface DestructiveWarning {
  destructive: boolean
  reason?: string
}

/** 固定警告文案，接入审批弹窗展示。 */
export function destructiveWarningText(reason: string): string {
  return `⚠ 该命令可能造成不可逆的数据丢失：${reason}`
}

/** 展开组合短旗标（-fd → f、d），长旗标原样保留。 */
function expandFlags(args: readonly string[]): Set<string> {
  const flags = new Set<string>()
  for (const token of args) {
    if (token.startsWith('--')) {
      flags.add(token)
    } else if (token.startsWith('-') && token.length > 1) {
      for (const letter of token.slice(1)) flags.add(letter)
    }
  }
  return flags
}

function gitDestructive(args: readonly string[]): string | undefined {
  const sub = args[0]
  const rest = args.slice(1)
  const flags = expandFlags(rest)
  // 安全绕过优先提示（--no-verify 与 --force 可能同时出现）。
  if ((sub === 'commit' || sub === 'push' || sub === 'merge') && flags.has('--no-verify')) {
    return `git ${sub} --no-verify 绕过 Git 钩子校验`
  }
  switch (sub) {
    case 'reset':
      if (flags.has('--hard')) return 'git reset --hard 丢弃未提交的工作区改动'
      return undefined
    case 'checkout':
    case 'restore':
      if (rest.includes('.')) return `git ${sub} . 丢弃全部工作区改动`
      return undefined
    case 'clean': {
      const force = flags.has('f') || flags.has('--force')
      const dryRun = flags.has('n') || flags.has('--dry-run')
      if (force && !dryRun) return 'git clean -f 强制删除未跟踪文件'
      return undefined
    }
    case 'push':
      if (flags.has('--force') || flags.has('--force-with-lease') || flags.has('f')) {
        return 'git push --force 改写远端历史'
      }
      return undefined
    case 'stash':
      if (rest[0] === 'drop' || rest[0] === 'clear') return 'git stash drop/clear 不可逆删除暂存内容'
      return undefined
    case 'branch':
      if (flags.has('D') || (flags.has('--delete') && flags.has('--force'))) {
        return 'git branch -D 强制删除分支'
      }
      return undefined
    default:
      return undefined
  }
}

function filesystemDestructive(program: string, args: readonly string[]): string | undefined {
  const flags = expandFlags(args)
  const lower = program.toLowerCase()
  if (lower === 'rm' && (flags.has('r') || flags.has('--recursive'))) {
    return 'rm -r 递归删除文件'
  }
  if (lower === 'del' && args.some((token) => token.toLowerCase() === '/s')) {
    return 'del /s 递归删除文件'
  }
  if (lower === 'remove-item') {
    const hasRecurse = args.some((token) => token.toLowerCase() === '-recurse')
    const hasForce = args.some((token) => token.toLowerCase() === '-force')
    if (hasRecurse && hasForce) return 'Remove-Item -Recurse -Force 递归强制删除文件'
  }
  if (lower === 'format') return 'format 格式化磁盘，数据不可恢复'
  if (lower === 'dd' && args.some((token) => token.startsWith('of=/dev/'))) {
    return 'dd of=/dev/ 直接写入设备文件'
  }
  return undefined
}

// 复合语句无法分词时的保守文本扫描（警告层只提示，宁可多提示）。
const COMPOUND_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/git\s+reset\b[^;|&]*--hard/, 'git reset --hard 丢弃未提交的工作区改动'],
  [/git\s+(checkout|restore)\s+\./, 'git checkout/restore . 丢弃全部工作区改动'],
  [/git\s+clean\b[^;|&]*-[a-z]*f/, 'git clean -f 强制删除未跟踪文件'],
  [/git\s+push\b[^;|&]*(--force|--force-with-lease|-f\b)/, 'git push --force 改写远端历史'],
  [/git\s+stash\s+(drop|clear)/, 'git stash drop/clear 不可逆删除暂存内容'],
  [/git\s+branch\b[^;|&]*-D/, 'git branch -D 强制删除分支'],
  [/--no-verify/, '--no-verify 绕过 Git 钩子校验'],
  [/\brm\s+-[a-z]*r/, 'rm -r 递归删除文件'],
  [/\bdel\s+\/s/i, 'del /s 递归删除文件'],
  [/remove-item[^;|&]*-recurse[^;|&]*-force/i, 'Remove-Item -Recurse -Force 递归强制删除文件'],
  [/\bformat\s+[a-z]:/i, 'format 格式化磁盘，数据不可恢复'],
  [/\bdd\b[^;|&]*of=\/dev\//, 'dd of=/dev/ 直接写入设备文件']
]

/**
 * 破坏性命令检测。命中返回 { destructive: true, reason }；未命中 reason 为 undefined。
 * 只读模式下的底线拒绝不在本层（由权限策略按写能力禁用处理）。
 */
export function detectDestructiveCommand(command: string): DestructiveWarning {
  const tokens = tokenizeCommand(command)
  if (tokens === undefined) {
    for (const [pattern, reason] of COMPOUND_PATTERNS) {
      if (pattern.test(command)) return { destructive: true, reason }
    }
    return { destructive: false }
  }
  if (tokens.length === 0) return { destructive: false }
  const program = tokens[0]
  const args = tokens.slice(1)
  const reason = program === 'git' ? gitDestructive(args) : filesystemDestructive(program, args)
  return reason === undefined ? { destructive: false } : { destructive: true, reason }
}