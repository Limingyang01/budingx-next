import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from 'yaml'
import { RELEASE_OPTION_NAMES } from './options.mjs'
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

test('the workflow and the local entry use the same publishing command and options', () => {
  const commands = Object.values(workflow.jobs).flatMap((job) =>
    job.steps.map((step) => step.run).filter(Boolean)
  )
  const publishCommands = commands.filter((command) =>
    command.includes('npm run publish')
  )
  assert.equal(publishCommands.length, 2, 'verify and publish both publish locally')
  for (const command of publishCommands)
    assert.match(command, /npm run publish --/)
  const used = new Set()
  for (const command of publishCommands)
    for (const match of command.matchAll(/--[a-z-]+/g)) used.add(match[0])
  for (const option of used)
    assert.ok(
      RELEASE_OPTION_NAMES.includes(option) || option === '--dry-run',
      `${option} must be a supported release option`
    )
  const tagInput =
    workflow.on.workflow_dispatch.inputs.tag
  assert.deepEqual(tagInput.options, ['latest', 'next'])
  assert.equal(tagInput.default, 'latest')
})

test('the publishing job only runs through the OIDC identity and the master branch', () => {
  const publishStep = workflow.jobs.publish.steps.find((step) =>
    step.run?.includes('npm run publish')
  )
  assert.match(publishStep.run, /--auth-mode oidc/)
  assert.doesNotMatch(publishStep.run, /--dry-run/)
  assert.match(workflow.jobs.publish.if, /!inputs\.dry_run/)
})
