// Publishing state machine (SP009 design D-1).
//
// The orchestration lives here so that every branch is reachable from a test
// with an injected npm runner: the gate, the whitelist and secret scan, the
// isolated installation of the very same tarball, the upload, the receipt and
// the ledger update. The CLI entry stays in publish.mjs.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { smokeInstalled } from './smoke.mjs'
import { validateRelease } from './version.mjs'
import { waitForRegistryVersion } from './registry.mjs'
import {
  assertPackedFiles,
  scanForCredentials,
  tarballIntegrity
} from './tarball.mjs'
import {
  classifyRegistryFailure,
  validateChannel,
  validateReleaseNotes
} from './pipeline.mjs'

const registry = 'https://registry.npmjs.org'
const uploadStates = ['upload-started', 'uploaded-awaiting-receipt', 'registry-confirmed']

function localError(message) {
  return Object.assign(new Error(message), { kind: 'local' })
}

export async function runPublish({
  root,
  options,
  env = process.env,
  npm: npmRunner,
  smoke = smokeInstalled,
  waitForRegistry = waitForRegistryVersion,
  log = () => {}
}) {
  const { dryRun, tag, authMode, expectedVersion } = options
  const product = path.join(root, 'src', 'tui')
  let pkg
  try {
    pkg = JSON.parse(readFileSync(path.join(product, 'package.json'), 'utf8'))
  } catch (error) {
    return {
      report: {
        state: 'failed',
        failure: {
          kind: 'local',
          message: error.message,
          guidance: 'Fix the product manifest and rerun the release.'
        }
      },
      exitCode: 1
    }
  }
  const destination = path.join(
    root,
    'artifacts',
    'release',
    `${pkg.version}-${Date.now()}`
  )
  mkdirSync(destination, { recursive: true })
  const reportFile = path.join(destination, 'report.json')
  const ledgerFile = path.join(root, 'release-ledger.json')
  const report = {
    name: pkg.name,
    version: pkg.version,
    registry,
    tag,
    dryRun,
    state: 'checking',
    authMode,
    sourceCommit: env.GITHUB_SHA || null,
    workflowRun:
      authMode === 'oidc'
        ? `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : null,
    externalProvider: 'UNVERIFIED'
  }
  const save = () =>
    writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
  // Every registry facing npm call uses an explicit cache directory so the
  // release never depends on a writable user profile cache (and so a run can
  // be reproduced on a clean machine).
  const npmCall = (args, options = {}) =>
    npmRunner(args, {
      ...options,
      cache:
        env.BUDINGX_NPM_CACHE || path.join(destination, 'npm-cache')
    })
  const failure = (kind, message, guidance) => ({
    kind,
    message,
    guidance
  })
  save()
  try {
    if (expectedVersion !== undefined && expectedVersion !== pkg.version)
      throw localError('Expected version does not match src/tui/package.json')
    const ledger = JSON.parse(readFileSync(ledgerFile, 'utf8'))
    const entry = validateRelease(pkg, ledger, tag)
    report.iteration = entry.iteration
    const notes = readFileSync(
      path.join(root, 'release-notes', `v${pkg.version}.md`),
      'utf8'
    )
    validateReleaseNotes(notes, { version: pkg.version, tag })
    validateChannel({ version: pkg.version, tag, releaseNotes: notes })
    log(
      `Checking ${pkg.name}@${pkg.version} (${entry.iteration}) → ${registry} [${tag}]${dryRun ? ' DRY RUN' : ''}`
    )
    try {
      await npmRunner(['test'], { cwd: root, stdio: 'inherit' })
    } catch (error) {
      report.failure = failure(
        'gate',
        error.message,
        'Fix the failing check and rerun the same version; nothing was uploaded.'
      )
      save()
      return { report, exitCode: 1 }
    }
    const packOutput = JSON.parse(
      (
        await npmCall(
          [
            'pack',
            '--json',
            '--ignore-scripts',
            '--pack-destination',
            destination
          ],
          { cwd: product }
        )
      ).out
    )
    const packed = Array.isArray(packOutput)
      ? packOutput[0]
      : Object.values(packOutput)[0]
    const packedFiles = assertPackedFiles(packed)
    scanForCredentials(product, packedFiles)
    const tarball = path.join(destination, packed.filename)
    const integrity = tarballIntegrity(tarball)
    if (packed.integrity !== integrity)
      throw localError('Tarball integrity mismatch')
    const prefix = path.join(destination, 'installed')
    await npmCall(
      [
        'install',
        '--prefix',
        prefix,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        tarball
      ],
      { cwd: destination }
    )
    const shim = await npmCall(
      ['exec', '--offline', '--prefix', prefix, '--', 'budingx', '--version'],
      { cwd: destination }
    )
    if (shim.out.trim() !== pkg.version)
      throw localError('Installed npm command shim version mismatch')
    const smokeResult = await smoke(
      path.join(prefix, 'node_modules', 'budingx'),
      destination
    )
    Object.assign(report, {
      state: 'verified-local',
      integrity,
      tarball,
      files: packed.files.map((file) => file.path),
      smoke: smokeResult
    })
    save()
    if (dryRun) {
      report.state = 'dry-run-complete'
      save()
      log(`Dry run passed; no publication. Report: ${reportFile}`)
      return { report, exitCode: 0 }
    }
    if (authMode === 'session')
      await npmCall(
        ['whoami', '--registry', registry, '--fetch-retries', '0'],
        { cwd: destination }
      )
    let existing = false
    try {
      await npmCall(
        [
          'view',
          `${pkg.name}@${pkg.version}`,
          'version',
          '--json',
          '--registry',
          registry,
          '--fetch-retries',
          '0'
        ],
        { cwd: destination }
      )
      existing = true
    } catch (error) {
      const details = `${error.err || ''} ${error.message || ''}`
      if (!details.includes('E404'))
        throw error
    }
    if (existing)
      throw Object.assign(
        new Error(
          'Version already exists; verify remote receipt rather than uploading again'
        ),
        { code: 'EPUBLISHCONFLICT' }
      )
    report.state = 'upload-started'
    save()
    log(`Publishing verified tarball: ${pkg.name}@${pkg.version} [${tag}]`)
    await npmCall(
      [
        'publish',
        tarball,
        '--access',
        'public',
        '--tag',
        tag,
        '--ignore-scripts',
        '--registry',
        registry,
        '--fetch-retries',
        '0'
      ],
      { cwd: destination, stdio: 'inherit' }
    )
    report.state = 'uploaded-awaiting-receipt'
    save()
    const remote = await waitForRegistry(
      async () => {
        const output = (
          await npmCall(
            [
              'view',
              `${pkg.name}@${pkg.version}`,
              '--json',
              '--prefer-online',
              '--fetch-timeout=10000',
              '--registry',
              registry,
              '--fetch-retries',
              '0'
            ],
            { cwd: destination }
          )
        ).out.trim()
        return output ? JSON.parse(output) : null
      },
      pkg.version,
      {
        onPending: (attempt, attempts) =>
          log(
            `Upload accepted; waiting for npm visibility (${attempt}/${attempts})`
          )
      }
    )
    if (
      remote?.dist?.integrity !== integrity ||
      remote?.['dist-tags']?.[tag] !== pkg.version
    )
      throw localError(
        'Remote integrity/tag receipt is not confirmed; inspect before retrying'
      )
    report.state = 'registry-confirmed'
    save()
    const publicPrefix = path.join(destination, 'registry-install')
    await npmCall(
      [
        'install',
        '--prefix',
        publicPrefix,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        `${pkg.name}@${pkg.version}`,
        '--registry',
        registry,
        '--fetch-retries',
        '0'
      ],
      { cwd: destination }
    )
    const registryShim = await npmCall(
      [
        'exec',
        '--offline',
        '--prefix',
        publicPrefix,
        '--',
        'budingx',
        '--version'
      ],
      { cwd: destination }
    )
    if (registryShim.out.trim() !== pkg.version)
      throw localError('Registry installation command shim mismatch')
    report.registrySmoke = await smoke(
      path.join(publicPrefix, 'node_modules', 'budingx'),
      destination
    )
    const current = JSON.parse(readFileSync(ledgerFile, 'utf8'))
    const currentEntry = current.releases.find(
      (item) => item.version === pkg.version
    )
    if (!currentEntry)
      throw localError('Publication succeeded but ledger changed; inspect receipt')
    Object.assign(currentEntry, {
      status: 'published',
      publishedAt: new Date().toISOString(),
      registry,
      tag,
      integrity,
      sourceCommit: report.sourceCommit,
      workflowRun: report.workflowRun
    })
    writeFileSync(ledgerFile + '.tmp', JSON.stringify(current, null, 2) + '\n')
    renameSync(ledgerFile + '.tmp', ledgerFile)
    report.state = 'published-and-installed'
    save()
    log(
      `Published and installation verified: ${pkg.name}@${pkg.version}. Report: ${reportFile}`
    )
    return { report, exitCode: 0 }
  } catch (error) {
    const classified =
      error.kind === 'local'
        ? failure(
            'local',
            error.message,
            'Fix the reported problem and rerun the same version; nothing was published.'
          )
        : classifyRegistryFailure(error)
    const hint = uploadStates.includes(report.state)
      ? `Query the exact version with "npm run release:resolve -- --version ${pkg.version}" before deciding; never publish it again blindly.`
      : ''
    report.failure = {
      ...classified,
      message: hint ? `${classified.message} ${hint}` : classified.message,
      guidance: hint ? `${classified.guidance} ${hint}` : classified.guidance
    }
    save()
    log(
      `Release failed at ${report.state}: ${error.message}. Report: ${reportFile}`
    )
    return { report, exitCode: 1 }
  }
}
