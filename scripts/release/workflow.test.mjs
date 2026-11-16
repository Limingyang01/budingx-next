import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from 'yaml'
const workflow = parse(
  readFileSync(
    new URL('../../.github/workflows/publish-tui.yml', import.meta.url),
    'utf8'
  )
)

test('release workflow is manual, dry by default, serial and read-only outside publish', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch'])
  assert.equal(workflow.on.workflow_dispatch.inputs.dry_run.default, true)
  assert.equal(workflow.permissions.contents, 'read')
  assert.equal(workflow.permissions['id-token'], undefined)
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert.deepEqual(
    workflow.jobs.verify.strategy.matrix.include.map((item) => item.os).sort(),
    ['ubuntu-24.04', 'windows-latest']
  )
})
test('the publishing identity is scoped to the named environment and master; actions are pinned', () => {
  const job = workflow.jobs.publish
  assert.equal(job.needs, 'verify')
  assert.equal(job.environment, 'npm-publish')
  assert.equal(job.permissions.contents, 'read')
  assert.equal(job.permissions['id-token'], 'write')
  assert.match(job.if, /!inputs.dry_run/)
  assert.match(job.if, /refs\/heads\/master/)
  const step = job.steps.find((item) => item.run?.includes('--auth-mode oidc'))
  assert.equal(step.env.NODE_AUTH_TOKEN, '')
  assert.equal(step.env.NPM_TOKEN, '')
  assert.match(step.run, /--expected-version "\$EXPECTED_VERSION"/)
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\./)
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps)
      if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/)
  }
})
