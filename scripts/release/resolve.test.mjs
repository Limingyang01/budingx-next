import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runResolve } from './resolve.mjs'

function fakeNpm(metadata) {
  const calls = []
  const runner = async (args) => {
    calls.push(args)
    if (metadata instanceof Error) throw metadata
    if (metadata === undefined) return { out: '', err: '' }
    return { out: JSON.stringify(metadata), err: '' }
  }
  runner.calls = calls
  return runner
}

test('a published version is reported without any write command', async () => {
  const npm = fakeNpm({
    version: '0.9.0',
    dist: { integrity: 'sha512-abc' }
  })
  const result = await runResolve({
    version: '0.9.0',
    integrity: 'sha512-abc',
    npm
  })
  assert.equal(result.state, 'published')
  assert.equal(result.exitCode, 0)
  const commands = npm.calls.map((args) => args[0])
  assert.deepEqual(commands, ['view'])
})

test('a missing version is reported as not published', async () => {
  const npm = fakeNpm(
    Object.assign(new Error('not found'), { code: 'E404', err: 'code E404' })
  )
  const result = await runResolve({ version: '0.9.0', npm })
  assert.equal(result.state, 'not-published')
  assert.equal(result.exitCode, 0)
  assert.match(result.guidance, /upload|publish/i)
})

test('a different remote integrity is reported as a mismatch and fails', async () => {
  const npm = fakeNpm({
    version: '0.9.0',
    dist: { integrity: 'sha512-other' }
  })
  const result = await runResolve({
    version: '0.9.0',
    integrity: 'sha512-abc',
    npm
  })
  assert.equal(result.state, 'mismatch')
  assert.equal(result.exitCode, 1)
})

test('a failing query is reported as unknown and fails', async () => {
  const npm = fakeNpm(
    Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
  )
  const result = await runResolve({ version: '0.9.0', npm })
  assert.equal(result.state, 'unknown')
  assert.equal(result.exitCode, 1)
  assert.match(result.guidance, /retry|query/i)
})

test('the version argument is required', async () => {
  const npm = fakeNpm({})
  await assert.rejects(
    runResolve({ npm }),
    /--version/
  )
  assert.equal(npm.calls.length, 0)
})
