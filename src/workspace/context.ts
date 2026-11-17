// @ file references (SP003 design §3.7, AC FC-04 … FC-07).
// Parsing is deliberately simple and safe: `@path` tokens (optionally
// quoted when the path contains spaces) are resolved through the
// workspace, read with the same caps as the Read tool, and reported back
// with readable errors instead of being silently dropped.
import { MAX_CONTEXT_BYTES, MAX_CONTEXT_LINES, MAX_TOTAL_CONTEXT_BYTES } from './constants.js'
import { readWorkspaceFile } from './read.js'
import { WorkspaceError, type Workspace } from './paths.js'

export type FileReference = {
  raw: string
  path: string
}

export type ContextBlock = {
  source: string
  content: string
  /** Truncation or skip note shown to the model and the user. */
  notice?: string
}

export type ContextBuild = {
  blocks: ContextBlock[]
  /** References that could not be attached, with the readable reason. */
  errors: { raw: string; message: string }[]
  bytes: number
}

/**
 * Extract @path tokens from user input. Quoted forms `@"with space.txt"`
 * are supported; a token ends at whitespace or quote. Escaped \`@` stays
 * literal. Code fences are not special-cased in this round.
 */
export function extractFileReferences(text: string): FileReference[] {
  const refs: FileReference[] = []
  const seen = new Set<string>()
  const pattern = /(?<!\\)@(?:"([^"\n]+)"|([^\s"@,;:()]+))/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const raw = (match[1] ?? match[2] ?? '').trim()
    if (!raw) continue
    const key = raw.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    refs.push({ raw, path: raw })
  }
  return refs
}

export function buildContextBlocks(
  workspace: Workspace,
  references: FileReference[]
): ContextBuild {
  const blocks: ContextBlock[] = []
  const errors: ContextBuild['errors'] = []
  let totalBytes = 0

  for (const reference of references) {
    if (totalBytes >= MAX_TOTAL_CONTEXT_BYTES) {
      errors.push({
        raw: reference.raw,
        message: `context budget reached (${MAX_TOTAL_CONTEXT_BYTES} bytes); reference not attached`
      })
      continue
    }
    let result
    try {
      result = readWorkspaceFile(workspace, { path: reference.path })
    } catch (error) {
      errors.push({
        raw: reference.raw,
        message: error instanceof WorkspaceError ? error.message : String(error)
      })
      continue
    }
    if (result.kind === 'image') {
      const size =
        result.image?.width && result.image?.height
          ? `${result.image.width}x${result.image.height}, `
          : ''
      blocks.push({
        source: reference.path,
        content: '',
        notice: `image placeholder only (${size}${result.bytes} bytes); image content is not sent to the model yet`
      })
      continue
    }

    const lines = result.text.split('\n')
    let content = result.text
    let notice: string | undefined = result.truncated
      ? `truncated on read: ${result.truncatedReason}`
      : undefined
    if (lines.length > MAX_CONTEXT_LINES) {
      content = lines.slice(0, MAX_CONTEXT_LINES).join('\n')
      notice = `truncated to ${MAX_CONTEXT_LINES} lines of ${lines.length}`
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_CONTEXT_BYTES) {
      const buffer = Buffer.from(content, 'utf8').subarray(0, MAX_CONTEXT_BYTES)
      content = buffer.toString('utf8').replace(/\uFFFD+$/, '')
      notice = `truncated to ${MAX_CONTEXT_BYTES} bytes`
    }
    const remaining = MAX_TOTAL_CONTEXT_BYTES - totalBytes
    if (Buffer.byteLength(content, 'utf8') > remaining) {
      content = Buffer.from(content, 'utf8')
        .subarray(0, remaining)
        .toString('utf8')
        .replace(/\uFFFD+$/, '')
      notice = `truncated to fit the total context budget (${MAX_TOTAL_CONTEXT_BYTES} bytes)`
    }
    totalBytes += Buffer.byteLength(content, 'utf8')
    blocks.push({
      source: reference.path,
      content,
      ...(notice ? { notice } : {})
    })
  }
  return { blocks, errors, bytes: totalBytes }
}

/** Convenience: parse and build in one step (TUI submit path). */
export function resolveFileReferences(
  workspace: Workspace,
  text: string
): ContextBuild {
  return buildContextBlocks(workspace, extractFileReferences(text))
}
