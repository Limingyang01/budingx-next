// /worktree 命令使用宿主的工作区切换与单次审批。
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  enterWorktree,
  exitWorktree,
  getWorktreeBranch,
  listWorktrees,
  mergeWorktree,
  prepareWorktreeMerge,
  prepareWorktreeRemoval,
  realPathOf,
  resolveWorktreeSession,
  type WorktreeEntry,
  type WorktreeSession
} from '../git/worktree.js'

export { listWorktrees, parseWorktreeList, type WorktreeEntry } from '../git/worktree.js'

export type WorktreeCommandOptions = {
  cwd: string
  root?: string
  home?: string
  origin?: { cwd: string; branch: string }
  enter?: (binding: WorktreeSession) => Promise<void>
  exit?: () => Promise<void>
  confirm?: (request: { summary: string; preview: string[] }) => Promise<boolean>
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
  const path = realPathOf(resolve(cwd, target))
  const exact = entries.find((entry) => entry.branch === target || (path && realPathOf(entry.path) === path))
  if (exact) return exact
  const matches = entries.filter((entry) => basename(entry.path) === target)
  if (matches.length > 1) throw new Error(`工作树名称不唯一，请指定路径或分支：${target}`)
  return matches[0]
}

function containsWorkingDirectory(path: string, cwd: string): boolean {
  const realPath = realPathOf(path)
  const realCwd = realPathOf(cwd)
  if (!realPath || !realCwd) return false
  const subpath = relative(realPath, realCwd)
  return subpath !== '..' && !subpath.startsWith('..' + sep) && !isAbsolute(subpath)
}

export async function runWorktreeCommand(
  args: string,
  options: WorktreeCommandOptions,
  lang: 'zh' | 'en' = 'zh'
): Promise<{ ok: boolean; text: string }> {
  const [command, argument = ''] = args.trim().match(/^(\S+)(?:\s+([\s\S]+))?$/)?.slice(1) ?? []
  const action = command ?? 'list'
  const en = lang === 'en'
  const originCwd = options.origin?.cwd ?? options.cwd
  try {
    if (action === 'list' || action === 'ls') {
      return { ok: true, text: formatWorktreeList(await listWorktrees(options.cwd), lang) }
    }
    if (action === 'create' || action === 'add') {
      if (!argument) return { ok: false, text: en ? 'Usage: /worktree create <name>' : '用法：/worktree create <名称>' }
      if (options.origin && await getWorktreeBranch(originCwd) !== options.origin.branch) {
        throw new Error(en ? `Switch the origin back to ${options.origin.branch} first.` : `请先将来源工作区切回绑定分支 ${options.origin.branch}。`)
      }
      const created = await enterWorktree({
        cwd: originCwd,
        name: argument,
        ...(options.root ? { root: options.root } : {}),
        ...(options.home ? { home: options.home } : {})
      })
      return {
        ok: true,
        text:
          (en ? 'Created worktree: ' : '已创建 worktree：') +
          `${created.path}\n  分支 ${created.branch}（基于 ${created.baseBranch}）`
      }
    }
    if (action === 'exit' && !argument) {
      if (!options.exit) throw new Error(en ? 'This host cannot switch the working directory.' : '当前宿主不支持切换工作目录。')
      await options.exit()
      return { ok: true, text: en ? 'Returned to the origin worktree.' : '已返回来源工作区。' }
    }
    if ((action === 'enter' || action === 'merge') && argument) {
      const origin = options.origin
      if (!origin) throw new Error(en ? 'The session has no bound Git origin branch.' : '本会话没有绑定 Git 来源分支。')
      const binding = await resolveWorktreeSession({ ...options, ...origin, name: argument, baseBranch: origin.branch })
      if (action === 'enter') {
        if (!options.enter) throw new Error(en ? 'This host cannot switch the working directory.' : '当前宿主不支持切换工作目录。')
        await options.enter(binding)
        return { ok: true, text: (en ? 'Entered worktree: ' : '已进入 worktree：') + binding.path }
      }
      if (!options.confirm) throw new Error(en ? 'Merge requires explicit confirmation.' : '合并需要宿主明确确认。')
      const plan = await prepareWorktreeMerge(binding)
      const { source, target } = plan
      const summary = (en ? 'Merge worktree ' : '合并 worktree ') + `${source.branch} → ${target.branch}`
      const preview = [
        (en ? 'Source: ' : '源：') + `${source.branch} @ ${source.head}\n${source.path}`,
        (en ? 'Target: ' : '目标：') + `${target.branch} @ ${target.head}\n${target.path}`
      ]
      if (!await options.confirm({ summary, preview })) {
        return { ok: false, text: en ? 'Merge cancelled.' : '已取消合并。' }
      }
      await mergeWorktree(binding, plan)
      return { ok: true, text: (en ? 'Merged ' : '已合并 ') + `${source.branch} → ${target.branch}` }
    }
    if (action === 'remove' || action === 'rm') {
      const discard = /\s+--discard$/.test(argument)
      const target = argument.replace(/\s+--discard$/, '').replace(/^(['"])(.*)\1$/, '$2')
      if (!target || target === '--discard') return { ok: false, text: en ? 'Usage: /worktree remove <path|branch> [--discard]' : '用法：/worktree remove <路径|分支> [--discard]' }
      const entry = await findEntry(originCwd, target)
      if (!entry) return { ok: false, text: (en ? 'Worktree not found: ' : '找不到 worktree：') + target }
      if (!entry.branch) {
        return { ok: false, text: en ? 'Cannot remove a worktree without a branch.' : '没有专用分支的 worktree 不能由本命令删除。' }
      }
      if (containsWorkingDirectory(entry.path, options.cwd) || containsWorkingDirectory(entry.path, originCwd)) {
        throw new Error(en ? 'Exit the active worktree before removing it.' : '删除前须先退出当前工作树。')
      }
      if (!options.confirm) {
        return { ok: false, text: en ? 'Removal needs explicit host confirmation.' : '删除需要宿主明确确认。' }
      }
      const baseBranch = options.origin?.branch ?? await getWorktreeBranch(originCwd)
      if (!baseBranch) throw new Error(en ? 'Removal needs a bound origin branch.' : '删除需要绑定来源分支。')
      const session: WorktreeSession = { path: entry.path, branch: entry.branch, baseBranch, originalCwd: originCwd }
      const snapshot = await prepareWorktreeRemoval(session)
      const residue = en
        ? `${snapshot.discardedFiles} pending files, ${snapshot.discardedCommits} unmerged commits.`
        : `未提交文件 ${snapshot.discardedFiles} 个、未合并提交 ${snapshot.discardedCommits} 个。`
      if (!discard && (snapshot.discardedFiles > 0 || snapshot.discardedCommits > 0)) {
        throw new Error(residue + (en ? ' Use --discard to request explicit approval to discard them.' : '须加 --discard 并明确批准弃置。'))
      }
      const summary =
        (en ? 'Remove worktree ' : '删除 worktree ') + entry.path + (discard ? '（--discard）' : '')
      const preview = [
        (en ? 'Path: ' : '路径：') + entry.path,
        (en ? 'Branch: ' : '分支：') + `${entry.branch} @ ${snapshot.source.head}`,
        (en ? 'Base: ' : '基准：') + `${baseBranch} @ ${snapshot.baseHead}`,
        residue,
        ...(discard ? [en ? 'Remove and discard the listed changes.' : '删除并丢弃上述改动。'] : [])
      ]
      const approved = await options.confirm({ summary, preview })
      if (!approved) return { ok: false, text: en ? 'Cancelled.' : '已取消删除。' }
      const removed = await exitWorktree({
        ...session,
        action: 'remove',
        discard_changes: discard,
        authorization: {
          id: 'command-' + Date.now(),
          worktree: entry.path,
          branch: entry.branch,
          discardChanges: discard,
          snapshot
        }
      })
      return {
        ok: true,
        text:
          (en ? 'Removed worktree: ' : '已删除 worktree：') +
          `${removed.path}\n  丢弃文件 ${removed.discardedFiles ?? 0} 个、提交 ${removed.discardedCommits ?? 0} 个`
      }
    }
    return {
      ok: false,
      text: en
        ? 'Usage: /worktree [list|create <name>|enter <name>|exit|merge <name>|remove <path|branch> [--discard]]'
        : '用法：/worktree [list|create <名称>|enter <名称>|exit|merge <名称>|remove <路径|分支> [--discard]]'
    }
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) }
  }
}
