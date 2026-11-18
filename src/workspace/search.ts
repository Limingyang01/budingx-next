// Glob and Grep over the workspace (SP003 design §3.4/§3.5, AC WT-09/WT-10/WT-13).
// Recursion is depth-first with stable ordering, bounded by hard caps, and
// honours the ignore matcher; results are truncated with a count summary so
// the model always knows what it is seeing.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import { ERROR_CODES } from '../core/constants.js'
import { MAX_GLOB_RESULTS, MAX_GREP_RESULTS, MAX_WALK_FILES } from './constants.js'
import { createIgnoreMatcher, matchGlob, type IgnoreMatcher } from './ignore.js'
import { WorkspaceError, type Workspace } from './paths.js'

export type WalkOptions = {
  signal?: AbortSignal
  ignore?: IgnoreMatcher
  limit?: number
  /**
   * Extra exclusion applied after the ignore rules — used to honour
   * permission deny rules for Read in search results (SP003 T18i).
   */
  exclude?: (relativePath: string) => boolean
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
      if (!entry.isDirectory() && !entry.isFile()) {
        // Readdir uses physical directories only; skip ambiguous link entries
        // instead of revisiting a directory or indexing outside the root.
        continue
      }
      if (entry.isDirectory()) {
        if (ignore.isIgnoredDirectory(full)) continue
        if (!visit(full)) return false
        continue
      }
      if (ignore.isIgnored(full)) continue
      if (options.exclude?.(rel)) continue
      files.push(full)
      relativePaths.push(rel)
    }
    return true
  }

  visit(startDirectory)
  return { files, relative: relativePaths, capped }
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
  exclude?: (relativePath: string) => boolean
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
    signal: options.signal,
    ...(options.exclude ? { exclude: options.exclude } : {})
  })
  const matched = walk.relative.filter((rel) =>
    matchSearchGlob(options.pattern, withoutBase(rel, baseRel))
  )
  const max = options.maxResults ?? MAX_GLOB_RESULTS
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

function matchSearchGlob(pattern: string, path: string): boolean {
  const normalized = pattern.replace(/^\/+/, '')
  return /[\[{]/.test(normalized)
    ? posix.matchesGlob(path, normalized)
    : matchGlob(normalized, path)
}

/** Strip the search base from a root-relative path for pattern matching. */
function withoutBase(rel: string, baseRel: string): string {
  if (!baseRel || baseRel === '.') return rel
  return rel.startsWith(baseRel + '/') ? rel.slice(baseRel.length + 1) : rel
}

export type GrepOutputMode = 'content' | 'files_with_matches' | 'count'

export type GrepOptions = {
  pattern: string
  path?: string
  glob?: string
  caseInsensitive?: boolean
  lineNumbers?: boolean
  maxResults?: number
  signal?: AbortSignal
  maxFileBytes?: number
  exclude?: (relativePath: string) => boolean
  outputMode?: GrepOutputMode
  /** Context lines around matches (content mode). */
  before?: number
  after?: number
  /** File type filter, e.g. 'ts', 'py'. */
  type?: string
  /** Skip the first N results (0 allowed); defaults to 0. */
  offset?: number
  multiline?: boolean
}

const TYPE_EXTENSIONS: Record<string, string[]> = {
  ts: ['ts', 'tsx', 'mts', 'cts'],
  js: ['js', 'jsx', 'mjs', 'cjs'],
  py: ['py'],
  md: ['md'],
  json: ['json'],
  go: ['go'],
  rs: ['rs'],
  java: ['java'],
  css: ['css'],
  scss: ['scss'],
  html: ['html'],
  sh: ['sh', 'bash', 'ps1'],
  c: ['c', 'h'],
  cpp: ['cpp', 'hpp', 'cc', 'cxx']
}

/**
 * The reference exposes head_limit (default 250), offset pagination,
 * output_mode content/files_with_matches/count, context lines, a file
 * type filter and multiline matching. We implement the same behaviour
 * surface from scratch:
 *  - files_with_matches sorts by mtime newest-first (then by name);
 *  - content prints `path:line:text` with merged context blocks;
 *  - count prints `path:occurrences` plus a total summary line.
 */
export function grepWorkspace(
  workspace: Workspace,
  options: GrepOptions
): SearchSummary {
  const flags = (options.caseInsensitive ? 'i' : '') + (options.multiline ? 'ms' : '')
  let regex: RegExp
  let globalRegex: RegExp
  try {
    regex = new RegExp(options.pattern, flags)
    globalRegex = new RegExp(options.pattern, flags + 'g')
  } catch (error) {
    throw new WorkspaceError(
      ERROR_CODES.coreToolFailed,
      `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const typeExtensions = options.type ? TYPE_EXTENSIONS[options.type.toLowerCase()] : undefined
  if (options.type && typeExtensions === undefined) {
    throw new WorkspaceError(
      ERROR_CODES.coreToolFailed,
      `Unknown file type: ${options.type}`
    )
  }
  const base = options.path ? workspace.resolve(options.path) : undefined
  if (base && !base.existed) {
    throw new WorkspaceError(ERROR_CODES.workspaceNotFound, `Search path does not exist: ${base.relative}`)
  }
  const baseRel = base?.isDirectory ? base.relative : ''
  const walk = base && !base.isDirectory
    ? options.exclude?.(base.relative)
      ? { files: [], relative: [], capped: false }
      : { files: [base.real], relative: [base.relative], capped: false }
    : walkWorkspaceFiles(workspace, base?.real ?? workspace.root, {
        signal: options.signal,
        exclude: options.exclude
      })
  // head_limit: 0 means unlimited, matching the reference.
  const unlimited = options.maxResults === 0
  const max = unlimited ? Number.POSITIVE_INFINITY : (options.maxResults ?? MAX_GREP_RESULTS)
  const skip = Math.max(0, options.offset ?? 0)
  const maxFileBytes = options.maxFileBytes ?? 32 * 1024 * 1024

  type Hit = { rel: string; occurrences: number; mtimeMs: number; lines: string[] }
  const hits: Hit[] = []
  let totalOccurrences = 0
  let skippedBinary = 0
  let skippedLarge = 0

  for (let index = 0; index < walk.files.length; index++) {
    if (options.signal?.aborted) {
      throw new WorkspaceError(ERROR_CODES.coreToolFailed, 'Search cancelled')
    }
    const rel = walk.relative[index]
    if (options.glob && !matchSearchGlob(options.glob, withoutBase(rel, baseRel))) continue
    if (typeExtensions) {
      const dot = rel.lastIndexOf('.')
      if (dot === -1 || !typeExtensions.includes(rel.slice(dot + 1).toLowerCase())) continue
    }
    const file = walk.files[index]
    let buffer
    let mtimeMs = 0
    try {
      const stats = statSync(file)
      mtimeMs = stats.mtimeMs
      if (stats.size > maxFileBytes) {
        skippedLarge++
        continue
      }
      buffer = readFileSync(file)
    } catch {
      continue
    }
    if (looksBinary(buffer)) {
      skippedBinary++
      continue
    }
    const text = buffer.toString('utf8').replace(/\r\n/g, '\n')
    const linesOf = text.split('\n')
    if (linesOf.at(-1) === '') linesOf.pop()
    const matchLineSet = new Set<number>()
    let occurrences = 0
    if (options.multiline) {
      globalRegex.lastIndex = 0
      let line = 1
      let nextBreak = text.indexOf('\n')
      const lineAt = (offset: number): number => {
        while (nextBreak !== -1 && nextBreak < offset) {
          line++
          nextBreak = text.indexOf('\n', nextBreak + 1)
        }
        return line
      }
      let match: RegExpExecArray | null
      while ((match = globalRegex.exec(text)) !== null) {
        const length = match[0].length
        if (length === 0) globalRegex.lastIndex++
        const startLine = lineAt(match.index)
        if (startLine > linesOf.length) break
        const endLine = lineAt(match.index + Math.max(0, length - 1))
        occurrences++
        for (let matched = startLine; matched <= endLine; matched++) matchLineSet.add(matched)
      }
    } else {
      for (let lineNo = 1; lineNo <= linesOf.length; lineNo++) {
        regex.lastIndex = 0
        if (regex.test(linesOf[lineNo - 1])) {
          occurrences++
          matchLineSet.add(lineNo)
        }
      }
    }
    if (occurrences === 0) continue
    totalOccurrences += occurrences

    if (options.outputMode === 'content' || options.outputMode === undefined) {
      const before = Math.max(0, options.before ?? 0)
      const after = Math.max(0, options.after ?? 0)
      const ranges: [number, number][] = []
      const sortedLines = [...matchLineSet].sort((a, b) => a - b)
      for (const lineNo of sortedLines) {
        const from = Math.max(1, lineNo - before)
        const to = Math.min(linesOf.length, lineNo + after)
        const last = ranges.at(-1)
        if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to)
        else ranges.push([from, to])
      }
      const out: string[] = []
      ranges.forEach(([from, to], rangeIndex) => {
        if (rangeIndex > 0) out.push('--')
        for (let lineNo = from; lineNo <= to; lineNo++) {
          const prefix = options.lineNumbers === false ? rel + ':' : `${rel}:${lineNo}:`
          out.push(prefix + linesOf[lineNo - 1].slice(0, 500))
        }
      })
      hits.push({ rel, occurrences, mtimeMs, lines: out })
    } else {
      hits.push({ rel, occurrences, mtimeMs, lines: [] })
    }
  }

  const limits = [
    ...(walk.capped ? [`walk capped at ${walk.files.length} files`] : []),
    ...(skippedLarge ? [`${skippedLarge} file(s) skipped above ${maxFileBytes} bytes`] : [])
  ]
  const limitNote = limits.length ? '\n\n[Incomplete search: ' + limits.join(', ') + ']' : ''
  if (options.outputMode === 'files_with_matches') {
    hits.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.rel < b.rel ? -1 : 1))
    const shownHits = hits.slice(skip, skip + max)
    const note = hits.length > shownHits.length ? ` (limit ${max === Infinity ? 'none' : max}, offset ${skip})` : ''
    const text =
      shownHits.length === 0
        ? 'No files found'
        : `Found ${hits.length} file${hits.length === 1 ? '' : 's'}${note}\n` +
          shownHits.map((hit) => hit.rel).join('\n')
    return { text: text + limitNote, total: hits.length, shown: shownHits.length, truncated: hits.length > shownHits.length || limits.length > 0 }
  }

  if (options.outputMode === 'count') {
    const shownHits = hits.slice(skip, skip + max)
    const body = shownHits.map((hit) => `${hit.rel}:${hit.occurrences}`).join('\n')
    const fileWord = hits.length === 1 ? 'file' : 'files'
    const text =
      shownHits.length === 0
        ? 'No matches found'
        : `${body}\n\nFound ${totalOccurrences} total occurrence${totalOccurrences === 1 ? '' : 's'} across ${hits.length} ${fileWord}.`
    return { text: text + limitNote, total: totalOccurrences, shown: shownHits.length, truncated: hits.length > shownHits.length || limits.length > 0 }
  }

  const contentLines: string[] = []
  let shown = 0
  let skippedUntilNow = 0
  outer: for (const hit of hits) {
    for (const line of hit.lines) {
      if (line === '--') {
        if (contentLines.length > 0 && contentLines.at(-1) !== '--') contentLines.push('--')
        continue
      }
      if (skippedUntilNow < skip) {
        skippedUntilNow++
        continue
      }
      if (shown >= max) break outer
      contentLines.push(line)
      shown++
    }
  }
  const totalMatchLines = hits.reduce((sum, hit) => sum + hit.lines.filter((line) => line !== '--').length, 0)
  const truncated = totalMatchLines > shown
  const pagination = truncated
    ? `\n\n[Showing ${shown} of ${totalMatchLines} matching lines${skip > 0 ? `, offset ${skip}` : ''}]`
    : ''
  const binaryNote =
    skippedBinary > 0 ? `\n\nNote: ${skippedBinary} binary file${skippedBinary === 1 ? '' : 's'} skipped.` : ''
  return {
    text:
      (contentLines.length === 0 ? 'No matches found' : contentLines.join('\n')) +
      pagination +
      binaryNote + limitNote,
    total: totalMatchLines,
    shown,
    truncated: truncated || limits.length > 0
  }
}
