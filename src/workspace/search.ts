// Glob and Grep over the workspace (SP003 design §3.4/§3.5, AC WT-09/WT-10/WT-13).
// Recursion is depth-first with stable ordering, bounded by hard caps, and
// honours the ignore matcher; results are truncated with a count summary so
// the model always knows what it is seeing.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { ERROR_CODES } from '../core/constants.js'
import { MAX_SEARCH_RESULTS, MAX_WALK_FILES } from './constants.js'
import { createIgnoreMatcher, matchGlob, type IgnoreMatcher } from './ignore.js'
import { WorkspaceError, type Workspace } from './paths.js'

export type WalkOptions = {
  signal?: AbortSignal
  ignore?: IgnoreMatcher
  limit?: number
}

export type WalkResult = {
  /** Absolute file paths in stable order. */
  files: string[]
  /** Relative paths with forward slashes, same order. */
  relative: string[]
  capped: boolean
}

/** Recursively list files, skipping ignored entries; order is deterministic. */
export function walkWorkspaceFiles(
  workspace: Workspace,
  startDirectory: string,
  options: WalkOptions = {}
): WalkResult {
  const ignore = options.ignore ?? createIgnoreMatcher(workspace.root)
  const limit = options.limit ?? MAX_WALK_FILES
  const files: string[] = []
  const relativePaths: string[] = []
  let capped = false

  function visit(directory: string): boolean {
    const handle = options.signal
    if (handle?.aborted) {
      throw new WorkspaceError(ERROR_CODES.coreToolFailed, 'Search cancelled')
    }
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return true
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (files.length >= limit) {
        capped = true
        return false
      }
      const full = join(directory, entry.name)
      const rel = relative(workspace.root, full).split(sep).join('/')
      const isDirectory =
        entry.isDirectory() || (!entry.isFile() && safeIsDirectory(full))
      if (isDirectory) {
        if (ignore.isIgnoredDirectory(full)) continue
        if (!visit(full)) return false
        continue
      }
      if (!entry.isFile() && !safeIsFile(full)) continue
      if (ignore.isIgnored(full)) continue
      files.push(full)
      relativePaths.push(rel)
    }
    return true
  }

  visit(startDirectory)
  return { files, relative: relativePaths, capped }
}

function safeIsDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory()
  } catch {
    return false
  }
}

function safeIsFile(target: string): boolean {
  try {
    return statSync(target).isFile()
  } catch {
    return false
  }
}

function looksBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 8000)
  for (let index = 0; index < limit; index++) {
    if (buffer[index] === 0) return true
  }
  return false
}

export type GlobOptions = {
  pattern: string
  path?: string
  maxResults?: number
  signal?: AbortSignal
}

export type SearchSummary = {
  /** The text the tool returns to the model. */
  text: string
  total: number
  shown: number
  truncated: boolean
}

export function globWorkspace(
  workspace: Workspace,
  options: GlobOptions
): SearchSummary {
  const base = options.path ? workspace.resolve(options.path) : undefined
  if (base && !base.isDirectory) {
    throw new WorkspaceError(
      ERROR_CODES.workspaceNotAFile,
      `Search path is not a directory: ${base.relative}`
    )
  }
  const startReal = base ? base.real : workspace.root
  const baseRel = base ? base.relative : ''
  const walk = walkWorkspaceFiles(workspace, startReal, {
    signal: options.signal
  })
  const matched = walk.relative.filter((rel) =>
    matchGlob(options.pattern, withoutBase(rel, baseRel))
  )
  const max = options.maxResults ?? MAX_SEARCH_RESULTS
  const shown = matched.slice(0, max)
  const capped = walk.capped
  const truncated = matched.length > shown.length || capped
  const header =
    (capped ? `[walk capped at ${walk.files.length} files] ` : '') +
    `[${matched.length} matches${matched.length > shown.length ? `, showing ${shown.length}` : ''}]`
  return {
    text: (shown.length === 0 ? 'No matches.\n' : shown.join('\n') + '\n') + header,
    total: matched.length,
    shown: shown.length,
    truncated
  }
}

/** Strip the search base from a root-relative path for pattern matching. */
function withoutBase(rel: string, baseRel: string): string {
  if (!baseRel || baseRel === '.') return rel
  return rel.startsWith(baseRel + '/') ? rel.slice(baseRel.length + 1) : rel
}

export type GrepOptions = {
  pattern: string
  path?: string
  glob?: string
  caseInsensitive?: boolean
  maxResults?: number
  signal?: AbortSignal
  maxFileBytes?: number
}

export function grepWorkspace(
  workspace: Workspace,
  options: GrepOptions
): SearchSummary {
  let regex: RegExp
  try {
    regex = new RegExp(options.pattern, options.caseInsensitive ? 'gim' : 'gm')
  } catch (error) {
    throw new WorkspaceError(
      ERROR_CODES.coreToolFailed,
      `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const base = options.path ? workspace.resolve(options.path) : undefined
  if (base && !base.isDirectory) {
    throw new WorkspaceError(
      ERROR_CODES.workspaceNotAFile,
      `Search path is not a directory: ${base.relative}`
    )
  }
  const startReal = base ? base.real : workspace.root
  const baseRel = base ? base.relative : ''
  const walk = walkWorkspaceFiles(workspace, startReal, {
    signal: options.signal
  })
  const max = options.maxResults ?? MAX_SEARCH_RESULTS
  const maxFileBytes = options.maxFileBytes ?? 2 * 1024 * 1024
  const lines: string[] = []
  let totalMatches = 0
  let skippedBinary = 0
  let filesScanned = 0
  let capped = walk.capped

  for (let index = 0; index < walk.files.length; index++) {
    if (options.signal?.aborted) {
      throw new WorkspaceError(ERROR_CODES.coreToolFailed, 'Search cancelled')
    }
    if (options.glob && !matchGlob(options.glob, withoutBase(walk.relative[index], baseRel)))
      continue
    const file = walk.files[index]
    let buffer
    try {
      if (statSync(file).size > maxFileBytes) continue
      buffer = readFileSync(file)
    } catch {
      continue
    }
    filesScanned++
    if (looksBinary(buffer)) {
      skippedBinary++
      continue
    }
    const text = buffer.toString('utf8').replace(/\r\n/g, '\n')
    let lineNo = 0
    for (const line of text.split('\n')) {
      lineNo++
      regex.lastIndex = 0
      if (regex.test(line)) {
        totalMatches++
        if (lines.length < max) {
          lines.push(`${walk.relative[index]}:${lineNo}:${line.slice(0, 500)}`)
        }
      }
    }
    if (totalMatches > max * 20 && lines.length >= max) {
      capped = true
      break
    }
  }

  const truncated = totalMatches > lines.length || capped
  const binaryNote = skippedBinary > 0 ? `, ${skippedBinary} binary files skipped` : ''
  const header =
    `[${totalMatches}${capped ? '+' : ''} matches in ${filesScanned} files${binaryNote}` +
    (truncated ? `, showing ${lines.length}` : '') +
    ']'
  return {
    text: lines.join('\n') + (lines.length > 0 ? '\n' : '') + header,
    total: totalMatches,
    shown: lines.length,
    truncated
  }
}
