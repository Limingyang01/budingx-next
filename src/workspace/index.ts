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

