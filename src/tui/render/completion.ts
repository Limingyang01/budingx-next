// Completion candidates for @ paths and / commands (SP003 design §3.7,
// AC FC-01 … FC-03). Pure functions only: the host supplies the file list
// (walked with our ignore rules) and the command registry, so filtering,
// ordering and the one-at-a-time directory extension are testable without
// a terminal.
export type CompletionKind = 'file' | 'command'

export type CompletionCandidate = {
  /** Text inserted when the candidate is picked (forward slashes). */
  value: string
  kind: CompletionKind
  directory: boolean
}

export type ActiveToken = {
  kind: CompletionKind
  /** Token text after @ or /, as typed. */
  token: string
  /** Line column where the token starts (including the sigil). */
  start: number
  /** Length of the whole token including the sigil. */
  length: number
  quoted?: boolean
}

const MAX_CANDIDATES = 5

/**
 * Inspect the text before the cursor and decide whether an active
 * completion token exists. A `/command` token only counts at line start;
 * `@path` counts anywhere. The cursor may be at the end of the token.
 */
export function activeToken(
  line: string,
  cursorColumn: number,
  commands: string[]
): ActiveToken | null {
  const characters = Array.from(line)
  const before = characters.slice(0, cursorColumn).join('')
  const after = characters.slice(cursorColumn).join('')
  const commandMatch = /^\/([^\s]*)$/.exec(before)
  if (commandMatch && commands.length > 0) {
    const token = commandMatch[1]
    if (commands.some((command) => command.startsWith(token))) {
      return { kind: 'command', token, start: 0, length: token.length + 1 }
    }
  }
  const quoted = /(?:^|[\s('=])@"([^"]*)$/.exec(before)
  if (quoted) {
    const token = quoted[1]
    const typedLength = Array.from(token).length + 2
    const suffix = /^[^"]*"/.exec(after)?.[0] ?? ''
    return {
      kind: 'file',
      token,
      start: cursorColumn - typedLength,
      length: typedLength + Array.from(suffix).length,
      quoted: true
    }
  }
  const fileMatch = /(?:^|[\s("'=])@([^\s"'(),;]*)$/.exec(before)
  if (fileMatch) {
    const token = fileMatch[1] ?? ''
    const typedLength = Array.from(token).length + 1
    const start = cursorColumn - typedLength
    const suffix = /^[^\s"'(),;#]*/.exec(after)?.[0] ?? ''
    return { kind: 'file', token, start, length: typedLength + Array.from(suffix).length }
  }
  return null
}

export function commandCandidates(token: string, commands: string[]): CompletionCandidate[] {
  // 0.5.4：/ 唤起全部命令（不再截断为 5 条），由 UI 做滚动窗口。
  return commands
    .filter((command) => command.startsWith(token))
    .map((command) => ({ value: command, kind: 'command' as const, directory: false }))
}

const COMMAND_DESCRIPTIONS: Record<string, { zh: string; en: string }> = {
  help: { zh: '显示帮助与技能命令', en: 'show help & skill commands' },
  models: { zh: '管理模型档案', en: 'manage model profiles' },
  permissions: { zh: '权限白名单/规则面板', en: 'permission rules panel' },
  rules: { zh: '权限规则面板', en: 'permission rules panel' },
  diff: { zh: '查看未提交/会话改动', en: 'view uncommitted changes' },
  undo: { zh: '撤销最近文件改动', en: 'undo latest file changes' },
  rewind: { zh: '回滚对话+文件到检查点', en: 'rewind conversation+files' },
  denials: { zh: '查看拒绝历史', en: 'show denial history' },
  clear: { zh: '清空会话', en: 'clear conversation' },
  new: { zh: '清空会话（同 /clear）', en: 'clear conversation' },
  reset: { zh: '清空会话（同 /clear）', en: 'clear conversation' },
  resume: { zh: '恢复会话（当前工作区）', en: 'resume a session' },
  continue: { zh: '恢复最近会话', en: 'resume latest session' },
  sessions: { zh: '列出已保存会话', en: 'list saved sessions' },
  context: { zh: '上下文占用网格', en: 'context usage grid' },
  compact: { zh: '手动压缩历史', en: 'compact history' },
  cost: { zh: '累计 token 与费用', en: 'tokens & cost' },
  usage: { zh: '累计 token 与费用', en: 'tokens & cost' },
  plan: { zh: '规划模式（只读）', en: 'plan mode (read-only)' },
  memory: { zh: '项目/会话记忆', en: 'project/session memory' },
  effort: { zh: '思考强度', en: 'reasoning effort' },
  exit: { zh: '退出', en: 'exit' },
  quit: { zh: '退出', en: 'exit' },
  // 验收期补全（用户 m02582）：菜单里每个注册命令与别名都要有中英文短描述。
  config: { zh: '端点/模型/密钥掩码', en: 'endpoint, model & key mask' },
  model: { zh: '查看或切换模型', en: 'view or switch model' },
  permission: { zh: '查看或切换权限模式', en: 'view or switch permission mode' },
  'allowed-tools': { zh: '权限白名单面板', en: 'permission rules panel' },
  init: { zh: '生成项目指令骨架', en: 'generate AGENTS.md scaffold' },
  btw: { zh: '旁路提问（不入上下文）', en: 'side question, keeps context' },
  worktree: { zh: '管理隔离工作树', en: 'manage isolated worktrees' },
  tasks: { zh: '后台任务与子代理', en: 'background tasks & subagents' },
  mcp: { zh: 'MCP 服务器与工具', en: 'MCP servers & tools' },
  skills: { zh: '查看已发现技能', en: 'list discovered skills' },
  export: { zh: '导出会话记录', en: 'export session transcript' },
  agents: { zh: '管理子代理', en: 'manage subagents' },
  agent: { zh: '派发子代理任务', en: 'dispatch a subagent task' },
  status: { zh: '会话状态与配置来源', en: 'session status & config sources' },
  stats: { zh: '用量统计', en: 'usage statistics' },
  doctor: { zh: '安装与配置诊断', en: 'installation & config diagnostics' },
  image: { zh: '挂载图片附件', en: 'attach an image' }
}

export function commandDescription(name: string, lang: 'zh' | 'en'): string {
  return COMMAND_DESCRIPTIONS[name]?.[lang] ?? ''
}

/**
 * File candidates with directory extension: for a token like `src/` we
 * list the next path segments inside src (directories end with `/`);
 * without a slash we filter on the last segment so `src/re` suggests
 * `src/readme.md`. Order follows the host-provided (already sorted,
 * already ignore-filtered) file list; duplicates collapse.
 */
export function fileCandidates(token: string, files: string[]): CompletionCandidate[] {
  const slash = token.lastIndexOf('/')
  const base = slash >= 0 ? token.slice(0, slash + 1) : ''
  const stem = slash >= 0 ? token.slice(slash + 1) : token
  const seen = new Map<string, CompletionCandidate>()
  const lowerStem = stem.toLowerCase()
  for (const file of files) {
    if (!file.startsWith(base)) continue
    const rest = file.slice(base.length)
    const nextSlash = rest.indexOf('/')
    if (nextSlash === -1) {
      // A file directly under the base.
      if (!rest.toLowerCase().startsWith(lowerStem)) continue
      if (!seen.has(base + rest)) seen.set(base + rest, { value: base + rest, kind: 'file', directory: false })
    } else {
      const directoryName = rest.slice(0, nextSlash)
      const key = base + directoryName + '/'
      if (!lowerStem || directoryName.toLowerCase().startsWith(lowerStem)) {
        if (!seen.has(key)) seen.set(key, { value: key, kind: 'file', directory: true })
      } else {
        // Also keep matching files deeper when the stem spans the directory,
        // e.g. token "src/a" should still find "src/a.ts" handled above;
        // anything else is skipped to keep the list cheap.
        continue
      }
    }
    if (seen.size >= MAX_CANDIDATES * 4) break
  }
  const preferred = [...seen.values()].slice(0, MAX_CANDIDATES)
  if (!lowerStem || preferred.length >= MAX_CANDIDATES) return preferred

  const fuzzy = files
    .flatMap((value) => {
      if (!value.startsWith(base) || seen.has(value)) return []
      const name = value.split('/').at(-1)?.toLowerCase() ?? ''
      let position = -1
      let first = -1
      for (const character of lowerStem) {
        position = name.indexOf(character, position + 1)
        if (position < 0) return []
        if (first < 0) first = position
      }
      const score = first + (position - first - lowerStem.length + 1) * 2
      return [{ value, score }]
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_CANDIDATES - preferred.length)
    .map(({ value }): CompletionCandidate => ({ value, kind: 'file', directory: false }))
  return [...preferred, ...fuzzy]
}

/**
 * Longest common prefix of the candidate values. The reference completes
 * to the LCP first (Tab keeps narrowing) before applying a single pick;
 * we implement the same rule (SP003 T18e).
 */
export function longestCommonPrefix(values: string[]): string {
  if (values.length === 0) return ''
  if (values.length === 1) return values[0]
  let prefix = values[0]
  for (const value of values.slice(1)) {
    let length = 0
    while (length < prefix.length && length < value.length && prefix[length] === value[length])
      length++
    prefix = prefix.slice(0, length)
    if (!prefix) break
  }
  return prefix
}

/** Replace the active token with the chosen candidate value. */
export function applyCompletion(
  line: string,
  token: ActiveToken,
  candidate: CompletionCandidate,
  partial = false
): string {
  const characters = Array.from(line)
  const quotes = token.kind === 'file' && (token.quoted || /[\s,;:()#@]/.test(candidate.value))
  const inserted = token.kind === 'command'
    ? '/' + candidate.value
    : '@' + (quotes ? '"' : '') + candidate.value +
      (quotes && !candidate.directory && !partial ? '"' : '')
  const before = characters.slice(0, token.start)
  const after = characters.slice(token.start + token.length)
  return before.join('') + inserted + after.join('')
}
