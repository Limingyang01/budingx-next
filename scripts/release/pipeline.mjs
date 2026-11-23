// Release decision layer (SP009 design D-1/D-2/D-5).
// Pure functions only: no file system, network or process access. The
// publishing orchestrator and the recovery command both depend on these
// rules so that channel policy, failure classification and release-note
// structure are decided in exactly one place.

const CHANNEL_PATTERN = /^[a-z][a-z0-9-]*$/
const PRERELEASE_PATTERN = /^\d+\.\d+\.\d+-[0-9A-Za-z][0-9A-Za-z.-]*$/

const REQUIRED_SECTIONS = [
  { key: '变更', aliases: ['变更', 'changes', 'what changed'] },
  { key: '兼容性', aliases: ['兼容性', 'compatibility'] },
  { key: '升级', aliases: ['升级', 'upgrade'] },
  { key: '已知限制', aliases: ['已知限制', '限制', 'limitations', 'known limitations'] },
  { key: '验证', aliases: ['验证', 'verification'] }
]

function failureText(error) {
  if (!error) return ''
  return [error.code, error.err, error.message, error.errcode]
    .filter(Boolean)
    .join(' ')
}

function headings(text) {
  const found = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^#{1,6}\s+(.*)$/.exec(line)
    if (match) found.push(match[1].trim().toLowerCase())
  }
  return found
}

/**
 * Channel policy (AC NP-06).
 * - the tag must be a lowercase npm channel name;
 * - prerelease versions may never take the latest channel;
 * - a stable version on a non-latest channel must declare it in the notes.
 */
export function validateChannel({ version, tag, releaseNotes = '' } = {}) {
  if (typeof tag !== 'string' || !CHANNEL_PATTERN.test(tag))
    throw new Error(
      'Invalid dist-tag; use a lowercase channel name such as latest or next'
    )
  const prerelease = PRERELEASE_PATTERN.test(version || '')
  if (prerelease && tag === 'latest')
    throw new Error('Prerelease versions cannot use the latest channel')
  if (!prerelease && tag !== 'latest') {
    const declared = new RegExp(`dist-tag:\\s*${tag}\\b`, 'i')
    if (!declared.test(releaseNotes || ''))
      throw new Error(
        `Channel ${tag} must be declared in the release notes as "dist-tag: ${tag}"`
      )
  }
  return { tag, prerelease }
}

/**
 * Registry failure classification (AC NP-05). The guidance never switches
 * registry, account or tag on the maintainer's behalf.
 */
export function classifyRegistryFailure(error) {
  const text = failureText(error)
  const kind = /E401|ENEEDAUTH|EOTP|EOTPREQUIRED|two-factor|2FA|need auth/i.test(
    text
  )
    ? 'auth'
    : /E403|EPERM|EACCES|do not have permission|permission to publish/i.test(
          text
        )
      ? 'permission'
      : /E409|EPUBLISHCONFLICT|already exists|cannot publish over/i.test(text)
        ? 'conflict'
        : /ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|E502|E503|socket hang up|network/i.test(
              text
            )
          ? 'network'
          : 'unknown'
  const guidance = {
    auth: 'Re-authenticate with npm login (including 2FA) and retry the same version; do not change the version number.',
    permission:
      'This account is not allowed to write this package. Ask the package owner for publish access; do not switch registry or account.',
    conflict:
      'This version or package name is already taken. Query the exact version first and never upload it again blindly.',
    network:
      'The registry is temporarily unreachable. Retry the query; do not republish blindly.',
    unknown:
      'Keep the report and the original error, then inspect the failure manually.'
  }[kind]
  return {
    kind,
    message: error?.message || 'Unknown registry failure',
    guidance
  }
}

/**
 * Release note structure (AC NP-08). Draft markers and missing sections
 * block the publishing gate.
 */
export function validateReleaseNotes(text, { version, tag } = {}) {
  if (typeof text !== 'string' || text.trim() === '')
    throw new Error('Release notes are missing')
  if (/replace this draft/i.test(text))
    throw new Error('Release notes are still a draft; replace the draft text')
  const found = headings(text)
  const missing = REQUIRED_SECTIONS.filter(
    (section) =>
      !section.aliases.some((alias) =>
        found.some((heading) => heading.includes(alias.toLowerCase()))
      )
  ).map((section) => section.key)
  if (missing.length > 0)
    throw new Error(
      `Release notes are missing required sections: ${missing.join(', ')}`
    )
  if (version && !text.includes(version))
    throw new Error(`Release notes do not mention version ${version}`)
  if (tag && tag !== 'latest') {
    const declared = new RegExp(`dist-tag:\\s*${tag}\\b`, 'i')
    if (!declared.test(text))
      throw new Error(
        `Release notes must declare the channel as "dist-tag: ${tag}"`
      )
  }
  return {
    sections: REQUIRED_SECTIONS.map((section) => section.key),
    missing: []
  }
}

/**
 * Remote state for an uncertain upload (AC NP-07). Read-only decision: it
 * never uploads, bumps a version or moves a dist-tag.
 */
export function classifyRemoteState({
  error,
  metadata,
  version,
  expectedIntegrity
} = {}) {
  if (metadata) {
    if (version && metadata.version !== version)
      return {
        state: 'mismatch',
        detail: `Registry reports version ${metadata.version}, expected ${version}`
      }
    const integrity = metadata.dist?.integrity
    if (expectedIntegrity && integrity !== expectedIntegrity)
      return {
        state: 'mismatch',
        detail: 'Registry integrity differs from the local tarball'
      }
    return { state: 'published', detail: 'Registry confirms this exact version' }
  }
  if (error) {
    const text = failureText(error)
    if (/E404|ETARGET|ENOVERSIONS|not found/i.test(text))
      return { state: 'not-published', detail: 'Registry has no such version' }
    return {
      state: 'unknown',
      detail: 'The registry query failed; retry the query before acting'
    }
  }
  return { state: 'unknown', detail: 'No registry answer was available' }
}
