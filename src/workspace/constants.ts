// Workspace limits (SP003 design §3.5, §3.7 and §8 O-01).
// Every limit is a named constant so the design values stay traceable.
export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_READ_LINES = 2000
export const MAX_SEARCH_RESULTS = 200
export const MAX_WALK_FILES = 20000
export const MAX_CONTEXT_LINES = 2000
export const MAX_CONTEXT_BYTES = 64 * 1024
export const MAX_TOTAL_CONTEXT_BYTES = 128 * 1024
export const DIFF_CONTEXT_LINES = 3
