// Precise literal edits (SP003 design §3.5, AC WT-07/WT-08).
// The semantics are deliberately strict: only a unique literal match is
// replaced, ambiguous matches must be resolved by the caller, and there is
// no fuzzy matching that could silently damage a file. The single
// concession is a line-ending fallback (the tolerance path from the
// reference behaviour inventory): a CRLF file can still be edited with an
// LF old_string, and the dominant line ending is preserved.
import { isUtf8 } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { ERROR_CODES } from '../core/constants.js'
import { contentFingerprint, writeWorkspaceFile } from './write.js'
import { WorkspaceError, type Workspace } from './paths.js'

export type EditOptions = {
  path: string
  oldString: string
  newString: string
  replaceAll?: boolean
}

export type EditResult = {
  path: string
  replacements: number
  created: boolean
  fingerprint: string
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count++
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

function foldSmartQuotes(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
}

function replaceOccurrences(
  haystack: string,
  needle: string,
  replacement: string,
  replaceAll: boolean
): string {
  return replaceAll
    ? haystack.split(needle).join(replacement)
    : haystack.replace(needle, () => replacement)
}

function hintFor(oldString: string): string {
  const firstLine = oldString.split('\n')[0].slice(0, 60)
  return `no exact match for ${JSON.stringify(firstLine)}; verify the exact text and whitespace`
}

export function planWorkspaceEdit(
  original: string | undefined,
  path: string,
  options: EditOptions
): { content: string; replacements: number } {
  const { oldString, newString } = options

  if (oldString === newString) {
    throw new WorkspaceError(
      ERROR_CODES.workspaceEditAmbiguous,
      'old_string must differ from new_string'
    )
  }

  // Empty old_string creates a file; it never overwrites one.
  if (oldString === '') {
    if (original !== undefined) {
      throw new WorkspaceError(
        ERROR_CODES.workspaceEditAmbiguous,
        `old_string is empty but the file already exists: ${path}`
      )
    }
    return { content: newString.replace(/\r\n/g, '\n'), replacements: 1 }
  }

  if (original === undefined) {
    throw new WorkspaceError(
      ERROR_CODES.workspaceNotFound,
      `File not found: ${path}`
    )
  }

  const crlfCount = original.match(/\r\n/g)?.length ?? 0
  const newlineCount = original.match(/\n/g)?.length ?? 0
  const lineEnding = crlfCount > 0 && crlfCount * 2 >= newlineCount ? '\r\n' : '\n'
  const replacement = newString.replace(/\r?\n/g, lineEnding)
  let count = countOccurrences(original, oldString)
  let nextContent: string
  let replacements: number

  if (count === 0) {
    // Tolerance fallback (SP003 T18h, aligned with the reference
    // findActualString): compare in LF space with curly quotes folded —
    // folding is length preserving, so match offsets found in the folded
    // space map straight back onto the text we splice. Only the matched
    // region is replaced; the rest of the file keeps its quote style.
    const offsets: number[] = []
    const normalized = original.replace(/\r\n/g, (_, offset: number) => {
      offsets.push(offset - offsets.length)
      return '\n'
    })
    const folded = foldSmartQuotes(normalized)
    const foldedOld = foldSmartQuotes(oldString.replace(/\r\n/g, '\n'))
    const positions: number[] = []
    let index = folded.indexOf(foldedOld)
    while (index !== -1) {
      positions.push(index)
      index = folded.indexOf(foldedOld, index + foldedOld.length)
    }
    count = positions.length
    if (count === 0) {
      throw new WorkspaceError(
        ERROR_CODES.workspaceEditNoMatch,
        `Edit refused (${path}): ${hintFor(oldString)}`
      )
    }
    if (count > 1 && !options.replaceAll) {
      throw new WorkspaceError(
        ERROR_CODES.workspaceEditAmbiguous,
        `Found ${count} matches of old_string in ${path}; pass replace_all or a longer unique string`
      )
    }
    replacements = options.replaceAll ? count : 1
    const originalOffset = (offset: number): number => {
      let low = 0
      let high = offsets.length
      while (low < high) {
        const middle = (low + high) >>> 1
        if (offsets[middle] < offset) low = middle + 1
        else high = middle
      }
      return offset + low
    }
    let out = original
    for (const position of options.replaceAll ? [...positions].reverse() : [positions[0]]) {
      const start = originalOffset(position)
      const end = originalOffset(position + foldedOld.length)
      out = out.slice(0, start) + replacement + out.slice(end)
    }
    nextContent = out
  } else {
    if (count > 1 && !options.replaceAll) {
      throw new WorkspaceError(
        ERROR_CODES.workspaceEditAmbiguous,
        `Found ${count} matches of old_string in ${path}; pass replace_all or a longer unique string`
      )
    }
    replacements = options.replaceAll ? count : 1
    nextContent = replaceOccurrences(original, oldString, replacement, Boolean(options.replaceAll))
  }

  return { content: nextContent, replacements }
}

export function editWorkspaceFile(workspace: Workspace, options: EditOptions): EditResult {
  const resolved = workspace.resolve(options.path)
  if (resolved.isDirectory) {
    throw new WorkspaceError(ERROR_CODES.workspaceNotAFile, `Path is a directory: ${resolved.relative}`)
  }
  const original = resolved.existed ? readFileSync(resolved.real) : undefined
  if (original && (!isUtf8(original) || original.includes(0))) {
    throw new WorkspaceError(ERROR_CODES.workspaceEncodingUnsupported, `File is not UTF-8 text: ${resolved.relative}`)
  }
  const edit = planWorkspaceEdit(original?.toString('utf8'), resolved.relative, options)
  const written = writeWorkspaceFile(workspace, {
    path: options.path,
    content: edit.content,
    expectedFingerprint: original ? contentFingerprint(original) : null,
    expectedPath: resolved.real,
    normalizeLineEndings: false
  })
  return {
    path: written.path,
    replacements: edit.replacements,
    created: written.created,
    fingerprint: written.fingerprint
  }
}
