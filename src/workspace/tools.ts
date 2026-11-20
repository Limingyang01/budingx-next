// ToolHandler assembly for the five file tools (SP003 design §3.5/§3.1,
// plan T16). The tool names follow the model ecosystem convention; every
// implementation here is this repository's own code.
import { isUtf8 } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { ERROR_CODES } from '../core/constants.js'
import type { ChangeRecordSummary } from '../core/events.js'
import type { ToolCapability } from '../core/permissions.js'
import type { PreparedTool, ToolContext, ToolHandler } from '../core/tools.js'
import { createCheckpointStore, type CheckpointStore } from './checkpoint.js'
import { diffLines, diffSummary } from './diff.js'
import { planWorkspaceEdit } from './edit.js'
import { WorkspaceError, type Workspace } from './paths.js'
import { globWorkspace, grepWorkspace } from './search.js'
import { readWorkspaceFile } from './read.js'
import { contentFingerprint, writeWorkspaceFile } from './write.js'

export type WorkspaceToolsOptions = {
  /**
   * Permission-aware exclusion used by Glob/Grep (SP003 T18i): a file a
   * deny rule hides from Read must not leak through search either.
   */
  readDenied?: (relativePath: string) => boolean
}

export type WorkspaceTools = {
  tools: ToolHandler[]
  checkpoint: CheckpointStore
}

function asObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new WorkspaceError(ERROR_CODES.coreToolFailed, 'Tool input must be an object')
  }
  return input as Record<string, unknown>
}

function stringField(input: unknown, name: string): string {
  const value = asObject(input)[name]
  if (typeof value !== 'string' || !value.trim()) {
    throw new WorkspaceError(
      ERROR_CODES.coreToolFailed,
      `Missing required string field: ${name}`
    )
  }
  return value
}

const filePathProperties = {
  file_path: { type: 'string', description: 'Path to the file inside the workspace (absolute or relative)' },
  path: { type: 'string', description: 'Compatibility alias for file_path' }
}

const filePathRequired = { anyOf: [{ required: ['file_path'] }, { required: ['path'] }] }

function workspaceFilePath(input: unknown): string {
  const { file_path, path } = asObject(input)
  if (file_path !== undefined && path !== undefined && file_path !== path) {
    throw new WorkspaceError(ERROR_CODES.coreToolFailed, 'file_path and path must name the same file; supply just one')
  }
  return stringField(input, file_path === undefined && path !== undefined ? 'path' : 'file_path')
}

function describeFile(operation: string, input: unknown): string {
  const { file_path, path } = asObject(input)
  return `${operation} ${String(file_path ?? path ?? '')}`
}

function optionalNumber(input: unknown, name: string): number | undefined {
  const value = asObject(input)[name]
  if (value === undefined || value === null) return undefined
  const parsed = typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new WorkspaceError(ERROR_CODES.coreToolFailed, `${name} must be a number`)
  }
  return Math.trunc(parsed)
}

function optionalBoolean(input: unknown, name: string): boolean | undefined {
  const value = asObject(input)[name]
  if (value === undefined || value === null) return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  if (typeof value !== 'boolean') {
    throw new WorkspaceError(ERROR_CODES.coreToolFailed, `${name} must be a boolean`)
  }
  return value
}

function reportChange(
  context: ToolContext,
  entry: {
    id: string
    path: string
    operation: 'create' | 'update'
    diff: ReturnType<typeof diffLines>
    at: string
  }
): void {
  const { additions, removals } = diffSummary(entry.diff)
  const summary: ChangeRecordSummary = {
    id: entry.id,
    path: entry.path,
    operation: entry.operation,
    additions,
    removals,
    at: entry.at,
    ...(context.turnId ? { turnId: context.turnId } : {})
  }
  context.changes?.([summary])
}

function textField(input: unknown, name: string): string {
  const value = asObject(input)[name]
  if (typeof value !== 'string') {
    throw new WorkspaceError(ERROR_CODES.coreToolFailed, `${name} must be a string`)
  }
  return value
}

function previewFor(
  diff: ReturnType<typeof diffLines>,
  before: string | undefined,
  after: string
): string[] {
  if (diff.length === 0) {
    if (before === undefined) return ['Create empty file']
    return [before === after ? 'No content changes' : 'Only line endings or final newline changed']
  }
  const lines: string[] = []
  for (const hunk of diff) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`)
    for (const line of hunk.lines) {
      const mark = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '
      lines.push(mark + line.text)
    }
  }
  return lines
}

export function createWorkspaceTools(
  workspace: Workspace,
  options: WorkspaceToolsOptions = {}
): WorkspaceTools {
  const checkpoint = createCheckpointStore()
  const readState = new Map<string, string>()
  const pathKey = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path

  function prepareWrite(input: unknown, operation: 'Write' | 'Edit'): PreparedTool {
    const path = workspaceFilePath(input)
    const target = workspace.resolve(path)
    if (target.isDirectory) {
      throw new WorkspaceError(ERROR_CODES.workspaceNotAFile, `Path is a directory: ${target.relative}`)
    }
    const key = pathKey(target.real)
    const seen = readState.get(key)
    if (target.existed && seen === undefined) {
      throw new WorkspaceError(
        ERROR_CODES.workspaceNotReadYet,
        `File has not been read yet. Read it first before writing to it: ${target.relative}`
      )
    }
    const bytes = target.existed ? readFileSync(target.real) : undefined
    const fingerprint = bytes ? contentFingerprint(bytes) : null
    if (bytes && seen !== fingerprint) {
      throw new WorkspaceError(
        ERROR_CODES.workspaceStaleRead,
        `File has been modified since read, either by the user or by a linter. Read it again before attempting to write it: ${target.relative}`
      )
    }
    if (bytes && (!isUtf8(bytes) || bytes.includes(0))) {
      throw new WorkspaceError(ERROR_CODES.workspaceEncodingUnsupported, `File is not UTF-8 text: ${target.relative}`)
    }
    const before = bytes?.toString('utf8')
    const plan = operation === 'Write'
      ? { content: textField(input, 'content'), replacements: 0 }
      : planWorkspaceEdit(before, target.relative, {
          path,
          oldString: textField(input, 'old_string'),
          newString: textField(input, 'new_string'),
          replaceAll: optionalBoolean(input, 'replace_all')
        })
    const diff = diffLines(before ?? '', plan.content)
    return {
      get preview() {
        return previewFor(diff, before, plan.content)
      },
      async execute(context) {
        if (context.signal?.aborted) throw new WorkspaceError(ERROR_CODES.coreToolFailed, 'Write cancelled')
        const written = writeWorkspaceFile(workspace, {
          path,
          content: plan.content,
          expectedFingerprint: fingerprint,
          expectedPath: target.real,
          normalizeLineEndings: false
        })
        readState.set(key, written.fingerprint)
        const entry = checkpoint.record({
          path: written.path,
          operation: written.created ? 'create' : 'update',
          ...(before === undefined ? {} : { before }),
          after: plan.content,
          diff,
          fingerprintAfter: written.fingerprint,
          ...(context.turnId ? { turnId: context.turnId } : {})
        })
        reportChange(context, entry)
        if (operation === 'Edit') return `Edited ${written.path}: ${plan.replacements} replacement(s)`
        const { additions, removals } = diffSummary(diff)
        return `Wrote ${written.bytes} bytes to ${written.path}${written.created ? ' (new file)' : ''} +${additions}/-${removals}`
      }
    }
  }

  const read: ToolHandler = {
    name: 'Read',
    summary: 'Read a numbered text file or Jupyter notebook inside the workspace. Text files support an optional line range.',
    parameters: {
      type: 'object',
      properties: {
        ...filePathProperties,
        offset: { type: 'integer', description: 'First line to read (1-based)' },
        limit: { type: 'integer', description: 'Number of lines to read' }
      },
      ...filePathRequired
    },
    describe: (input) => describeFile('Read', input),
    capability: (): ToolCapability => 'read',
    target: (input) => ({ path: workspaceFilePath(input), kind: 'file' }),
    async execute(input) {
      const path = workspaceFilePath(input)
      const result = readWorkspaceFile(workspace, {
        path,
        offset: optionalNumber(input, 'offset'),
        limit: optionalNumber(input, 'limit'),
        allowEmptyRange: true
      })
      if (result.fingerprint) {
        readState.set(pathKey(workspace.resolve(path).real), result.fingerprint)
      }
      if (result.kind === 'image') {
        const image = result.image
        const size =
          image?.width && image?.height ? `${image.width}x${image.height}, ` : ''
        return `[image ${image?.mime ?? 'unknown'}, ${size}${result.bytes} bytes] image content is not sent to the model yet`
      }
      return result.bytes === 0 ? '[The file exists but its contents are empty.]' : result.text
    }
  }

  const write: ToolHandler = {
    name: 'Write',
    summary: 'Create or overwrite a text file inside the workspace.',
    parameters: {
      type: 'object',
      properties: {
        ...filePathProperties,
        content: { type: 'string', description: 'Full new content of the file' }
      },
      required: ['content'],
      ...filePathRequired
    },
    describe: (input) => describeFile('Write', input),
    requiresApproval: () => true,
    capability: (): ToolCapability => 'write',
    target: (input) => ({ path: workspaceFilePath(input), kind: 'file' }),
    prepareApproval: (input) => prepareWrite(input, 'Write'),
    async execute(input, context) {
      return prepareWrite(input, 'Write').execute(context)
    }
  }

  const edit: ToolHandler = {
    name: 'Edit',
    summary:
      'Replace an exact literal string in a file. The match must be unique unless replace_all is set.',
    parameters: {
      type: 'object',
      properties: {
        ...filePathProperties,
        old_string: { type: 'string', description: 'Exact text to replace' },
        new_string: { type: 'string', description: 'Replacement text' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence' }
      },
      required: ['old_string', 'new_string'],
      ...filePathRequired
    },
    describe: (input) => describeFile('Edit', input),
    requiresApproval: () => true,
    capability: (): ToolCapability => 'write',
    target: (input) => ({ path: workspaceFilePath(input), kind: 'file' }),
    prepareApproval: (input) => prepareWrite(input, 'Edit'),
    async execute(input, context) {
      return prepareWrite(input, 'Edit').execute(context)
    }
  }

  const glob: ToolHandler = {
    name: 'Glob',
    summary: 'Find files by glob pattern inside the workspace, honouring ignore rules.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern, e.g. src/**/*.ts' },
        path: { type: 'string', description: 'Subdirectory to search (workspace-relative)' }
      },
      required: ['pattern']
    },
    describe: (input) => `Glob ${String(asObject(input).pattern ?? '')}`,
    capability: (): ToolCapability => 'read',
    target: (input) => ({
      ...(typeof asObject(input).path === 'string'
        ? { path: asObject(input).path as string }
        : {}),
      kind: 'search' as const
    }),
    async execute(input, context) {
      if (context.signal.aborted) throw new WorkspaceError(ERROR_CODES.coreToolFailed, 'cancelled')
      return globWorkspace(workspace, {
        pattern: stringField(input, 'pattern'),
        path:
          typeof asObject(input).path === 'string'
            ? (asObject(input).path as string)
            : undefined,
        signal: context.signal,
        ...(options.readDenied ? { exclude: options.readDenied } : {})
      }).text
    }
  }

  const grep: ToolHandler = {
    name: 'Grep',
    summary:
      'Search file contents by regular expression inside the workspace. Supports output modes, context lines, type filters and pagination.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression, including leading flags such as (?i)' },
        path: { type: 'string', description: 'File or directory to search (workspace-relative)' },
        glob: { type: 'string', description: 'Only search files matching these globs, separated by commas or spaces' },
        type: { type: 'string', description: 'File type filter, e.g. ts, py, json' },
        output_mode: {
          type: 'string',
          enum: ['content', 'files_with_matches', 'count'],
          description: 'What to return (default files_with_matches)'
        },
        case_insensitive: { type: 'boolean', description: 'Ignore case when matching' },
        '-i': { type: 'boolean', description: 'Alias for case_insensitive' },
        '-n': { type: 'boolean', description: 'Show line numbers in content mode (default true)' },
        multiline: { type: 'boolean', description: 'Let . match newlines too' },
        '-B': { type: 'integer', description: 'Context lines before each match' },
        '-A': { type: 'integer', description: 'Context lines after each match' },
        context: { type: 'integer', description: 'Context lines before and after each match' },
        '-C': { type: 'integer', description: 'Alias for context' },
        head_limit: { type: 'integer', description: 'Max results (default 250, 0 = all)' },
        offset: { type: 'integer', description: 'Skip the first N results' }
      },
      required: ['pattern']
    },
    describe: (input) => `Grep ${String(asObject(input).pattern ?? '')}`,
    capability: (): ToolCapability => 'read',
    target: (input) => ({
      ...(typeof asObject(input).path === 'string'
        ? { path: asObject(input).path as string }
        : {}),
      kind: 'search' as const
    }),
    async execute(input, context) {
      if (context.signal.aborted) throw new WorkspaceError(ERROR_CODES.coreToolFailed, 'cancelled')
      const obj = asObject(input)
      const around = optionalNumber(input, 'context') ?? optionalNumber(input, '-C')
      const outputMode = obj.output_mode ?? 'files_with_matches'
      if (outputMode !== 'content' && outputMode !== 'files_with_matches' && outputMode !== 'count') {
        throw new WorkspaceError(ERROR_CODES.coreToolFailed, 'output_mode must be content, files_with_matches, or count')
      }
      return grepWorkspace(workspace, {
        pattern: textField(input, 'pattern'),
        path: typeof obj.path === 'string' ? obj.path : undefined,
        glob: typeof obj.glob === 'string' ? obj.glob : undefined,
        caseInsensitive: optionalBoolean(input, 'case_insensitive') ?? optionalBoolean(input, '-i'),
        lineNumbers: optionalBoolean(input, '-n'),
        signal: context.signal,
        exclude: options.readDenied,
        outputMode,
        type: typeof obj.type === 'string' ? obj.type : undefined,
        multiline: optionalBoolean(input, 'multiline'),
        before: around ?? optionalNumber(input, '-B'),
        after: around ?? optionalNumber(input, '-A'),
        maxResults: optionalNumber(input, 'head_limit'),
        offset: optionalNumber(input, 'offset')
      }).text
    }
  }

  return { tools: [read, write, edit, glob, grep], checkpoint }
}
