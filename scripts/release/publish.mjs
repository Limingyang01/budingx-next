import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { npm } from './process.mjs'
import { smokeInstalled } from './smoke.mjs'
import { validateRelease } from './version.mjs'
import { parseReleaseOptions, validatePublishContext } from './options.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const registry = 'https://registry.npmjs.org'
const options = parseReleaseOptions(process.argv.slice(2))
const { dryRun, tag, authMode, expectedVersion } = options
validatePublishContext(options, process.env)
const product = path.join(root, 'src/tui')
const pkg = JSON.parse(readFileSync(path.join(product, 'package.json'), 'utf8'))
if (expectedVersion !== undefined && expectedVersion !== pkg.version)
  throw new Error('Expected version does not match src/tui/package.json')
const ledgerFile = path.join(root, 'release-ledger.json')
const ledger = JSON.parse(readFileSync(ledgerFile, 'utf8'))
const entry = validateRelease(pkg, ledger, tag)
const notes = readFileSync(
  path.join(root, 'release-notes', `v${pkg.version}.md`),
  'utf8'
)
if (notes.includes('replace this draft'))
  throw new Error('Finish release notes before publishing')
const destination = path.join(
  root,
  'artifacts',
  'release',
  `${pkg.version}-${Date.now()}`
)
mkdirSync(destination, { recursive: true })
const reportFile = path.join(destination, 'report.json')
const report = {
  name: pkg.name,
  version: pkg.version,
  iteration: entry.iteration,
  registry,
  tag,
  dryRun,
  state: 'checking',
  authMode,
  sourceCommit: process.env.GITHUB_SHA || null,
  workflowRun:
    authMode === 'oidc'
      ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
  externalProvider: 'UNVERIFIED'
}
const save = () =>
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
const args = ['--registry', registry, '--fetch-retries', '0']
try {
  console.log(
    `Checking ${pkg.name}@${pkg.version} (${entry.iteration}) → ${registry} [${tag}]${dryRun ? ' DRY RUN' : ''}`
  )
  save()
  await npm(['test'], { cwd: root, stdio: 'inherit' })
  const packed = JSON.parse(
    (
      await npm(
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
  )[0]
  const allowed = new Set([
    'package.json',
    'README.md',
    'LICENSE',
    'dist/cli.js',
    'dist/config.js',
    'dist/provider.js'
  ])
  if (
    packed.files.length !== allowed.size ||
    packed.files.some((file) => !allowed.has(file.path))
  )
    throw new Error('Unexpected or missing files in product tarball')
  for (const file of packed.files) {
    const contents = readFileSync(path.join(product, file.path), 'utf8')
    if (
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|npm_[A-Za-z0-9]{30,}|sk-proj-[A-Za-z0-9_-]{25,}/.test(
        contents
      )
    )
      throw new Error('Possible credential in product package')
  }
  const tarball = path.join(destination, packed.filename)
  const integrity =
    'sha512-' +
    createHash('sha512').update(readFileSync(tarball)).digest('base64')
  if (packed.integrity !== integrity)
    throw new Error('Tarball integrity mismatch')
  const prefix = path.join(destination, 'installed')
  await npm(
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
  const shim = await npm(
    ['exec', '--offline', '--prefix', prefix, '--', 'budingx', '--version'],
    { cwd: destination }
  )
  if (shim.out.trim() !== pkg.version)
    throw new Error('Installed npm command shim version mismatch')
  const smoke = await smokeInstalled(
    path.join(prefix, 'node_modules/budingx'),
    destination
  )
  Object.assign(report, {
    state: 'verified-local',
    integrity,
    tarball,
    files: packed.files.map((file) => file.path),
    smoke
  })
  save()
  if (dryRun)
    console.log(`Dry run passed; no publication. Report: ${reportFile}`)
  else {
    if (authMode === 'session')
      await npm(['whoami', ...args], { cwd: destination })
    let existing = false
    try {
      await npm([
        'view',
        `${pkg.name}@${pkg.version}`,
        'version',
        '--json',
        ...args
      ])
      existing = true
    } catch (error) {
      if (!error.err?.includes('E404'))
        throw new Error('Cannot verify registry version availability')
    }
    if (existing)
      throw new Error(
        'Version already exists; verify remote receipt rather than uploading again'
      )
    report.state = 'upload-started'
    save()
    console.log(
      `Publishing verified tarball: ${pkg.name}@${pkg.version} [${tag}]`
    )
    await npm(
      [
        'publish',
        tarball,
        '--access',
        'public',
        '--tag',
        tag,
        '--ignore-scripts',
        ...args
      ],
      { cwd: destination, stdio: 'inherit' }
    )
    report.state = 'uploaded-awaiting-receipt'
    save()
    const remote = JSON.parse(
      (await npm(['view', `${pkg.name}@${pkg.version}`, '--json', ...args])).out
    )
    if (
      remote.dist?.integrity !== integrity ||
      remote['dist-tags']?.[tag] !== pkg.version
    )
      throw new Error(
        'Remote integrity/tag receipt is not confirmed; inspect before retrying'
      )
    report.state = 'registry-confirmed'
    save()
    const publicPrefix = path.join(destination, 'registry-install')
    await npm(
      [
        'install',
        '--prefix',
        publicPrefix,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        `${pkg.name}@${pkg.version}`,
        ...args
      ],
      { cwd: destination }
    )
    const registryShim = await npm(
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
      throw new Error('Registry installation command shim mismatch')
    report.registrySmoke = await smokeInstalled(
      path.join(publicPrefix, 'node_modules/budingx'),
      destination
    )
    const current = JSON.parse(readFileSync(ledgerFile, 'utf8'))
    const currentEntry = current.releases.find(
      (item) => item.version === pkg.version
    )
    if (!currentEntry)
      throw new Error(
        'Publication succeeded but ledger changed; inspect receipt'
      )
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
    console.log(
      `Published and installation verified: ${pkg.name}@${pkg.version}. Report: ${reportFile}`
    )
  }
} catch (error) {
  report.failure = error.message
  save()
  console.error(
    `Release failed at ${report.state}: ${error.message}. Receipt/report: ${reportFile}`
  )
  if (
    [
      'upload-started',
      'uploaded-awaiting-receipt',
      'registry-confirmed'
    ].includes(report.state)
  )
    console.error(
      'Remote state may already have changed. Query this exact version before retrying.'
    )
  process.exitCode = 1
}
