import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FINAL_ITERATION, isPlannedIteration } from '../roadmap-scope.mjs'

export function bumpVersion(version, kind) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error('Expected a stable SemVer version')
  const values = version.split('.').map(Number)
  const index = ['major', 'minor', 'patch'].indexOf(kind)
  if (index < 0) throw new Error('Use major, minor or patch')
  values[index]++
  for (let i = index + 1; i < 3; i++) values[i] = 0
  return values.join('.')
}
export function validateRelease(pkg, ledger, tag) {
  if (pkg.name !== 'budingx' || pkg.private || pkg.license !== 'MIT')
    throw new Error('Expected the public MIT budingx product package')
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/.test(
      pkg.version
    )
  )
    throw new Error('Invalid product version')
  if (
    !/^[a-z][a-z0-9-]*$/.test(tag) ||
    (pkg.version.includes('-') && tag === 'latest')
  )
    throw new Error('Invalid channel; prereleases cannot target latest')
  if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.releases))
    throw new Error('Unsupported release ledger schema')
  const entries = ledger.releases.filter(
    (entry) => entry.version === pkg.version
  )
  if (entries.length !== 1 || entries[0].status !== 'prepared')
    throw new Error('Version requires exactly one prepared ledger entry')
  return entries[0]
}
export function prepareVersion(root, kind, iteration) {
  if (iteration !== 'bootstrap' && !isPlannedIteration(iteration))
    throw new Error(`Specify iteration as bootstrap or SP001–${FINAL_ITERATION}`)
  const pkgPath = path.join(root, 'src/tui/package.json')
  const ledgerPath = path.join(root, 'release-ledger.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  if (
    ledger.schemaVersion !== 1 ||
    ledger.releases.some((entry) => entry.status === 'prepared')
  )
    throw new Error(
      'Resolve existing prepared releases before preparing another'
    )
  if (
    !ledger.releases.some(
      (entry) => entry.version === pkg.version && entry.status === 'published'
    )
  )
    throw new Error('Current version must have a confirmed publication record')
  const sameIteration = ledger.releases.some(
    (entry) => entry.iteration === iteration
  )
  if (!sameIteration && kind === 'patch')
    throw new Error('A new iteration requires at least a minor version')
  const version = bumpVersion(pkg.version, kind)
  if (version === '1.0.0' && iteration !== FINAL_ITERATION)
    throw new Error(
      '1.0.0 requires the complete replacement milestone; review versioning.md'
    )
  if (ledger.releases.some((entry) => entry.version === version))
    throw new Error('Version already recorded')
  const notes = path.join(root, 'release-notes', `v${version}.md`)
  if (existsSync(notes)) throw new Error('Release notes already exist')
  mkdirSync(path.dirname(notes), { recursive: true })
  const originals = new Map([
    [pkgPath, readFileSync(pkgPath)],
    [ledgerPath, readFileSync(ledgerPath)]
  ])
  const outputs = [
    [
      notes,
      [
        `# v${version} · ${iteration}`,
        '',
        'Status: PREPARED — replace this draft with actual changes, verification and limitations.',
        '',
        '## 变更',
        '- （待填写）',
        '',
        '## 兼容性',
        '- （待填写）',
        '',
        '## 升级',
        '- （待填写）',
        '',
        '## 已知限制',
        '- （待填写）',
        '',
        '## 验证',
        '- （待填写）',
        ''
      ].join('\n')
    ],
    [pkgPath, JSON.stringify({ ...pkg, version }, null, 2) + '\n'],
    [
      ledgerPath,
      JSON.stringify(
        {
          ...ledger,
          releases: [
            ...ledger.releases,
            { version, iteration, status: 'prepared' }
          ]
        },
        null,
        2
      ) + '\n'
    ]
  ]
  try {
    for (const [file, value] of outputs) {
      writeFileSync(file + '.tmp', value)
      renameSync(file + '.tmp', file)
    }
  } catch (error) {
    for (const [file, value] of originals) writeFileSync(file, value)
    throw error
  }
  return version
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [kind, flag, iteration, ...extra] = process.argv.slice(2)
    if (flag !== '--iteration' || extra.length)
      throw new Error(
        'Usage: npm run version:prepare -- minor --iteration SP001'
      )
    console.log(
      'Prepared ' +
        prepareVersion(
          path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
          kind,
          iteration
        ) +
        '; review release notes before publishing'
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
