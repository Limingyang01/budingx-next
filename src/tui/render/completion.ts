// Completion candidates for @ paths and / commands (SP003 design §3.7,
// AC FC-01 … FC-03). Pure functions only: the host supplies the file list
// (walked with our ignore rules) and the command registry, so filtering,
// ordering and the one-at-a-time directory extension are testable without
// a terminal.
export type CompletionKind = 'file' | 'command'

export type CompletionCandidate = {
  /** Text inserted when the candidate is picked (forward slashes). */
  value: string
  kind: CompletionKind
  directory: boolean
}

export type ActiveToken = {
  kind: CompletionKind
  /** Token text after @ or /, as typed. */
  token: string
  /** Line column where the token starts (including the sigil). */
  start: number
  /** Length of the whole token including the sigil. */
  length: number
}

const MAX_CANDIDATES = 5

/**
 * Inspect the text before the cursor and decide whether an active
 * completion token exists. A `/command` token only counts at line start;
 * `@path` counts anywhere. The cursor may be at the end of the token.
 */
export function activeToken(
  line: string,
  cursorColumn: number,
  commands: string[]
): ActiveToken | null {
  const before = Array.from(line).slice(0, cursorColumn).join('')
  const commandMatch = /^\/([^\s]*)$/.exec(before)
  if (commandMatch && commands.length > 0) {
    const token = commandMatch[1]
    if (commands.some((command) => command.startsWith(token))) {
      return { kind: 'command', token, start: 0, length: token.length + 1 }
    }
  }
  const fileMatch = /(?:^|[\s("'=])@([^\s"'(),;]*)$/.exec(before)
  if (fileMatch) {
    const token = fileMatch[1] ?? ''
    const start = cursorColumn - token.length - 1
    return { kind: 'file', token, start, length: token.length + 1 }
  }
  return null
}

export function commandCandidates(token: string, commands: string[]): CompletionCandidate[] {
  return commands
    .filter((command) => command.startsWith(token))
    .slice(0, MAX_CANDIDATES)
    .map((command) => ({ value: command, kind: 'command' as const, directory: false }))
}

/**
 * File candidates with directory extension: for a token like `src/` we
 * list the next path segments inside src (directories end with `/`);
 * without a slash we filter on the last segment so `src/re` suggests
 * `src/readme.md`. Order follows the host-provided (already sorted,
 * already ignore-filtered) file list; duplicates collapse.
 */
export function fileCandidates(token: string, files: string[]): CompletionCandidate[] {
  const slash = token.lastIndexOf('/')
  const base = slash >= 0 ? token.slice(0, slash + 1) : ''
  const stem = slash >= 0 ? token.slice(slash + 1) : token
  const seen = new Map<string, CompletionCandidate>()
  const lowerStem = stem.toLowerCase()
  for (const file of files) {
    if (!file.startsWith(base)) continue
    const rest = file.slice(base.length)
    const nextSlash = rest.indexOf('/')
    if (nextSlash === -1) {
      // A file directly under the base.
      if (!rest.toLowerCase().startsWith(lowerStem)) continue
      if (!seen.has(base + rest)) seen.set(base + rest, { value: base + rest, kind: 'file', directory: false })
    } else {
      const directoryName = rest.slice(0, nextSlash)
      const key = base + directoryName + '/'
      if (!lowerStem || directoryName.toLowerCase().startsWith(lowerStem)) {
        if (!seen.has(key)) seen.set(key, { value: key, kind: 'file', directory: true })
      } else {
        // Also keep matching files deeper when the stem spans the directory,
        // e.g. token "src/a" should still find "src/a.ts" handled above;
        // anything else is skipped to keep the list cheap.
        continue
      }
    }
    if (seen.size >= MAX_CANDIDATES * 4) break
  }
  return [...seen.values()].slice(0, MAX_CANDIDATES)
}

/** Replace the active token with the chosen candidate value. */
export function applyCompletion(
  line: string,
  token: ActiveToken,
  candidate: CompletionCandidate
): string {
  const characters = Array.from(line)
  const inserted = (token.kind === 'command' ? '/' : '@') + candidate.value
  const before = characters.slice(0, token.start)
  const after = characters.slice(token.start + token.length)
  return before.join('') + inserted + after.join('')
}
