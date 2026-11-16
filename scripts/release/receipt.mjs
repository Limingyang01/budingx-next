import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { npm } from './process.mjs'

export function applyReceipt(pkg, ledger, receipt, remote) {
  if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.releases))
    throw new Error('Unsupported ledger schema')
  if (
    receipt.state !== 'published-and-installed' ||
    receipt.registry !== 'https://registry.npmjs.org' ||
    receipt.name !== 'budingx' ||
    receipt.name !== pkg.name ||
    receipt.version !== pkg.version
  )
    throw new Error('Receipt does not confirm this product version')
  if (
    receipt.authMode !== 'oidc' ||
    !/^[a-f0-9]{40}$/.test(receipt.sourceCommit || '') ||
    !/^https:\/\/github\.com\/Limingyang01\/budingx-next\/actions\/runs\/\d+$/.test(
      receipt.workflowRun || ''
    )
  )
    throw new Error('Expected a GitHub OIDC publication receipt')
  if (
    !/^[a-z][a-z0-9-]*$/.test(receipt.tag || '') ||
    !receipt.integrity?.startsWith('sha512-') ||
    remote.name !== pkg.name ||
    remote.version !== pkg.version ||
    remote.dist?.integrity !== receipt.integrity
  )
    throw new Error('Registry version/integrity does not match receipt')
  const matches = ledger.releases.filter(
    (entry) => entry.version === pkg.version
  )
  if (
    matches.length !== 1 ||
    !['prepared', 'published'].includes(matches[0].status)
  )
    throw new Error('Expected exactly one prepared or confirmed ledger entry')
  if (
    matches[0].status === 'published' &&
    matches[0].integrity !== receipt.integrity
  )
    throw new Error('Existing publication receipt conflicts')
  return {
    ...ledger,
    releases: ledger.releases.map((entry) =>
      entry.version !== pkg.version
        ? entry
        : {
            ...entry,
            status: 'published',
            registry: receipt.registry,
            tag: receipt.tag,
            integrity: receipt.integrity,
            sourceCommit: receipt.sourceCommit,
            workflowRun: receipt.workflowRun
          }
    )
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [flag, input, ...extra] = process.argv.slice(2)
    if (flag !== '--receipt' || !input || extra.length)
      throw new Error(
        'Usage: npm run release:sync -- --receipt <downloaded-report.json>'
      )
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../..'
    )
    const pkg = JSON.parse(
      readFileSync(path.join(root, 'src/tui/package.json'), 'utf8')
    )
    const file = path.join(root, 'release-ledger.json')
    const ledger = JSON.parse(readFileSync(file, 'utf8'))
    const receipt = JSON.parse(readFileSync(path.resolve(input), 'utf8'))
    const remote = JSON.parse(
      (
        await npm([
          'view',
          `${pkg.name}@${pkg.version}`,
          '--json',
          '--registry=https://registry.npmjs.org',
          '--fetch-retries=0'
        ])
      ).out
    )
    const updated = applyReceipt(pkg, ledger, receipt, remote)
    writeFileSync(file + '.tmp', JSON.stringify(updated, null, 2) + '\n')
    renameSync(file + '.tmp', file)
    console.log(
      `Confirmed ${pkg.name}@${pkg.version}; review and commit release-ledger.json before preparing the next iteration`
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
