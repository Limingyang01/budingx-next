// Session checkpoint store and undo (SP003 design §3.6, AC CP-05/CP-06).
// The store keeps, for every write, the previous content and the
// fingerprint of what we believe is now on disk. Undo only rolls back a
// change when the disk still matches our change: the moment a foreign
// edit is detected, automatic undo stops and the user's work is kept.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { DiffHunk } from './diff.js'
import type { Workspace } from './paths.js'
import { contentFingerprint, writeWorkspaceFile } from './write.js'

export type ChangeRecord = {
  id: string
  path: string
  operation: 'create' | 'update'
  /** Previous content; undefined for a created file. */
  before?: string
  diff: DiffHunk[]
  /** Fingerprint of the content this change put on disk. */
  fingerprintAfter: string
  turnId?: string
  at: string
  undone: boolean
}

export type UndoOutcome = {
  undone: boolean
  paths: string[]
  /** Why automatic undo stopped (foreign change detected, nothing to do). */
  reason?: string
}

export type CheckpointStore = {
  record(input: {
    path: string
    operation: 'create' | 'update'
    before?: string
    after: string
    diff: DiffHunk[]
    fingerprintAfter: string
    turnId?: string
  }): ChangeRecord
  /** Records still eligible for undo, newest last. */
  open(): ChangeRecord[]
  /** All records in order, for the /diff dialog and change_set events. */
  changes(): ChangeRecord[]
  undoPath(workspace: Workspace, path: string): UndoOutcome
  undoTurn(workspace: Workspace, turnId?: string): UndoOutcome
  clear(): void
}

export function createCheckpointStore(): CheckpointStore {
  const records: ChangeRecord[] = []

  function record(input: Parameters<CheckpointStore['record']>[0]): ChangeRecord {
    const entry: ChangeRecord = {
      id: randomUUID(),
      path: input.path,
      operation: input.operation,
      ...(input.before !== undefined ? { before: input.before } : {}),
      diff: input.diff,
      fingerprintAfter: input.fingerprintAfter,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      at: new Date().toISOString(),
      undone: false
    }
    records.push(entry)
    return entry
  }

  function open(): ChangeRecord[] {
    return records.filter((entry) => !entry.undone)
  }

  function undoOne(workspace: Workspace, entry: ChangeRecord): UndoOutcome {
    let resolved
    try {
      resolved = workspace.resolve(entry.path)
    } catch (error) {
      return { undone: false, paths: [], reason: error instanceof Error ? error.message : 'path unreadable' }
    }
    if (entry.operation === 'create') {
      if (!resolved.existed) {
        // Already removed: count the create as rolled back by the user.
        entry.undone = true
        return { undone: true, paths: [entry.path] }
      }
      const current = contentFingerprint(readFileSync(resolved.real))
      if (current !== entry.fingerprintAfter) {
        return {
          undone: false,
          paths: [],
          reason: `${entry.path} was changed after we created it; automatic undo stopped to keep those changes`
        }
      }
      rmSync(resolved.real)
      entry.undone = true
      return { undone: true, paths: [entry.path] }
    }
    if (!resolved.existed) {
      return {
        undone: false,
        paths: [],
        reason: `${entry.path} no longer exists; automatic undo stopped`
      }
    }
    const current = contentFingerprint(readFileSync(resolved.real))
    if (current !== entry.fingerprintAfter) {
      return {
        undone: false,
        paths: [],
        reason: `${entry.path} was changed after our edit; automatic undo stopped to keep those changes`
      }
    }
    writeWorkspaceFile(workspace, {
      path: entry.path,
      content: entry.before ?? '',
      expectedFingerprint: current
    })
    entry.undone = true
    return { undone: true, paths: [entry.path] }
  }

  function undoSet(workspace: Workspace, selected: ChangeRecord[]): UndoOutcome {
    const undonePaths: string[] = []
    // Walk backwards so chained edits to one file restore in order.
    for (const entry of [...selected].reverse()) {
      const outcome = undoOne(workspace, entry)
      if (!outcome.undone) {
        return { undone: undonePaths.length > 0, paths: undonePaths, reason: outcome.reason }
      }
      undonePaths.push(...outcome.paths)
    }
    return { undone: selected.length > 0, paths: undonePaths }
  }

  return {
    record,
    open,
    changes: () => [...records],
    undoPath(workspace, path) {
      const target = open().filter((entry) => entry.path === path)
      const newest = target.at(-1)
      if (!newest) return { undone: false, paths: [], reason: `no session change to undo for ${path}` }
      return undoSet(workspace, [newest])
    },
    undoTurn(workspace, turnId) {
      const pending = open()
      const selected = turnId ? pending.filter((entry) => entry.turnId === turnId) : pending
      if (selected.length === 0)
        return { undone: false, paths: [], reason: 'no session changes to undo' }
      return undoSet(workspace, selected)
    },
    clear() {
      records.length = 0
    }
  }
}
