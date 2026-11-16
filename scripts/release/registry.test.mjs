import assert from 'node:assert/strict'
import { test } from 'node:test'
import { waitForRegistryVersion } from './registry.mjs'
const pending = (code) =>
  Object.assign(new Error('not visible yet'), { err: `npm error code ${code}` })

test('post-upload verification waits for temporary npm visibility errors without uploading again', async () => {
  let calls = 0,
    delays = 0
  const value = await waitForRegistryVersion(
    async () => {
      calls++
      if (calls < 3) throw pending(calls === 1 ? 'E404' : 'ETARGET')
      return { version: '0.1.0' }
    },
    '0.1.0',
    {
      attempts: 3,
      sleep: async () => {
        delays++
      }
    }
  )
  assert.equal(value.version, '0.1.0')
  assert.equal(calls, 3)
  assert.equal(delays, 2)
})
test('empty or placeholder metadata does not count as the uploaded version', async () => {
  const values = [null, { version: '0.0.0-stage' }, { version: '0.1.0' }]
  const result = await waitForRegistryVersion(
    async () => values.shift(),
    '0.1.0',
    { attempts: 3, sleep: async () => {} }
  )
  assert.equal(result.version, '0.1.0')
})
test('authentication or malformed-response errors are not retried as propagation delays', async () => {
  for (const error of [
    pending('E401'),
    pending('E403'),
    new SyntaxError('malformed response')
  ]) {
    let calls = 0
    await assert.rejects(
      waitForRegistryVersion(
        async () => {
          calls++
          throw error
        },
        '0.1.0',
        { sleep: async () => {} }
      ),
      (candidate) => candidate === error
    )
    assert.equal(calls, 1)
  }
})
test('registry polling is bounded and tells the maintainer not to republish an accepted upload', async () => {
  let calls = 0
  await assert.rejects(
    waitForRegistryVersion(
      async () => {
        calls++
        throw pending('E404')
      },
      '0.1.0',
      { attempts: 2, sleep: async () => {} }
    ),
    /not publicly visible.*do not publish again/i
  )
  assert.equal(calls, 2)
})
