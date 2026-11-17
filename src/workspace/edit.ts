// Precise literal edits (SP003 design §3.5, AC WT-07/WT-08).
// The semantics are deliberately strict: only a unique literal match is
// replaced, ambiguous matches must be resolved by the caller, and there is
// no fuzzy matching that could silently damage a file. The single
// concession is a line-ending fallback (the tolerance path from the
// reference behaviour inventory): a CRLF file can still be edited with an
// LF old_string, and the dominant line ending is preserved.
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

export function editWorkspaceFile(
  workspace: Workspace,
  options: EditOptions
): EditResult {
  const resolved = workspace.resolve(options.path)
  if (resolved.existed && resolved.isDirectory) {
    throw new WorkspaceError(
      ERROR_CODES.workspaceNotAFile,
      `Path is a directory: ${resolved.relative}`
    )
  }
  const { oldString, newString } = options

  if (oldString === newString) {
    throw new WorkspaceError(
      ERROR_CODES.workspaceEditAmbiguous,
      'old_string must differ from new_string'
    )
  }

  // Empty old_string creates a file; it never overwrites one.
  if (oldString === '') {
    if (resolved.existed) {
      throw new WorkspaceError(
        ERROR_CODES.workspaceEditAmbiguous,
        `old_string is empty but the file already exists: ${resolved.relative}`
      )
    }
    const written = writeWorkspaceFile(workspace, {
      path: options.path,
      content: newString
    })
    return {
      path: written.path,
      replacements: 1,
      created: true,
      fingerprint: written.fingerprint
    }
  }

  if (!resolved.existed) {
    throw new WorkspaceError(
      ERROR_CODES.workspaceNotFound,
      `File not found: ${resolved.relative}`
    )
  }

  const originalBytes = readFileSync(resolved.real)
  const original = originalBytes.toString('utf8')
  const baseline = contentFingerprint(originalBytes)

  let count = countOccurrences(original, oldString)
  let nextContent: string
  let replacements: number

  if (count === 0) {
    // Tolerance fallback: compare in LF space, keep the dominant EOL.
    const dominant = original.includes('\r\n') ? '\r\n' : '\n'
    const normalized = original.replace(/\r\n/g, '\n')
    const normalizedOld = oldString.replace(/\r\n/g, '\n')
    count = countOccurrences(normalized, normalizedOld)
    if (count === 0) {
      throw new WorkspaceError(
        ERROR_CODES.workspaceEditNoMatch,
        `Edit refused (${resolved.relative}): ${hintFor(oldString)}`
      )
    }
    if (count > 1 && !options.replaceAll) {
      throw new WorkspaceError(
        ERROR_CODES.workspaceEditAmbiguous,
        `Found ${count} matches of old_string in ${resolved.relative}; pass replace_all or a longer unique string`
      )
    }
    replacements = options.replaceAll ? count : 1
    const normalizedNew = newString.replace(/\r\n/g, '\n')
    nextContent = replaceOccurrences(
      normalized,
      normalizedOld,
      normalizedNew,
      Boolean(options.replaceAll)
    ).replace(/\n/g, dominant)
  } else {
    if (count > 1 && !options.replaceAll) {
      throw new WorkspaceError(
        ERROR_CODES.workspaceEditAmbiguous,
        `Found ${count} matches of old_string in ${resolved.relative}; pass replace_all or a longer unique string`
      )
    }
    replacements = options.replaceAll ? count : 1
    nextContent = replaceOccurrences(original, oldString, newString, Boolean(options.replaceAll))
  }

  const written = writeWorkspaceFile(workspace, {
    path: options.path,
    content: nextContent,
    expectedFingerprint: baseline
  })
  return {
    path: written.path,
    replacements,
    created: false,
    fingerprint: written.fingerprint
  }
}
