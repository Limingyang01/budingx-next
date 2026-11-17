import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

test('CI 环境仍执行真实交互帧与光标断言', () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-ci-render-'))
  const files = ['screen-e2e.test.mjs', 'app.test.mjs'].map((name) =>
    fileURLToPath(new URL(name, import.meta.url))
  )
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== 'NODE_TEST_CONTEXT')
  )
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-reporter=tap',
      '--test-name-pattern=S11 首屏|方向键单独',
      ...files
    ],
    {
      env: { ...env, CI: 'true', HOME: home, USERPROFILE: home },
      encoding: 'utf8',
      timeout: 20000,
      maxBuffer: 2 * 1024 * 1024
    }
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /# pass 2/)
})
