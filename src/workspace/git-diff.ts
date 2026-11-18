
import { isUtf8 } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import type { ChangeDiff } from './checkpoint.js'
import { diffLines } from './diff.js'
import type { Workspace } from './paths.js'

const MAX_GIT_FILES = 100
const MAX_GIT_FILE_BYTES = 256 * 1024

function git(workspace: Workspace, args: string[], maxBuffer = 1024 * 1024): Buffer | undefined {
  try {
    return execFileSync('git', ['--no-optional-locks', ...args], {
      cwd: workspace.root,
      maxBuffer,
      timeout: 2000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch {
    return undefined
  }
}

export function hasGitWorkspace(workspace: Workspace): boolean {
  return git(workspace, ['rev-parse', '--is-inside-work-tree'])?.toString('utf8').trim() === 'true'
}

export function gitWorkspaceChanges(
  workspace: Workspace,
  exclude: (path: string) => boolean
): { files: ChangeDiff[]; skipped: number; incomplete: boolean } {
  const hasHead = git(workspace, ['rev-parse', '--verify', 'HEAD']) !== undefined
  const tracked = hasHead
    ? git(workspace, [
        'diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv',
        '--relative', 'HEAD', '--', '.'
      ])
    : git(workspace, ['ls-files', '-z', '--cached', '--', '.'])
  const untracked = git(workspace, ['ls-files', '-z', '--others', '--exclude-standard', '--', '.'])
  const decodePaths = (output?: Buffer) => output?.toString('utf8').split('\0').filter(Boolean) ?? []
  const trackedPaths = new Set(decodePaths(tracked))
  const paths = [...new Set([...trackedPaths, ...decodePaths(untracked)])]
  const files: ChangeDiff[] = []
  let skipped = 0
  for (const path of paths.slice(0, MAX_GIT_FILES)) {
    try {
      const target = workspace.resolve(path)
      if (target.real !== target.absolute || exclude(path)) continue
      const before = hasHead && trackedPaths.has(path)
        ? git(workspace, ['cat-file', 'blob', 'HEAD:./' + path], MAX_GIT_FILE_BYTES)
        : undefined
      if (hasHead && trackedPaths.has(path) && before === undefined) {
        // A baseline may be absent for staged additions or too large to read.
        const objectType = git(workspace, ['cat-file', '-t', 'HEAD:./' + path])
        if (objectType) {
          skipped++
          continue
        }
      }

      const metadata = target.existed ? statSync(target.real) : undefined
      if (metadata && (!metadata.isFile() || metadata.size > MAX_GIT_FILE_BYTES)) {
        skipped++
        continue
      }
      const after = metadata ? readFileSync(target.real) : undefined
      if ([before, after].some((bytes) => bytes && (!isUtf8(bytes) || bytes.includes(0)))) {
        skipped++
        continue
      }
      if (before?.toString('utf8') === after?.toString('utf8')) continue
      files.push({
        path,
        operation: before === undefined ? 'create' : after === undefined ? 'delete' : 'update',
        hunks: diffLines(before?.toString('utf8') ?? '', after?.toString('utf8') ?? '')
      })
    } catch {
      skipped++
    }
  }
  return { files, skipped: skipped + Math.max(0, paths.length - MAX_GIT_FILES), incomplete: !tracked || !untracked }
}
