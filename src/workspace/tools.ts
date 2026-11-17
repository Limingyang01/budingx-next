// ToolHandler assembly for the five file tools (SP003 design §3.5/§3.1,
// plan T16). The tool names follow the model ecosystem convention; every
// implementation here is this repository's own code.
import { readFileSync } from 'node:fs'
import { ERROR_CODES } from '../core/constants.js'
import type { ChangeRecordSummary } from '../core/events.js'
import type { ToolCapability } from '../core/permissions.js'
import type { ToolContext, ToolHandler } from '../core/tools.js'
import { createCheckpointStore, type CheckpointStore } from './checkpoint.js'
import { diffLines, diffSummary } from './diff.js'
import { editWorkspaceFile } from './edit.js'
import { WorkspaceError, type Workspace } from './paths.js'
import { globWorkspace, grepWorkspace } from './search.js'
import { readWorkspaceFile } from './read.js'
import { writeWorkspaceFile } from './write.js'

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

function optionalNumber(input: unknown, name: string): number | undefined {
  const value = asObject(input)[name]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new WorkspaceError(ERROR_CODES.coreToolFailed, `${name} must be a number`)
  }
  return Math.trunc(value)
}

function optionalBoolean(input: unknown, name: string): boolean | undefined {
  const value = asObject(input)[name]
  if (value === undefined || value === null) return undefined
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
    at: entry.at
  }
  context.changes?.([summary])
}

export function createWorkspaceTools(workspace: Workspace): WorkspaceTools {
  const checkpoint = createCheckpointStore()

  const read: ToolHandler = {
    name: 'Read',
    summary: 'Read a text file inside the workspace, with line numbers and an optional line range.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        offset: { type: 'integer', description: 'First line to read (1-based)' },
        limit: { type: 'integer', description: 'Number of lines to read' }
      },
      required: ['path']
    },
    describe: (input) => `Read ${String(asObject(input).path ?? '')}`,
    capability: (): ToolCapability => 'read',
    target: (input) => ({ path: stringField(input, 'path'), kind: 'file' }),
    async execute(input) {
      const result = readWorkspaceFile(workspace, {
        path: stringField(input, 'path'),
        offset: optionalNumber(input, 'offset'),
        limit: optionalNumber(input, 'limit')
      })
      if (result.kind === 'image') {
        const image = result.image
        const size =
          image?.width && image?.height ? `${image.width}x${image.height}, ` : ''
        return `[image ${image?.mime ?? 'unknown'}, ${size}${result.bytes} bytes] image content is not sent to the model yet`
      }
      return result.text
    }
  }

  const write: ToolHandler = {
    name: 'Write',
    summary: 'Create or overwrite a text file inside the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        content: { type: 'string', description: 'Full new content of the file' }
      },
      required: ['path', 'content']
    },
    describe: (input) => `Write ${String(asObject(input).path ?? '')}`,
    requiresApproval: () => true,
    capability: (): ToolCapability => 'write',
    target: (input) => ({ path: stringField(input, 'path'), kind: 'file' }),
    async execute(input, context) {
      const path = stringField(input, 'path')
      const content = (() => {
        const value = asObject(input).content
        if (typeof value !== 'string') {
          throw new WorkspaceError(ERROR_CODES.coreToolFailed, 'content must be a string')
        }
        return value
      })()
      const resolved = workspace.resolve(path)
      const before =
        resolved.existed && !resolved.isDirectory
          ? readFileSync(resolved.real, 'utf8')
          : undefined
      const written = writeWorkspaceFile(workspace, { path, content })
      const diff = diffLines(before ?? '', content)
      const entry = checkpoint.record({
        path: written.path,
        operation: written.created ? 'create' : 'update',
        ...(before === undefined ? {} : { before }),
        after: content,
        diff,
        fingerprintAfter: written.fingerprint
      })
      reportChange(context, entry)
      const { additions, removals } = diffSummary(diff)
      return `Wrote ${written.bytes} bytes to ${written.path}${written.created ? ' (new file)' : ''} +${additions}/-${removals}`
    }
  }

  const edit: ToolHandler = {
    name: 'Edit',
    summary:
      'Replace an exact literal string in a file. The match must be unique unless replace_all is set.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        old_string: { type: 'string', description: 'Exact text to replace' },
        new_string: { type: 'string', description: 'Replacement text' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence' }
      },
      required: ['path', 'old_string', 'new_string']
    },
    describe: (input) => `Edit ${String(asObject(input).path ?? '')}`,
    requiresApproval: () => true,
    capability: (): ToolCapability => 'write',
    target: (input) => ({ path: stringField(input, 'path'), kind: 'file' }),
    async execute(input, context) {
      const path = stringField(input, 'path')
      const resolved = workspace.resolve(path)
      const before =
        resolved.existed && !resolved.isDirectory
          ? readFileSync(resolved.real, 'utf8')
          : undefined
      const result = editWorkspaceFile(workspace, {
        path,
        oldString: (() => {
          const value = asObject(input).old_string
          if (typeof value !== 'string') {
            throw new WorkspaceError(
              ERROR_CODES.coreToolFailed,
              'old_string must be a string'
            )
          }
          return value
        })(),
        newString: (() => {
          const value = asObject(input).new_string
          if (typeof value !== 'string') {
            throw new WorkspaceError(
              ERROR_CODES.coreToolFailed,
              'new_string must be a string'
            )
          }
          return value
        })(),
        replaceAll: optionalBoolean(input, 'replace_all')
      })
      const after = readFileSync(workspace.resolve(path).real, 'utf8')
      const diff = diffLines(before ?? '', after)
      const entry = checkpoint.record({
        path: result.path,
        operation: result.created ? 'create' : 'update',
        ...(before === undefined ? {} : { before }),
        after,
        diff,
        fingerprintAfter: result.fingerprint
      })
      reportChange(context, entry)
      return `Edited ${result.path}: ${result.replacements} replacement(s)`
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
        signal: context.signal
      }).text
    }
  }

  const grep: ToolHandler = {
    name: 'Grep',
    summary: 'Search file contents by regular expression inside the workspace.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'JavaScript regular expression' },
        path: { type: 'string', description: 'Subdirectory to search (workspace-relative)' },
        glob: { type: 'string', description: 'Only search files matching this glob' },
        case_insensitive: { type: 'boolean', description: 'Ignore case when matching' }
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
      return grepWorkspace(workspace, {
        pattern: stringField(input, 'pattern'),
        path: typeof obj.path === 'string' ? obj.path : undefined,
        glob: typeof obj.glob === 'string' ? obj.glob : undefined,
        caseInsensitive: optionalBoolean(input, 'case_insensitive'),
        signal: context.signal
      }).text
    }
  }

  return { tools: [read, write, edit, glob, grep], checkpoint }
}
