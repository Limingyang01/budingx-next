// Workspace limits (SP003 design §3.5, §3.7 and §8 O-01).
// Every limit is a named constant so the design values stay traceable.
// Whole-file reads stop with an error above this size, matching the
// reference limits (MAX_OUTPUT_SIZE 0.25MB); ranged reads go higher.
export const MAX_FILE_BYTES = 256 * 1024
export const MAX_READ_RANGE_BYTES = 10 * 1024 * 1024
export const MAX_READ_LINES = 2000
export const MAX_GLOB_RESULTS = 100
export const MAX_GREP_RESULTS = 250
export const MAX_WALK_FILES = 20000
export const MAX_CONTEXT_LINES = 2000
export const MAX_CONTEXT_BYTES = 64 * 1024
export const MAX_TOTAL_CONTEXT_BYTES = 128 * 1024
export const DIFF_CONTEXT_LINES = 3
