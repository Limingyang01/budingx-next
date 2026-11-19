import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import { createHostSandboxFromEnvironment } from '../../tui/dist/exec/host-sandbox.js'
import { createCommandRunner } from '../../tui/dist/exec/runner.js'
import { createSandboxPolicy } from '../../tui/dist/exec/sandbox-policy.js'

test('Bubblewrap confirms immutable test input and rejects stale host evidence', {
  skip: process.env.BUDINGX_TEST_BUBBLEWRAP !== '1' && 'requires host Bubblewrap smoke opt-in',
  timeout: 45000
}, async (t) => {
  const backend = createHostSandboxFromEnvironment({ ...process.env, BUDINGX_SANDBOX: 'bubblewrap' })
  assert.ok(backend?.verified)
  const temp = realpathSync(tmpdir())
  const cwd = mkdtempSync(join(temp, 'sp004-bwrap-evidence-'))
  t.after(() => {
    assert.equal(dirname(realpathSync(cwd)), temp)
    assert.match(basename(cwd), /^sp004-bwrap-evidence-/)
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const input = join(cwd, 'sample.txt')
  const script = join(cwd, 'proof.test.sh')
  const eventHandlers = new Map()
  const runner = createCommandRunner({
    defaultCwd: cwd,
    sandboxPolicy: createSandboxPolicy({ backend }),
    onCommandFinished(event) { eventHandlers.get(event.callId)?.(event) }
  })
  t.after(() => runner.dispose())
  const run = (command, context = {}, background = false) =>
    runner.run({ command, interpreter: 'Bash', runInBackground: background }, {
      signal: new AbortController().signal, cwd, mode: 'workspace', ...context
    })
  writeFileSync(input, 'expected\n')
  writeFileSync(script, 'set -e\nprintf "edited\\n" > sample.txt\n')
  const writeAttempt = await run('bash proof.test.sh')
  assert.equal(writeAttempt.outcome, 'failed')
  assert.match(writeAttempt.stderr, /read-only/i)
  assert.equal(readFileSync(input, 'utf8'), 'expected\n')

  writeFileSync(script, 'test "$(cat sample.txt)" = expected\n')
  const ordinary = await run('printf "changed\\n" > sample.txt && printf "expected\\n" > sample.txt && bash proof.test.sh')
  assert.equal(ordinary.outcome, 'completed')
  assert.deepEqual(ordinary.testEvidence, { status: 'unavailable' })

  const trusted = await run('bash proof.test.sh')
  assert.equal(trusted.outcome, 'completed')
  assert.equal(trusted.testEvidence?.status, 'verified')
  assert.match(trusted.testEvidence.workspaceDigest, /^[a-f0-9]{64}$/)
  assert.equal(runner.isTestEvidenceCurrent(trusted.testEvidence), true)
  writeFileSync(input, 'external after terminal\n')
  assert.equal(runner.isTestEvidenceCurrent(trusted.testEvidence), false)

  writeFileSync(input, 'expected\n')
  const terminal = new Promise((resolve) => eventHandlers.set('bg', resolve))
  const background = await run('bash proof.test.sh', {
    callId: 'bg',
    onStarted() { writeFileSync(input, 'external before terminal\n') }
  }, true)
  assert.equal(background.outcome, 'running')
  const finished = await terminal
  assert.equal(finished.outcome, 'completed')
  assert.deepEqual(finished.testEvidence, { status: 'stale' })
  assert.deepEqual(runner.status(background.taskId).testEvidence, finished.testEvidence)
})
