// SP004 T2 · 结构化命令族判定（设计 §4.3 / §4.5 / §4.6）。
// 只读豁免仅来自固定白名单：逐参数校验，未知参数、复合语句与不透明目标一律不豁免。
// 本模块只做纯文本判定，不执行任何命令。

const COMPOUND_CHARS = new Set([';', '&', '|', '>', '<', '`', '(', ')', '\n', '\r'])

/**
 * 引号感知分词。遇到复合语句元字符（; & | > < ` $( ) 换行）或不闭合引号时返回 undefined，
 * 表示命令不透明，调用方不得给予任何豁免。
 */
export function tokenizeCommand(command: string): string[] | undefined {
  const tokens: string[] = []
  let current = ''
  let hasToken = false
  let quote: 'none' | 'single' | 'double' = 'none'
  const push = () => {
    if (hasToken) tokens.push(current)
    current = ''
    hasToken = false
  }
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i]
    const next = command[i + 1]
    if (quote === 'single') {
      if (c === "'") quote = 'none'
      else current += c
      hasToken = true
      continue
    }
    if (quote === 'double') {
      if (c === '"') {
        quote = 'none'
        continue
      }
      if (c === '`' || (c === '$' && next === '(')) return undefined
      if (c === '\\' && next !== undefined && '$`"\\'.includes(next)) {
        current += next
        i += 1
        continue
      }
      current += c
      continue
    }
    if (c === '$' && next === '(') return undefined
    if (COMPOUND_CHARS.has(c)) return undefined
    if (c === ' ' || c === '\t') {
      push()
      continue
    }
    if (c === '\\' && next !== undefined) {
      current += next
      i += 1
      hasToken = true
      continue
    }
    if (c === "'") {
      quote = 'single'
      hasToken = true
      continue
    }
    if (c === '"') {
      quote = 'double'
      hasToken = true
      continue
    }
    current += c
    hasToken = true
  }
  if (quote !== 'none') return undefined
  push()
  return tokens
}

function isPathToken(token: string): boolean {
  return !token.startsWith('-')
}

function flagsOnly(args: string[], allowed: ReadonlySet<string>, numeric = false): boolean {
  return args.every((token) => {
    if (!token.startsWith('-')) return true
    if (allowed.has(token)) return true
    if (numeric && /^-\d+$/.test(token)) return true
    return false
  })
}

function gitReadOnly(args: string[]): boolean {
  if (args.length === 1 && args[0] === '--version') return true
  const sub = args[0]
  const rest = args.slice(1)
  switch (sub) {
    case 'status':
      return flagsOnly(rest, new Set(['--porcelain', '--short', '-s', '--branch', '-b', '--no-renames', '--ignore-submodules']))
    case 'log':
      return flagsOnly(rest, new Set(['--oneline', '--stat', '-p', '--graph', '--decorate', '--no-decorate', '--all', '--no-color']), true)
    case 'diff':
      return flagsOnly(rest, new Set(['--stat', '--cached', '--staged', '--name-only', '--name-status', '-p', '--no-color', '--no-ext-diff']))
    case 'show':
      return flagsOnly(rest, new Set(['--stat', '--name-only', '--oneline', '--no-color']))
    case 'rev-parse':
      return flagsOnly(rest, new Set(['--abbrev-ref', '--verify', '--short', '--symbolic-full-name', '--git-dir', '--absolute-git-dir', '--show-toplevel', '--is-inside-work-tree']))
    case 'branch': {
      // 裸 `git branch <name>` 会创建分支（写操作）；仅列表形态豁免。
      const writeFlags = new Set(['-d', '-D', '-m', '-M', '-c', '-C', '-u', '-f', '--delete', '--move', '--copy', '--force', '--set-upstream', '--set-upstream-to', '--unset-upstream'])
      if (rest.some((token) => writeFlags.has(token))) return false
      const listFlags = new Set(['--list', '-l', '--all', '-a', '--verbose', '-v', '--show-current', '--no-color'])
      if (!flagsOnly(rest, listFlags)) return false
      const hasPattern = rest.some(isPathToken)
      const hasListFlag = rest.some((token) => ['--list', '-l', '--all', '-a'].includes(token))
      return !hasPattern || hasListFlag
    }
    case 'remote':
      return rest.length === 0 || (rest.length === 1 && (rest[0] === '-v' || rest[0] === '--verbose'))
    default:
      return false
  }
}

function headTailReadOnly(args: string[]): boolean {
  let paths = 0
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (/^-\d+$/.test(token)) continue
    if (token === '-n' || token === '-c') {
      const value = args[i + 1]
      if (value === undefined || !/^\d+$/.test(value)) return false
      i += 1
      continue
    }
    if (token.startsWith('-')) return false
    paths += 1
  }
  return paths > 0
}

/**
 * 只读命令判定。command 为 shell 文本；argv 为结构化参数形式（二者取一，argv 优先）。
 * 只有白名单内的固定调用返回 true；其余一律 false（需要正常审批）。
 */
export function isReadOnlyCommand(command: string, argv?: readonly string[]): boolean {
  let tokens: string[] | undefined
  if (argv !== undefined && argv.length > 0) {
    tokens = [...argv]
    if (tokens.some((token) => /[;&|><`()\n\r]/.test(token) || token.includes('$('))) return false
  } else {
    tokens = tokenizeCommand(command)
  }
  if (tokens === undefined || tokens.length === 0) return false
  const program = tokens[0]
  const rest = tokens.slice(1)
  switch (program) {
    case 'git':
      return gitReadOnly(rest)
    case 'ls':
      return rest.every((token) => /^-[lahtSr1AdF]+$/.test(token) || isPathToken(token))
    case 'dir':
      return rest.every((token) => ['/w', '/b'].includes(token.toLowerCase()) || !token.startsWith('/'))
    case 'cat':
      return rest.length > 0 && rest.every(isPathToken)
    case 'head':
    case 'tail':
      return headTailReadOnly(rest)
    case 'wc':
      return rest.some(isPathToken) && flagsOnly(rest, new Set(['-l', '-w', '-c']))
    case 'pwd':
      return rest.length === 0
    case 'echo':
      return true
    case 'which':
    case 'where':
      return rest.length > 0 && rest.every(isPathToken)
    case 'node':
    case 'npm':
    case 'python':
    case 'python3':
      return rest.length === 1 && (rest[0] === '--version' || rest[0] === '-v')
    default:
      return false
  }
}

const BLOCKING_WAIT_PROGRAMS = new Set(['sleep', 'ping', 'timeout', 'wait', 'start-sleep'])

/** 阻塞等待族：首命令为 sleep/ping/timeout/wait/Start-Sleep 时拦截并引导后台执行。 */
export function isBlockingWaitCommand(command: string): boolean {
  const tokens = tokenizeCommand(command)
  if (tokens === undefined || tokens.length === 0) return false
  return BLOCKING_WAIT_PROGRAMS.has(tokens[0].toLowerCase())
}

const INTERACTIVE_PROGRAMS = new Set(['vim', 'vi', 'nano', 'emacs', 'less', 'more', 'top', 'htop', 'ssh', 'psql', 'mysql'])

/** 交互式族：需要 TTY 的命令明确失败，不挂起；python 无 -c 视为交互式。 */
export function isInteractiveCommand(command: string): boolean {
  const tokens = tokenizeCommand(command)
  if (tokens === undefined || tokens.length === 0) return false
  const program = tokens[0].toLowerCase()
  if (INTERACTIVE_PROGRAMS.has(program)) return true
  if (program === 'python' || program === 'python3') return !tokens.includes('-c')
  return false
}