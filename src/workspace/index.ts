// Workspace module entry (SP003 design §3.1).
export { createWorkspace, isInsideRoot, realPathOf, WorkspaceError } from './paths.js'
export type { ResolvedPath, Workspace } from './paths.js'
export { createIgnoreMatcher, isDefaultIgnoredDirectory, matchGlob } from './ignore.js'
export type { IgnoreMatcher } from './ignore.js'
export { readWorkspaceFile } from './read.js'
export type { ReadKind, ReadOptions, ReadResult, ImageInfo } from './read.js'
export { contentFingerprint, currentFingerprint, writeWorkspaceFile } from './write.js'
export type { WriteOptions, WriteResult } from './write.js'
export { editWorkspaceFile } from './edit.js'
export type { EditOptions, EditResult } from './edit.js'
export { globWorkspace, grepWorkspace, walkWorkspaceFiles } from './search.js'
export type { GlobOptions, GrepOptions, SearchSummary, WalkOptions, WalkResult } from './search.js'
export { diffLines, diffSummary } from './diff.js'
export type { DiffHunk, DiffLine, DiffLineType } from './diff.js'
export { createCheckpointStore } from './checkpoint.js'
export type { ChangeRecord, CheckpointStore, UndoOutcome } from './checkpoint.js'
export {
  createPermissionPolicy,
  isCredentialLike,
  MODES_EN,
  MODES_ZH,
  nextMode
} from './policy.js'
export type {
  BudingPermissionPolicy,
  PermissionRule,
  PermissionPolicyOptions,
  ShadowedRule
} from './policy.js'
export { createWorkspaceTools } from './tools.js'
export type { WorkspaceTools } from './tools.js'
export { buildContextBlocks, extractFileReferences, resolveFileReferences } from './context.js'
export type { ContextBlock, ContextBuild, FileReference } from './context.js'
export {
  DIFF_CONTEXT_LINES,
  MAX_CONTEXT_BYTES,
  MAX_CONTEXT_LINES,
  MAX_FILE_BYTES,
  MAX_READ_LINES,
  MAX_SEARCH_RESULTS,
  MAX_TOTAL_CONTEXT_BYTES,
  MAX_WALK_FILES
} from './constants.js'

