import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runLiveTask } from '../../../scripts/eval/lib/runner-core.mjs'
import { scriptedProvider, textEvents, toolCallEvents } from '../../../scripts/eval/lib/scenarios.mjs'
import { validateCheckpointTasks } from '../../../scripts/eval/lib/tasks.mjs'

test('CP-SET-v1 validates quotas and exact snapshot bytes', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sp010-task-set-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const quotas = { LOC: 2, FIX: 4, FEAT: 3, TST: 3, REF: 2, CTX: 2, CAN: 1, ADV: 1, PROT: 12 }
  let n = 0
  const tasks = Object.entries(quotas).flatMap(([category, count]) =>
    Array.from({ length: count }, (_, index) => {
      const suffix = String(index + 1).padStart(2, '0')
      const id = 'CP-' + category + '-' + suffix
      const fixture = join(root, 'scripts', 'eval', 'fixtures', id)
      mkdirSync(fixture, { recursive: true })
      writeFileSync(join(fixture, 'input.txt'), 'original')
      const sha256 = createHash('sha256').update('original').digest('hex')
      writeFileSync(join(fixture, 'snapshot.json'), JSON.stringify({ version: 1, files: { 'input.txt': sha256 } }))
      return {
        id, version: 1, group: category === 'PROT' ? 'protection' : 'coding_regression',
        category, language: 'TypeScript', repo_size: 'S', snapshot: 1, instruction: 'Test fixture',
        assertions: 'A', scope: { allow: [] }, deps: [], budget: category === 'PROT' ? 'P' : 'B',
        failure_class: 'assertion', blind: category !== 'PROT' && n++ < 10,
        source: category === 'PROT' ? 'PROT-' + suffix : 'TASK-B01',
        checks: [{ kind: 'file_exists', path: 'input.txt' }]
      }
    })
  )
  assert.deepEqual(validateCheckpointTasks(tasks, root).errors, [])

  const changed = structuredClone(tasks)
  delete changed[0].instruction
  changed[0].category = 'FIX'
  changed[0].blind = false
  changed.pop()
  writeFileSync(join(root, 'scripts', 'eval', 'fixtures', tasks[1].id, 'input.txt'), 'tampered')
  writeFileSync(join(root, 'scripts', 'eval', 'fixtures', tasks[2].id, 'unlisted.txt'), 'unlisted')
  const errors = validateCheckpointTasks(changed, root).errors.join('\n')
  for (const expected of [/instruction/, /LOC/, /blind/, /CP-PROT-12/, /SHA-256/, /unlisted[.]txt/]) {
    assert.match(errors, expected)
  }
})


test('live evaluation checks workspace files before cleanup', async () => {
  const scenario = {
    id: 'task-b07',
    instruction: 'Inspect the fixture',
    checks: [{ kind: 'file_exists', path: 'src/calc.js' }]
  }
  const options = { provider: scriptedProvider([textEvents('done')]) }
  assert.equal((await runLiveTask(scenario, options)).status, 'passed')
  scenario.checks = [{ kind: 'file_absent', path: 'src/calc.js' }]
  assert.equal((await runLiveTask(scenario, options)).status, 'failed')
})

test('live evaluation fails a token-budget termination despite passing assertions', async () => {
  const result = await runLiveTask({
    id: 'budget-fixture', instruction: 'Complete the task',
    checks: [{ kind: 'scope', allow: [] }]
  }, { provider: scriptedProvider([textEvents('done')]), budget: { maxTokens: 1 } })
  assert.equal(result.status, 'failed')
  assert.equal(result.failureClass, 'BUDGET')
  assert.equal(result.budgetExceeded, 'tokens')
})

test('live evaluation retains the provider outcome when verification exits zero', async () => {
  const result = await runLiveTask({
    id: 'provider-fixture', instruction: 'Complete the task',
    checks: [{ kind: 'scope', allow: [] }],
    verify: { commands: [[process.execPath, '-e', 'process.exit(0)']] }
  }, {
    provider: scriptedProvider([[{
      type: 'failed', error: { class: 'auth', code: 'fixture-auth', message: 'fixture', retryable: false }
    }]])
  })
  assert.equal(result.status, 'failed')
  assert.equal(result.commandExitCode, 0)
  assert.equal(result.outcome, 'error')
  assert.equal(result.error.class, 'auth')
})


test('the live coding budget supports more than eight model iterations', async () => {
  const scenario = {
    id: 'task-b07', instruction: 'Read the fixture',
    checks: [{ kind: 'outcome', outcome: 'completed' }, { kind: 'tool_result', name: 'Read', isError: false, min: 9 }]
  }
  const script = [
    ...Array.from({ length: 9 }, (_, index) =>
      toolCallEvents('read-' + index, 'Read', JSON.stringify({ path: 'src/calc.js' }))),
    textEvents('done')
  ]
  const result = await runLiveTask(scenario, { provider: scriptedProvider(script) })
  assert.equal(result.outcome, 'completed')
  assert.equal(result.requestCount, 10)
  assert.equal(result.status, 'passed')
  for (const [budget, resource] of [[{ maxTurns: 2 }, 'turns'], [{ maxRequests: 2 }, 'requests']]) {
    const limited = await runLiveTask(scenario, { provider: scriptedProvider(script), budget })
    assert.equal(limited.status, 'failed')
    assert.equal(limited.failureClass, 'BUDGET')
    assert.equal(limited.budgetExceeded, resource)
  }
})

test('the live wall-clock deadline aborts a stalled provider', async () => {
  const stopped = Promise.withResolvers()
  const provider = { async *stream({ signal }) {
    if (!signal.aborted) await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
    stopped.resolve()
  } }
  const result = await runLiveTask({
    id: 'timeout-fixture', instruction: 'Complete the task', checks: [{ kind: 'scope', allow: [] }]
  }, { provider, budget: { timeoutMs: 250 } })
  await stopped.promise
  assert.equal(result.status, 'failed')
  assert.equal(result.failureClass, 'BUDGET')
  assert.equal(result.budgetExceeded, 'wall-clock')
})


test('live execution uses task permission and approval without skipping denied turns', async () => {
  const command = 'node -e "console.log(17 * 23)"'
  const run = (permissionMode, approval, checks) => runLiveTask({
    id: 'exec-fixture', instruction: 'Run the fixture command', permissionMode, approval, checks
  }, {
    provider: scriptedProvider([
      toolCallEvents('exec-first', 'Bash', JSON.stringify({ command })),
      toolCallEvents('exec-second', 'Bash', JSON.stringify({ command })),
      textEvents('done')
    ])
  })
  const denied = await run('read_only', 'allow', [
    { kind: 'denial', tool: 'Bash' }
  ])
  assert.equal(denied.status, 'passed')

  const resumed = await run('workspace_edit', 'deny_then_allow', [
    { kind: 'denial', tool: 'Bash' },
    { kind: 'tool_result', name: 'Bash', isError: false, contains: '391' }
  ])
  assert.equal(resumed.status, 'passed', JSON.stringify(resumed.checks))
  assert.equal(resumed.requestCount, 3)
})
