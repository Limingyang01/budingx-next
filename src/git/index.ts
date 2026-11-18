// Git module entry (SP004 design §3): 只读状态、改动归属、专用 worktree 与受控提交。
export { analyzeChanges, ownPathsFromCheckpoints } from './attribution.js'
export type {
  AnalyzeChangesInput,
  AnalyzeChangesResult,
  ChangeOperation,
  IncludeChange
} from './attribution.js'
export {
  commitWithAuthorization,
  createCommitAuthorization,
  patchDigestOf
} from './commit.js'
export type {
  CommitAuthorization,
  CommitFile,
  CommitRequest,
  CommitResult,
  CommitSnapshot
} from './commit.js'
export { parsePorcelain } from './porcelain.js'
export type { ParsedPorcelain, PorcelainBranch, PorcelainEntry } from './porcelain.js'
export { readGitStatus, sanitizeRemoteUrl } from './status.js'
export type { GitStatus, ReadGitStatusOptions } from './status.js'
export {
  assertWorktreeSlug,
  enterWorktree,
  exitWorktree,
  isValidWorktreeName,
  realPathOf,
  repoSlug,
  validateWorktreeSlug
} from './worktree.js'
export type {
  EnterWorktreeInput,
  ExitWorktreeInput,
  WorktreeEnterResult,
  WorktreeExitAction,
  WorktreeExitResult,
  WorktreeRemovalAuthorization,
  WorktreeSession
} from './worktree.js'
