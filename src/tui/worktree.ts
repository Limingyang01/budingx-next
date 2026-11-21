// SP006 §6.3 /worktree：列出/创建/移除隔离工作树（CMD-07）。
// 复用 SP004 的安全边界：删除必须由宿主确认后生成单次授权，且残留需显式丢弃。
import { execFile } from 'node:child_process'
import { enterWorktree, exitWorktree, type WorktreeSession } from '../git/worktree.js'

export type WorktreeEntry = {
  path: string
  head?: string
  branch?: string
  detached?: boolean
  bare?: boolean
}

export type WorktreeCommandOptions = {
  cwd: string
  root?: string
  home?: string
  confirm?: (request: { summary: string; preview: string[] }) => Promise<boolean>
}

type GitResult = { ok: boolean; stdout: string; stderr: string }

function runGit(args: string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        resolve({
          ok: error === null,
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : error?.message ?? ''
        })
      }
    )
  })
}

/** 解析 `git worktree list --porcelain`，保持 git 的输出顺序。 */
export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let current: WorktreeEntry | undefined
  for (const line of output.split(/\r?\n/)) {
    if (line === '') {
      if (current) entries.push(current)
      current = undefined
      continue
    }
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current)
      current = { path: line.slice('worktree '.length) }
      continue
    }
    if (!current) continue
    if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length)
    else if (line.startsWith('branch ')) current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    else if (line === 'detached') current.detached = true
    else if (line === 'bare') current.bare = true
  }
  if (current) entries.push(current)
  return entries
}

export async function listWorktrees(cwd: string): Promise<WorktreeEntry[]> {
  const result = await runGit(['worktree', 'list', '--porcelain'], cwd)
  if (!result.ok) throw new Error(`无法列出 worktree：${result.stderr.trim() || 'git 失败'}`)
  return parseWorktreeList(result.stdout)
}

export function formatWorktreeList(entries: WorktreeEntry[], lang: 'zh' | 'en' = 'zh'): string {
  if (entries.length === 0) return lang === 'en' ? 'No worktrees.' : '没有 worktree。'
  const lines = entries.map((entry, index) => {
    const branch = entry.branch ? `分支 ${entry.branch}` : entry.detached ? '分离 HEAD' : '无分支'
    const marker = index === 0 ? (lang === 'en' ? ' (main)' : '（主工作区）') : ''
    return `${entry.path} · ${branch}${marker}`
  })
  return [lang === 'en' ? `${entries.length} worktree(s):` : `共 ${entries.length} 个 worktree：`, ...lines].join('\n')
}

async function findEntry(cwd: string, target: string): Promise<WorktreeEntry | undefined> {
  const entries = await listWorktrees(cwd)
  return entries.find((entry) => entry.path === target || entry.branch === target || entry.path.endsWith('/' + target))
}

export async function runWorktreeCommand(
  args: string,
  options: WorktreeCommandOptions,
  lang: 'zh' | 'en' = 'zh'
): Promise<{ ok: boolean; text: string }> {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const action = tokens[0] ?? 'list'
  try {
    if (action === 'list' || action === 'ls') {
      return { ok: true, text: formatWorktreeList(await listWorktrees(options.cwd), lang) }
    }
    if (action === 'create' || action === 'add') {
      const name = tokens[1]
      if (!name) return { ok: false, text: lang === 'en' ? 'Usage: /worktree create <name>' : '用法：/worktree create <名称>' }
      const created = await enterWorktree({
        cwd: options.cwd,
        name,
        ...(options.root ? { root: options.root } : {}),
        ...(options.home ? { home: options.home } : {})
      })
      return {
        ok: true,
        text:
          (lang === 'en' ? 'Created worktree: ' : '已创建 worktree：') +
          `${created.path}\n  分支 ${created.branch}（基于 ${created.baseBranch}）`
      }
    }
    if (action === 'remove' || action === 'rm') {
      const target = tokens[1]
      if (!target) return { ok: false, text: lang === 'en' ? 'Usage: /worktree remove <path|branch> [--discard]' : '用法：/worktree remove <路径|分支> [--discard]' }
      const discard = tokens.includes('--discard')
      const entry = await findEntry(options.cwd, target)
      if (!entry) return { ok: false, text: (lang === 'en' ? 'Worktree not found: ' : '找不到 worktree：') + target }
      if (!entry.branch) {
        return { ok: false, text: lang === 'en' ? 'Cannot remove a worktree without a branch.' : '没有专用分支的 worktree 不能由本命令删除。' }
      }
      const summary =
        (lang === 'en' ? 'Remove worktree ' : '删除 worktree ') + entry.path + (discard ? '（--discard）' : '')
      const preview = [
        (lang === 'en' ? 'Path: ' : '路径：') + entry.path,
        (lang === 'en' ? 'Branch: ' : '分支：') + entry.branch,
        discard
          ? lang === 'en'
            ? 'Uncommitted files and unmerged commits will be discarded.'
            : '将丢弃未提交文件与未合并提交。'
          : lang === 'en'
            ? 'If residue exists, removal is refused unless --discard is given.'
            : '存在残留时，未加 --discard 将拒绝删除。'
      ]
      if (!options.confirm) {
        return { ok: false, text: lang === 'en' ? 'Removal needs explicit host confirmation; no confirmation channel is available.' : '删除需要宿主确认，但当前没有可用的确认通道，已取消。' }
      }
      const approved = await options.confirm({ summary, preview })
      if (!approved) return { ok: false, text: lang === 'en' ? 'Cancelled.' : '已取消删除。' }
      const baseBranch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], options.cwd)).stdout.trim() || 'HEAD'
      const session: WorktreeSession = {
        path: entry.path,
        branch: entry.branch,
        baseBranch,
        originalCwd: options.cwd
      }
      const removed = await exitWorktree({
        ...session,
        action: 'remove',
        discard_changes: discard,
        authorization: {
          id: 'command-' + Date.now(),
          worktree: entry.path,
          branch: entry.branch,
          discardChanges: discard
        }
      })
      return {
        ok: true,
        text:
          (lang === 'en' ? 'Removed worktree: ' : '已删除 worktree：') +
          `${removed.path}\n  丢弃文件 ${removed.discardedFiles ?? 0} 个、提交 ${removed.discardedCommits ?? 0} 个`
      }
    }
    return {
      ok: false,
      text: (lang === 'en' ? 'Usage: /worktree [list|create <name>|remove <path> [--discard]]' : '用法：/worktree [list|create <名称>|remove <路径> [--discard]]')
    }
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) }
  }
}
