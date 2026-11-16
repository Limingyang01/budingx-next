import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyReceipt } from './receipt.mjs'

const pkg = { name: 'budingx', version: '0.1.0' }
const ledger = {
  schemaVersion: 1,
  custom: 'preserve',
  releases: [
    {
      version: '0.1.0',
      iteration: 'bootstrap',
      status: 'prepared',
      custom: 'preserve-entry'
    }
  ]
}
const receipt = {
  name: 'budingx',
  version: '0.1.0',
  state: 'published-and-installed',
  registry: 'https://registry.npmjs.org',
  tag: 'latest',
  authMode: 'oidc',
  sourceCommit: 'a'.repeat(40),
  workflowRun: 'https://github.com/Limingyang01/budingx-next/actions/runs/123',
  integrity: 'sha512-fixture'
}
const remote = {
  name: 'budingx',
  version: '0.1.0',
  dist: { integrity: 'sha512-fixture' }
}

test('a verified CI receipt updates the prepared version without losing unrelated fields', () => {
  const result = applyReceipt(pkg, ledger, receipt, remote)
  assert.equal(result.custom, 'preserve')
  assert.equal(result.releases[0].custom, 'preserve-entry')
  assert.equal(result.releases[0].status, 'published')
  assert.equal(result.releases[0].workflowRun, receipt.workflowRun)
  assert.equal(ledger.releases[0].status, 'prepared')
  assert.deepEqual(applyReceipt(pkg, result, receipt, remote), result)
})
test('failed, unrelated or mismatched registry receipts cannot unlock a version bump', () => {
  for (const change of [
    { state: 'upload-started' },
    { version: '0.2.0' },
    { registry: 'https://example.invalid' },
    { name: 'other' },
    { sourceCommit: '' },
    { workflowRun: 'https://example.invalid/run' }
  ]) {
    assert.throws(() =>
      applyReceipt(pkg, ledger, { ...receipt, ...change }, remote)
    )
  }
  assert.throws(() =>
    applyReceipt(pkg, ledger, receipt, {
      ...remote,
      dist: { integrity: 'sha512-wrong' }
    })
  )
  assert.throws(() =>
    applyReceipt(pkg, { ...ledger, schemaVersion: 2 }, receipt, remote)
  )
})
