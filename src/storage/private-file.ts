// Private file helpers (SP005 design §5). Every file budingx writes under
// ~/.budingx that may hold conversation content or project notes is created
// with owner-only permissions. On Windows the ACL is restricted to the current
// user; on POSIX the mode is 0600. Nothing here ever touches ~/.claude.
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { dataRoot } from './paths.js'

/** Owner-only mode for files on POSIX. */
export const PRIVATE_FILE_MODE = 0o600
/** Owner-only mode for directories on POSIX. */
export const PRIVATE_DIR_MODE = 0o700

/**
 * Create a directory (and parents) that only the current user can enter.
 */
export function ensurePrivateDirectory(directory: string): string {
  mkdirSync(directory, { recursive: true, mode: PRIVATE_DIR_MODE })
  try {
    chmodSync(directory, PRIVATE_DIR_MODE)
  } catch {
    // A filesystem without POSIX modes must not fail the write; the Windows
    // ACL pass below is the real protection there.
  }
  restrictToOwner(directory, { directory: true })
  return directory
}

/**
 * Write a file with owner-only permissions, creating parent directories.
 */
export function writePrivateFile(file: string, content: string): void {
  ensurePrivateDirectory(dirname(file))
  writeFileSync(file, content, { mode: PRIVATE_FILE_MODE })
  try {
    chmodSync(file, PRIVATE_FILE_MODE)
  } catch {
    // See ensurePrivateDirectory: best effort on POSIX.
  }
  restrictToOwner(file)
}

/**
 * Append one line to a private file without rewriting it (JSONL transcript).
 * The file is created owner-only when missing.
 */
export function appendPrivateLine(file: string, line: string): void {
  ensurePrivateDirectory(dirname(file))
  if (!existsSync(file)) {
    writePrivateFile(file, '')
  }
  const handle = openSync(file, 'a')
  try {
    appendFileSync(handle, line)
    fsyncSync(handle)
  } finally {
    closeSync(handle)
  }
}

/**
 * SID of the current user, or undefined when it cannot be determined.
 * whoami on MSYS shells resolves to the POSIX binary, so the Windows SID is
 * read through PowerShell instead of `whoami /user`.
 */
let cachedSid: string | undefined
let sidResolved = false

function ownerSid(): string | undefined {
  if (sidResolved) return cachedSid
  sidResolved = true
  const attempts: { command: string; args: string[] }[] = [
    {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-Command',
        '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'
      ]
    },
    { command: 'whoami.exe', args: ['/user', '/fo', 'csv', '/nh'] }
  ]
  for (const attempt of attempts) {
    try {
      const output = execFileSync(attempt.command, attempt.args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      })
      const match = output.match(/S-1-\d+(?:-\d+)+/)
      if (match) {
        cachedSid = match[0]
        return cachedSid
      }
    } catch {
      // Try the next strategy; ACL tightening stays best effort.
    }
  }
  return undefined
}

/**
 * Restrict a path to the current user on Windows: drop inheritance and grant
 * only the owning SID. On POSIX the mode bits already did the job. Failures
 * are tolerated; the file still lives under the private ~/.budingx root.
 */
export function restrictToOwner(target: string, options: { directory?: boolean } = {}): void {
  if (process.platform !== 'win32') return
  const sid = ownerSid()
  if (!sid) return
  // A directory needs (OI)(CI) so children inherit the grant; a file must not
  // carry the container flags, otherwise the file itself ends up with an
  // invalid ACE and can no longer be reopened.
  const rights = options.directory ? '(OI)(CI)F' : 'F'
  try {
    execFileSync('icacls', [target, '/inheritance:r', '/grant:r', `*${sid}:${rights}`], {
      stdio: 'ignore'
    })
  } catch {
    // Best effort only.
  }
}

/** True when the path exists and is a regular file. */
export function isRegularFile(file: string): boolean {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/** Read a private file, returning undefined when it does not exist. */
export function readPrivateFile(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Directory of a session's private data: ~/.budingx/sessions/<sessionId>.
 * It holds transcript.jsonl, meta.json, writer.lock and tasks/.
 */
export function sessionDirectory(sessionId: string, home?: string): string {
  return join(dataRoot(home), 'sessions', sessionId)
}
