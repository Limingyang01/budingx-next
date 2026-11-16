import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync
} from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { bumpVersion, validateRelease, prepareVersion } from './version.mjs'

test('SemVer increments reset lower fields; invalid kinds/versions fail', () => {
  assert.equal(bumpVersion('0.1.2', 'minor'), '0.2.0')
  assert.equal(bumpVersion('0.1.2', 'patch'), '0.1.3')
  assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0')
  assert.throws(() => bumpVersion('1.2', 'patch'))
  assert.throws(() => bumpVersion('0.1.0', 'oops'))
})
test('release validates name, product license, channel and prepared ledger entry', () => {
  const pkg = { name: 'budingx', version: '0.1.0', license: 'MIT' }
  const ledger = {
    schemaVersion: 1,
    releases: [{ version: '0.1.0', iteration: 'bootstrap', status: 'prepared' }]
  }
  assert.equal(validateRelease(pkg, ledger, 'latest').iteration, 'bootstrap')
  assert.throws(() =>
    validateRelease({ ...pkg, private: true }, ledger, 'latest')
  )
  assert.throws(() =>
    validateRelease({ ...pkg, name: 'wrong' }, ledger, 'latest')
  )
  assert.throws(() =>
    validateRelease({ ...pkg, license: '' }, ledger, 'latest')
  )
  assert.throws(() =>
    validateRelease(pkg, { ...ledger, releases: [] }, 'latest')
  )
  assert.throws(() => validateRelease(pkg, ledger, '../bad'))
  const pre = { ...pkg, version: '0.2.0-beta.1' }
  const preLedger = {
    ...ledger,
    releases: [{ ...ledger.releases[0], version: pre.version }]
  }
  assert.throws(() => validateRelease(pre, preLedger, 'latest'))
  assert.equal(validateRelease(pre, preLedger, 'next').version, pre.version)
})

test('iteration preparation requires minor bump and preserves unknown ledger fields', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'budingx-version-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, 'src/tui'), { recursive: true })
  writeFileSync(
    path.join(root, 'src/tui/package.json'),
    JSON.stringify({ name: 'budingx', version: '0.1.0', custom: 'keep' })
  )
  writeFileSync(
    path.join(root, 'release-ledger.json'),
    JSON.stringify({
      schemaVersion: 1,
      custom: 'keep',
      releases: [
        { version: '0.1.0', iteration: 'bootstrap', status: 'published' }
      ]
    })
  )
  assert.throws(() => prepareVersion(root, 'patch', 'SP001'), /minor/)
  assert.throws(() => prepareVersion(root, 'minor', '../bad'), /iteration/)
  assert.equal(prepareVersion(root, 'minor', 'SP001'), '0.2.0')
  const pkg = JSON.parse(
    readFileSync(path.join(root, 'src/tui/package.json'), 'utf8')
  )
  const ledger = JSON.parse(
    readFileSync(path.join(root, 'release-ledger.json'), 'utf8')
  )
  assert.equal(pkg.custom, 'keep')
  assert.equal(ledger.custom, 'keep')
  assert.equal(ledger.releases.at(-1).iteration, 'SP001')
  assert.match(
    readFileSync(path.join(root, 'release-notes/v0.2.0.md'), 'utf8'),
    /SP001/
  )
  assert.throws(() => prepareVersion(root, 'minor', 'SP002'), /prepared/)
})
