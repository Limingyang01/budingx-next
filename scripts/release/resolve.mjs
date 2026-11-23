// Upload result resolution (SP009 design D-2).
//
// The command answers one question: is this exact version already on the
// registry? It is read-only on purpose - it never publishes, never moves a
// dist-tag, never bumps a version and never touches the ledger.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { npm } from './process.mjs'
import { classifyRemoteState } from './pipeline.mjs'

const registry = 'https://registry.npmjs.org'

const guidance = {
  published:
    'The version is public. Do not publish it again; finish the receipt and the ledger entry.',
  'not-published':
    'The registry has no such version. The release may still be uploaded once the gate passes.',
  mismatch:
    'The registry content differs from the local tarball. Stop and compare both artifacts manually.',
  unknown:
    'The registry could not be queried. Retry the query; do not upload blindly.'
}

export async function runResolve({
  version,
  integrity,
  npm: npmClient = npm,
  registry: target = registry,
  cache,
  log = () => {}
}) {
  if (!version)
    throw new Error('Usage: npm run release:resolve -- --version <version>')
  let metadata
  let error
  try {
    const output = (
      await npmClient(
        [
          'view',
          `budingx@${version}`,
          '--json',
          '--prefer-online',
          '--fetch-timeout=10000',
          '--registry',
          target,
          '--fetch-retries',
          '0'
        ],
        { cwd: process.cwd(), cache }
      )
    ).out.trim()
    metadata = output ? JSON.parse(output) : null
  } catch (failure) {
    error = failure
  }
  const outcome = classifyRemoteState({
    error,
    metadata,
    version,
    expectedIntegrity: integrity
  })
  const text = guidance[outcome.state] || guidance.unknown
  log(`${version}: ${outcome.state} - ${outcome.detail}`)
  log(text)
  return {
    state: outcome.state,
    detail: outcome.detail,
    guidance: text,
    exitCode: outcome.state === 'published' || outcome.state === 'not-published' ? 0 : 1
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2)
    const versionIndex = args.indexOf('--version')
    const integrityIndex = args.indexOf('--integrity')
    const version = versionIndex === -1 ? undefined : args[versionIndex + 1]
    const integrity =
      integrityIndex === -1 ? undefined : args[integrityIndex + 1]
    const result = await runResolve({
      version,
      integrity,
      log: (message) => console.log(message)
    })
    process.exitCode = result.exitCode
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
