import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const manifest = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
)
const cli = fileURLToPath(new URL('../dist/tui/cli.js', import.meta.url))
const configNames = ['BUDINGX_BASE_URL', 'BUDINGX_MODEL', 'BUDINGX_API_KEY']

function run(file, overrides = {}, production = false) {
  const dir = mkdtempSync(join(tmpdir(), 'budingx-local-start-'))
  if (file !== undefined) writeFileSync(join(dir, '.env.e2e.local'), file)
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !configNames.includes(name))
  )
  Object.assign(env, { HOME: dir, USERPROFILE: dir }, overrides)
  const [command, ...args] = manifest.scripts.start.split(/\s+/)
  assert.equal(command, 'node')
  return spawnSync(
    process.execPath,
    production ? [cli] : args.map((a) => (a === 'src/tui/dist/tui/cli.js' ? cli : a)),
    {
      cwd: dir,
      env,
      input: '/config\n/exit\n',
      encoding: 'utf8',
      timeout: 10000
    }
  )
}

test('本地 start 自动读取 e2e 模型配置且不回显密钥', () => {
  const result = run(
    'BUDINGX_BASE_URL=https://fixture.invalid/v1\nBUDINGX_MODEL=local-model\nBUDINGX_API_KEY=fixture-private-key\n'
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /local-model/)
  assert.match(result.stdout, /https:\/\/fixture.invalid\/v1/)
  assert.equal((result.stdout + result.stderr).includes('fixture-private-key'), false)
})

test('缺少本地文件时继续使用显式环境配置', () => {
  const result = run(undefined, {
    BUDINGX_MODEL: 'explicit-model',
    BUDINGX_BASE_URL: 'https://explicit.invalid/v1'
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /explicit-model/)
})

test('显式环境配置优先于本地文件', () => {
  const result = run('BUDINGX_MODEL=file-model\n', { BUDINGX_MODEL: 'explicit-model' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /explicit-model/)
  assert.equal(result.stdout.includes('file-model'), false)
})

test('正式产品入口不自动读取 cwd 的 e2e 文件', () => {
  const result = run(
    'BUDINGX_MODEL=should-not-load\nBUDINGX_API_KEY=fixture-private-key\n',
    {},
    true
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.includes('should-not-load'), false)
  assert.equal((result.stdout + result.stderr).includes('fixture-private-key'), false)
})
