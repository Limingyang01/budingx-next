import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseReleaseOptions, validatePublishContext } from './options.mjs'

const github = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'Limingyang01/budingx-next',
  GITHUB_REF: 'refs/heads/master',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_WORKFLOW_REF:
    'Limingyang01/budingx-next/.github/workflows/publish-tui.yml@refs/heads/master',
  RUNNER_ENVIRONMENT: 'github-hosted',
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/oidc',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture-not-a-real-token'
}

test('release options preserve local dry-run and require explicit valid argument values', () => {
  assert.deepEqual(parseReleaseOptions([]), {
    dryRun: false,
    tag: 'latest',
    authMode: 'session',
    expectedVersion: undefined
  })
  assert.deepEqual(
    parseReleaseOptions([
      '--dry-run',
      '--tag',
      'next',
      '--auth-mode',
      'oidc',
      '--expected-version',
      '0.2.0-beta.1'
    ]),
    {
      dryRun: true,
      tag: 'next',
      authMode: 'oidc',
      expectedVersion: '0.2.0-beta.1'
    }
  )
  for (const args of [
    ['--tag'],
    ['--auth-mode', 'token'],
    ['--expected-version', '../bad'],
    ['--unknown']
  ]) {
    assert.throws(() => parseReleaseOptions(args))
  }
})
test('OIDC mode requires the exact manual master workflow and hosted runner', () => {
  const options = parseReleaseOptions([
    '--auth-mode',
    'oidc',
    '--expected-version',
    '0.1.0'
  ])
  assert.doesNotThrow(() => validatePublishContext(options, github))
  for (const [key, value] of [
    ['GITHUB_REPOSITORY', 'someone/fork'],
    ['GITHUB_REF', 'refs/heads/feature/test'],
    ['GITHUB_EVENT_NAME', 'pull_request'],
    [
      'GITHUB_WORKFLOW_REF',
      'Limingyang01/budingx-next/.github/workflows/other.yml@refs/heads/master'
    ],
    ['RUNNER_ENVIRONMENT', 'self-hosted'],
    ['ACTIONS_ID_TOKEN_REQUEST_TOKEN', ''],
    ['ACTIONS_ID_TOKEN_REQUEST_URL', '']
  ])
    assert.throws(
      () => validatePublishContext(options, { ...github, [key]: value }),
      key
    )
  assert.throws(
    () =>
      validatePublishContext(
        { ...options, expectedVersion: undefined },
        github
      ),
    /version/i
  )
  assert.throws(
    () =>
      validatePublishContext(options, {
        ...github,
        NODE_AUTH_TOKEN: 'fixture'
      }),
    /token/i
  )
  assert.throws(
    () => validatePublishContext(options, { ...github, NPM_TOKEN: 'fixture' }),
    /token/i
  )
})
test('CI cannot accidentally fall back to a locally authenticated publishing session', () => {
  assert.throws(
    () => validatePublishContext(parseReleaseOptions([]), github),
    /OIDC/i
  )
  assert.doesNotThrow(() =>
    validatePublishContext(parseReleaseOptions(['--dry-run']), github)
  )
  assert.doesNotThrow(() => validatePublishContext(parseReleaseOptions([]), {}))
})

test('an incorrect expected version stops the real release entry before packing or uploading', () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('./publish.mjs', import.meta.url)),
      '--dry-run',
      '--expected-version',
      '999.999.999'
    ],
    { encoding: 'utf8' }
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Expected version does not match/)
  assert.doesNotMatch(result.stdout, /Publishing verified tarball/)
})
