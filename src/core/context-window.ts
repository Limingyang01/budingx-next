// Context window resolution (SP009 0.9.1, loop-context-fidelity LC-03).
//
// The window is no longer a fixed constant: it is resolved per model from the
// strongest available source, mirroring the reference's "explicit override >
// configured > capability metadata > default" ladder. Pure function, no I/O.

/** Fallback window when no source provides a usable value. */
export const DEFAULT_CONTEXT_WINDOW = 200_000

export type ContextWindowSources = {
  /** Global explicit override (BUDINGX_CONTEXT_WINDOW). Highest priority. */
  envWindow?: number
  /** User-configured per-profile window (custom models). */
  profileWindow?: number
  /** Window discovered from the provider's model metadata. */
  discoveredWindow?: number
}

function usable(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
}

/**
 * Resolve the effective context window. Each candidate must be a positive
 * integer; invalid candidates are skipped so a bad override never collapses
 * the window to zero. Priority: env > profile > discovered > default.
 */
export function resolveContextWindow(sources: ContextWindowSources = {}): number {
  if (usable(sources.envWindow)) return sources.envWindow
  if (usable(sources.profileWindow)) return sources.profileWindow
  if (usable(sources.discoveredWindow)) return sources.discoveredWindow
  return DEFAULT_CONTEXT_WINDOW
}
