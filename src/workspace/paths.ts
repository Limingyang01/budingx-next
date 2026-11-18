// Workspace path resolution and boundary checks (SP003 design §3.4).
// The workspace root is the real path of the process working directory.
// Every path that reaches a file tool is resolved here first: relative
// segments are normalised, the real path (symlinks and Windows junctions
// resolved) is compared against the root, and anything outside is refused
// before a single byte is read or written.
import { existsSync, realpathSync, statSync } from 'node:fs'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from 'node:path'
import { ERROR_CODES } from '../core/constants.js'

export class WorkspaceError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'WorkspaceError'
  }
}

export type ResolvedPath = {
  /** Normalised absolute path (symlinks not resolved). */
  absolute: string
  /** Path relative to the workspace root, always with forward slashes. */
  relative: string
  /** Real path: symlinks and Windows junctions resolved. */
  real: string
  /** Whether the target exists on disk. */
  existed: boolean
  /** Whether the existing target is a directory. */
  isDirectory: boolean
}

export type Workspace = {
  /** Real path of the workspace root. */
  root: string
  /** Resolve a user or model supplied path inside the workspace. */
  resolve(input: string): ResolvedPath
  /** Whether a real path is inside the workspace root. */
  isInside(realPath: string): boolean
  /** Real path of an existing path, or undefined when it does not exist. */
  realOf(target: string): string | undefined
}

const caseInsensitive = process.platform === 'win32'

function comparable(target: string): string {
  const normalized = resolve(target)
  return caseInsensitive ? normalized.toLowerCase() : normalized
}

/** True when `target` is the root itself or a descendant of it. */
export function isInsideRoot(root: string, target: string): boolean {
  const rootKey = comparable(root)
  const targetKey = comparable(target)
  if (targetKey === rootKey) return true
  return targetKey.startsWith(rootKey.endsWith(sep) ? rootKey : rootKey + sep)
}

/** The real path of an existing path, or undefined when it does not exist. */
export function realPathOf(target: string): string | undefined {
  try {
    if (!existsSync(target)) return undefined
    return realpathSync(target)
  } catch {
    return undefined
  }
}

export function createWorkspace(root: string): Workspace {
  const rootAbsolute = resolve(root)
  const rootReal = realPathOf(rootAbsolute) ?? rootAbsolute

  const workspace: Workspace = {
    root: rootReal,
    realOf: realPathOf,
    isInside(realPath: string): boolean {
      return isInsideRoot(rootReal, realPath)
    },
    resolve(input: string): ResolvedPath {
      const raw = (input ?? '').trim()
      if (!raw) {
        throw new WorkspaceError(ERROR_CODES.workspaceNotFound, 'Path is empty')
      }
      const absolute = isAbsolute(raw) ? resolve(raw) : resolve(rootReal, raw)
      const existed = existsSync(absolute)
      let real: string
      let isDirectory = false
      if (existed) {
        real = realpathSync(absolute)
        try {
          isDirectory = statSync(real).isDirectory()
        } catch {
          isDirectory = false
        }
      } else {
        // Walk past missing parents before resolving the physical ancestor.
        let parent = dirname(absolute)
        const missing = [basename(absolute)]
        let parentReal = realPathOf(parent)
        while (!parentReal && parent !== dirname(parent)) {
          missing.unshift(basename(parent))
          parent = dirname(parent)
          parentReal = realPathOf(parent)
        }
        real = join(parentReal ?? parent, ...missing)
      }
      if (!workspace.isInside(real)) {
        throw new WorkspaceError(
          ERROR_CODES.workspacePathOutside,
          `Path is outside the workspace: ${raw}`
        )
      }
      const relativePath = relative(rootReal, real)
      return {
        absolute,
        relative: relativePath.split(sep).join('/'),
        real,
        existed,
        isDirectory
      }
    }
  }
  return workspace
}
