// Distribution lifecycle gate (SP009 design D-3).
//
// Everything in this file runs outside the repository: the tarball is
// installed into a temporary prefix, the user data root is a temporary home,
// and the provider is a local fixture server. The gate answers four
// questions with real npm processes:
//
//   install  - does the published package work on a clean machine?
//   upgrade  - does an upgrade keep the user data and read old data?
//   uninstall- does uninstalling remove the package and keep the data?
//   rollback - can a previously published version be installed again?
import assert from 'node:assert/strict'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { npm, run } from './process.mjs'
import { smokeInstalled } from './smoke.mjs'
import { assertPackedFiles, scanForCredentials } from './tarball.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Keep every child process inside a temporary user home. */
export function isolatedEnv(home) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: '',
    HOMEPATH: ''
  }
}

function directoryBytes(directory) {
  const snapshot = {}
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      const key = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(full, key)
      else snapshot[key] = readFileSync(full).toString('base64')
    }
  }
  if (existsSync(directory)) walk(directory, '')
  return snapshot
}

async function packProduct({ productDir, destination, npm: npmClient, cache }) {
  mkdirSync(destination, { recursive: true })
  const output = JSON.parse(
    (
      await npmClient(
        [
          'pack',
          '--json',
          '--ignore-scripts',
          '--pack-destination',
          destination
        ],
        { cwd: productDir, cache }
      )
    ).out
  )
  const packed = Array.isArray(output) ? output[0] : Object.values(output)[0]
  const files = assertPackedFiles(packed)
  scanForCredentials(productDir, files)
  return { packed, files, tarball: path.join(destination, packed.filename) }
}

/**
 * Build the tarball of a previously published version from the current
 * sources. Only the manifest version differs, so the gate exercises the
 * installation and data paths instead of re-implementing an old release.
 */
async function packPreviousVersion({
  productDir,
  destination,
  version,
  npm: npmClient,
  cache
}) {
  const staging = path.join(destination, 'previous-product')
  mkdirSync(staging, { recursive: true })
  for (const entry of ['package.json', 'README.md', 'LICENSE', 'dist'])
    cpSync(path.join(productDir, entry), path.join(staging, entry), {
      recursive: true
    })
  const manifest = JSON.parse(
    readFileSync(path.join(staging, 'package.json'), 'utf8')
  )
  manifest.version = version
  writeFileSync(
    path.join(staging, 'package.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  )
  return packProduct({ productDir: staging, destination, npm: npmClient, cache })
}

async function installTarball({ prefix, tarball, npm: npmClient, cache }) {
  mkdirSync(prefix, { recursive: true })
  await npmClient(
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
    { cwd: prefix, cache }
  )
}

function installedPackage(prefix) {
  return path.join(prefix, 'node_modules', 'budingx')
}

/**
 * A user data root as it looked before the current release: a v0
 * configuration, credentials, one transcript and a project memory file.
 */
export function writeLegacyFixture(home) {
  const dataRoot = path.join(home, '.budingx')
  mkdirSync(path.join(dataRoot, 'sessions', 'legacy-session'), {
    recursive: true
  })
  mkdirSync(path.join(dataRoot, 'memory'), { recursive: true })
  writeFileSync(
    path.join(dataRoot, 'config.json'),
    JSON.stringify(
      {
        version: 0,
        baseUrl: 'https://legacy.invalid/v1',
        model: 'legacy-model',
        legacyFlag: { keep: true }
      },
      null,
      2
    ) + '\n'
  )
  writeFileSync(
    path.join(dataRoot, 'credentials.json'),
    JSON.stringify(
      {
        version: 1,
        keys: { legacy: 'legacy-key' },
        hosts: { legacy: 'https://legacy.invalid' }
      },
      null,
      2
    ) + '\n'
  )
  writeFileSync(
    path.join(dataRoot, 'sessions', 'legacy-session', 'transcript.jsonl'),
    [
      JSON.stringify({
        type: 'session_started',
        ts: '2026-01-01T00:00:00.000Z',
        schemaVersion: 1,
        sessionId: 'legacy-session',
        title: 'Legacy session'
      }),
      JSON.stringify({
        type: 'message',
        ts: '2026-01-01T00:00:01.000Z',
        id: 'm1',
        role: 'user',
        blocks: [{ type: 'text', text: 'legacy question' }]
      }),
      ''
    ].join('\n')
  )
  writeFileSync(
    path.join(dataRoot, 'memory', 'notes.md'),
    '# legacy memory\n'
  )
  return directoryBytes(dataRoot)
}

/** Read the legacy data with the installed product, not with the sources. */
async function readLegacyDataWithInstalledProduct(prefix, home) {
  const installed = installedPackage(prefix)
  const storeModule = await import(
    `file://${path.join(installed, 'dist', 'storage', 'session-store.js').replace(/\\/g, '/')}`
  )
  const configModule = await import(
    `file://${path.join(installed, 'dist', 'storage', 'config-store.js').replace(/\\/g, '/')}`
  )
  const store = storeModule.createSessionStore({ home })
  const sessions = store.list()
  const restored = store.restore('legacy-session')
  const configStore = new configModule.ConfigStore(
    path.join(home, '.budingx', 'config.json')
  )
  const before = configStore.load()
  const after = configStore.update((config) => config)
  return { sessions, restored, before, after }
}

export async function runInstall({
  root: projectRoot = root,
  npm: npmClient = npm,
  log = () => {}
} = {}) {
  const productDir = path.join(projectRoot, 'src', 'tui')
  const manifest = JSON.parse(
    readFileSync(path.join(productDir, 'package.json'), 'utf8')
  )
  const workspace = mkdtempSync(path.join(tmpdir(), 'budingx-install-'))
  const cache = path.join(workspace, 'npm-cache')
  const prefix = path.join(workspace, 'prefix')
  const home = path.join(workspace, 'home')
  mkdirSync(home, { recursive: true })
  const env = isolatedEnv(home)
  log(`packing ${manifest.name}@${manifest.version}`)
  const packed = await packProduct({
    productDir,
    destination: path.join(workspace, 'pack'),
    npm: npmClient,
    cache
  })
  await installTarball({ prefix, tarball: packed.tarball, npm: npmClient, cache })
  const installed = installedPackage(prefix)
  const installedManifest = JSON.parse(
    readFileSync(path.join(installed, 'package.json'), 'utf8')
  )
  assert.equal(installedManifest.version, manifest.version)
  const tree = readdirSync(path.join(prefix, 'node_modules')).sort()
  // Development tooling must not be needed at runtime. `@types/react` does
  // arrive through ink, so only the build-only packages are checked here.
  for (const development of ['typescript', '@types/node', 'yaml'])
    assert.ok(
      !tree.includes(development),
      `the installed package must not need ${development}`
    )
  for (const dependency of Object.keys(manifest.dependencies || {}))
    assert.ok(tree.includes(dependency), `missing runtime dependency ${dependency}`)
  const shipped = readdirSync(installed).sort()
  assert.deepEqual(shipped, ['LICENSE', 'README.md', 'dist', 'package.json'])
  const cli = path.join(installed, 'dist', 'tui', 'cli.js')
  const version = (
    await run(process.execPath, [cli, '--version'], { cwd: workspace, env })
  ).out.trim()
  assert.equal(version, manifest.version)
  const shim = await npmClient(
    ['exec', '--offline', '--prefix', prefix, '--', 'budingx', '--version'],
    { cwd: workspace, cache }
  )
  assert.equal(shim.out.trim(), manifest.version)
  const smoke = await smokeInstalled(installed, workspace, env)
  const evidence = {
    stage: 'install',
    version: manifest.version,
    files: packed.files,
    installedTree: tree,
    shimVersion: shim.out.trim(),
    smoke,
    workspace
  }
  log(`install gate passed for ${manifest.name}@${manifest.version}`)
  return evidence
}

export async function runUpgrade({
  root: projectRoot = root,
  npm: npmClient = npm,
  log = () => {}
} = {}) {
  const productDir = path.join(projectRoot, 'src', 'tui')
  const manifest = JSON.parse(
    readFileSync(path.join(productDir, 'package.json'), 'utf8')
  )
  const ledger = JSON.parse(
    readFileSync(path.join(projectRoot, 'release-ledger.json'), 'utf8')
  )
  const published = ledger.releases
    .filter((entry) => entry.status === 'published')
    .map((entry) => entry.version)
  // The upgrade gate compares the current sources with the newest published
  // release that is not the current version itself; before the next version
  // is prepared that is the same version, which the evidence records.
  const previous =
    published.filter((version) => version !== manifest.version).pop() ??
    published.pop()
  assert.ok(previous, 'a previously published version is required')
  const workspace = mkdtempSync(path.join(tmpdir(), 'budingx-upgrade-'))
  const cache = path.join(workspace, 'npm-cache')
  const prefix = path.join(workspace, 'prefix')
  const home = path.join(workspace, 'home')
  mkdirSync(home, { recursive: true })
  const env = isolatedEnv(home)
  const current = await packProduct({
    productDir,
    destination: path.join(workspace, 'pack-current'),
    npm: npmClient,
    cache
  })
  const older = await packPreviousVersion({
    productDir,
    destination: path.join(workspace, 'pack-previous'),
    version: previous,
    npm: npmClient,
    cache
  })
  await installTarball({ prefix, tarball: older.tarball, npm: npmClient, cache })
  const installedBefore = JSON.parse(
    readFileSync(path.join(installedPackage(prefix), 'package.json'), 'utf8')
  )
  assert.equal(installedBefore.version, previous)
  const fixture = writeLegacyFixture(home)
  await installTarball({ prefix, tarball: current.tarball, npm: npmClient, cache })
  const installedAfter = JSON.parse(
    readFileSync(path.join(installedPackage(prefix), 'package.json'), 'utf8')
  )
  assert.equal(installedAfter.version, manifest.version)
  const copies = readdirSync(path.join(prefix, 'node_modules')).filter(
    (entry) => entry === 'budingx'
  )
  assert.equal(copies.length, 1, 'exactly one installed copy must remain')
  const dataRoot = path.join(home, '.budingx')
  assert.deepEqual(
    directoryBytes(dataRoot),
    fixture,
    'installing a new version must not change the user data'
  )
  const legacy = await readLegacyDataWithInstalledProduct(prefix, home)
  assert.ok(
    legacy.sessions.some((session) => session.sessionId === 'legacy-session'),
    'the legacy session must still be listed'
  )
  assert.equal(legacy.restored.status, 'restored')
  assert.equal(legacy.restored.messages.length, 1)
  assert.equal(
    legacy.restored.messages[0].blocks[0].text,
    'legacy question'
  )
  assert.ok(
    legacy.after.models.some((model) => model.id === 'legacy'),
    'the legacy configuration must be migrated into a model profile'
  )
  assert.deepEqual(legacy.after.legacyFlag, { keep: true })
  // Reading the legacy configuration migrates it in place and keeps a backup;
  // that is product behaviour, so the uninstall comparison starts here.
  const migratedData = directoryBytes(dataRoot)
  await npmClient(
    ['uninstall', '--prefix', prefix, 'budingx', '--no-audit', '--no-fund'],
    { cwd: prefix, cache }
  )
  assert.ok(
    !existsSync(installedPackage(prefix)),
    'uninstall must remove the installed package'
  )
  assert.ok(
    !existsSync(path.join(prefix, 'node_modules', '.bin', 'budingx')),
    'uninstall must remove the command entry'
  )
  assert.deepEqual(
    directoryBytes(dataRoot),
    migratedData,
    'uninstall must keep the user data'
  )
  await installTarball({ prefix, tarball: older.tarball, npm: npmClient, cache })
  const rolledBack = (
    await run(
      process.execPath,
      [path.join(installedPackage(prefix), 'dist', 'tui', 'cli.js'), '--version'],
      { cwd: workspace, env }
    )
  ).out.trim()
  assert.equal(rolledBack, previous)
  const evidence = {
    stage: 'upgrade',
    from: previous,
    to: manifest.version,
    previousIsCurrent: previous === manifest.version,
    rolledBackTo: rolledBack,
    legacySessions: legacy.sessions.map((session) => session.sessionId),
    restoredStatus: legacy.restored.status,
    restoredMessages: legacy.restored.messages.length,
    migratedModels: legacy.after.models.map((model) => model.id),
    unknownFieldPreserved: legacy.after.legacyFlag,
    workspace
  }
  log(
    `upgrade gate passed: ${previous} → ${manifest.version}, rollback to ${previous} verified`
  )
  return evidence
}

function evidenceDirectory(projectRoot) {
  const directory = path.join(
    projectRoot,
    'artifacts',
    'release-lifecycle',
    new Date().toISOString().replace(/[:.]/g, '-')
  )
  mkdirSync(directory, { recursive: true })
  return directory
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const stageIndex = process.argv.indexOf('--stage')
  const stage = stageIndex === -1 ? 'all' : process.argv[stageIndex + 1]
  const projectRoot = root
  try {
    const evidence = []
    if (stage === 'install' || stage === 'all')
      evidence.push(
        await runInstall({ root: projectRoot, log: (m) => console.log(m) })
      )
    if (stage === 'upgrade' || stage === 'all')
      evidence.push(
        await runUpgrade({ root: projectRoot, log: (m) => console.log(m) })
      )
    const directory = evidenceDirectory(projectRoot)
    const file = path.join(directory, 'evidence.json')
    writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n')
    console.log(`lifecycle gate passed; evidence: ${file}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
