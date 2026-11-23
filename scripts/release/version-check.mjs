// Version consistency check (SP009 design D-4).
//
// The product version lives in several places: the package manifest, the
// release ledger, the release notes and the user facing documents. This
// command only reports - it never rewrites a file.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function read(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

export async function runVersionCheck({
  root: projectRoot = root,
  log = () => {}
} = {}) {
  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok, detail })
  const manifest = JSON.parse(
    read(path.join(projectRoot, 'src', 'tui', 'package.json'))
  )
  const version = manifest.version
  const ledger = JSON.parse(
    read(path.join(projectRoot, 'release-ledger.json')) || '{"releases":[]}'
  )
  const entries = (ledger.releases || []).filter(
    (entry) => entry.version === version
  )
  add(
    'ledger',
    entries.length === 1 &&
      ['prepared', 'published'].includes(entries[0]?.status),
    entries.length === 1
      ? `ledger entry ${version} is ${entries[0].status}`
      : `ledger has ${entries.length} entries for ${version}`
  )
  const notesFile = path.join(
    projectRoot,
    'release-notes',
    `v${version}.md`
  )
  if (!existsSync(notesFile))
    add('release-notes', false, `release-notes/v${version}.md is missing`)
  else {
    const notes = readFileSync(notesFile, 'utf8')
    add(
      'release-notes',
      !/replace this draft/i.test(notes),
      /replace this draft/i.test(notes)
        ? `release-notes/v${version}.md is still a draft`
        : `release-notes/v${version}.md is written`
    )
  }
  const manual = read(path.join(projectRoot, 'PRODUCT.md'))
  add(
    'product-manual',
    manual.includes(version),
    manual.includes(version)
      ? `PRODUCT.md mentions ${version}`
      : `PRODUCT.md does not mention ${version}`
  )
  const published = (ledger.releases || [])
    .filter((entry) => entry.status === 'published')
    .map((entry) => entry.version)
    .pop()
  const declared = /已发布版本[^\n]*?(\d+\.\d+\.\d+)/.exec(manual)
  add(
    'published-version',
    Boolean(published) && declared?.[1] === published,
    published
      ? declared?.[1] === published
        ? `PRODUCT.md publishes ${published}`
        : `PRODUCT.md publishes ${declared?.[1] ?? 'nothing'} but the ledger publishes ${published}`
      : 'the ledger has no published version'
  )
  const readme = read(path.join(projectRoot, 'src', 'tui', 'README.md'))
  add(
    'readme',
    readme.includes(version),
    readme.includes(version)
      ? `src/tui/README.md mentions ${version}`
      : `src/tui/README.md does not mention ${version}`
  )
  const status = read(path.join(projectRoot, 'docs', 'current-status.md'))
  add(
    'current-status',
    status.includes(version),
    status.includes(version)
      ? `docs/current-status.md mentions ${version}`
      : `docs/current-status.md does not mention ${version}`
  )
  const engine = /(\d+\.\d+)/.exec(manifest.engines?.node ?? '')
  add(
    'node-engine',
    Boolean(engine) &&
      manual.includes(engine[1]) &&
      readme.includes(engine[1]),
    engine
      ? manual.includes(engine[1]) && readme.includes(engine[1])
        ? `Node.js ${engine[1]} is documented`
        : `Node.js ${engine[1]} is missing from PRODUCT.md or src/tui/README.md`
      : 'the manifest does not declare engines.node'
  )
  const failed = checks.filter((check) => !check.ok)
  for (const check of checks)
    log(`${check.ok ? 'OK  ' : 'FAIL'} ${check.id}: ${check.detail}`)
  if (failed.length > 0)
    log(
      `${failed.length} version consistency problem(s); fix the documents or run the version preparation again`
    )
  return {
    checks,
    version,
    published,
    exitCode: failed.length > 0 ? 1 : 0
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await runVersionCheck({ log: (message) => console.log(message) })
    process.exitCode = result.exitCode
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
