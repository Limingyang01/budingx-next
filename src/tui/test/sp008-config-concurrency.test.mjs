// SP008 SH-01/SH-02：两个真实进程并发更新共享配置。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ConfigStore } from '../../tui/dist/storage/config-store.js'

// 子进程 ESM 导入必须是 file:// URL（Windows 盘符路径会被拒绝）。
const storeUrl = new URL('../../tui/dist/storage/config-store.js', import.meta.url).href

function isolatedHome() {
  const home = mkdtempSync(join(tmpdir(), 'budingx-sp008-config-'))
  mkdirSync(join(home, '.budingx'), { recursive: true })
  return home
}

function childEnv(home) {
  return { ...process.env, HOME: home, USERPROFILE: home }
}

function runUpdate(home, body) {
  const script = `import { ConfigStore } from '${storeUrl}'; const store = new ConfigStore(); ${body}`
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: childEnv(home),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
  return new Promise((resolve) => {
    child.on('exit', (code) => resolve({ code, stderr }))
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('两个进程并发更新不同字段，两次更新都保留且文件合法', async () => {
  const home = isolatedHome()
  const configFile = join(home, '.budingx', 'config.json')
  writeFileSync(configFile, JSON.stringify({ version: 1, models: [] }))

  const setDefault = runUpdate(
    home,
    "store.update((c) => { c.defaultModelId = 'profile-a'; return c })"
  )
  const addModel = runUpdate(
    home,
    "store.update((c) => { c.models.push({ id: 'p1', label: 'p1', baseUrl: 'http://127.0.0.1:1/v1', model: 'fixture', apiKeyRef: 'p1', capabilities: { tools: true }, createdAt: '2026-11-21T00:00:00.000Z', updatedAt: '2026-11-21T00:00:00.000Z' }); return c })"
  )
  const [a, b] = await Promise.all([setDefault, addModel])
  assert.equal(a.code, 0, a.stderr)
  assert.equal(b.code, 0, b.stderr)

  const config = JSON.parse(readFileSync(configFile, 'utf8'))
  assert.equal(config.defaultModelId, 'profile-a')
  assert.equal(config.models.length, 1)
  assert.equal(existsSync(configFile + '.lock'), false)
  assert.equal(existsSync(configFile + '.tmp'), false)
})

test('活锁进程持有配置锁时更新超时并以 BUDINGX_STORAGE_006 拒绝；杀掉持锁进程后可继续', async () => {
  const home = isolatedHome()
  const configFile = join(home, '.budingx', 'config.json')
  writeFileSync(configFile, JSON.stringify({ version: 1, models: [], defaultModelId: 'keep' }))
  const lockFile = configFile + '.lock'

  const holder = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { ConfigStore } from '${storeUrl}'; const store = new ConfigStore(); store.update((c) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000); c.defaultModelId = 'child'; return c }); `
    ],
    { env: childEnv(home), stdio: 'ignore' }
  )
  try {
    for (let i = 0; i < 100 && !existsSync(lockFile); i++) await sleep(20)
    assert.ok(existsSync(lockFile), 'holder should own the config lock')

    const store = new ConfigStore(configFile)
    let error
    try {
      store.update((c) => {
        c.defaultModelId = 'parent'
        return c
      }, { timeoutMs: 200, retryDelayMs: 10 })
    } catch (caught) {
      error = caught
    }
    assert.equal(error?.code, 'BUDINGX_STORAGE_006')
    assert.equal(JSON.parse(readFileSync(configFile, 'utf8')).defaultModelId, 'keep')

    holder.kill('SIGKILL')
    await new Promise((resolve) => holder.once('exit', resolve))
    assert.ok(existsSync(lockFile), 'crashed holder leaves a stale lock')

    const updated = store.update((c) => {
      c.defaultModelId = 'recovered'
      return c
    }, { timeoutMs: 2000, retryDelayMs: 20 })
    assert.equal(updated.defaultModelId, 'recovered')
    assert.equal(existsSync(lockFile), false)
  } finally {
    if (holder.exitCode === null) holder.kill('SIGKILL')
  }
})
