// SP008 SH-01/SH-02：配置共享更新与跨进程锁（先 RED 后 GREEN）。
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ConfigStore, ConfigStoreError } from '../../tui/dist/storage/config-store.js'

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'budingx-config-lock-'))
  return join(dir, 'config.json')
}

test('update 在锁内重读-修改-原子写，返回最新配置', () => {
  const file = tempFile()
  const store = new ConfigStore(file)
  store.save({ version: 1, models: [] })

  const result = store.update((config) => {
    config.defaultModelId = 'profile-a'
    return config
  })
  assert.equal(result.defaultModelId, 'profile-a')

  const reloaded = new ConfigStore(file).load()
  assert.equal(reloaded.defaultModelId, 'profile-a')
  assert.equal(existsSync(file + '.lock'), false)
})

test('持有中的配置锁让 update 超时并以 BUDINGX_STORAGE_006 拒绝且不改文件', () => {
  const file = tempFile()
  const store = new ConfigStore(file)
  store.save({ version: 1, models: [], defaultModelId: 'keep' })
  const before = readFileSync(file, 'utf8')

  writeFileSync(file + '.lock', `${process.pid}\n${new Date().toISOString()}\n`, { mode: 0o600 })
  let error
  try {
    store.update((config) => {
      config.defaultModelId = 'overwritten'
      return config
    }, { timeoutMs: 120, retryDelayMs: 10 })
  } catch (caught) {
    error = caught
  }
  assert.ok(error instanceof ConfigStoreError, 'expected ConfigStoreError')
  assert.equal(error.code, 'BUDINGX_STORAGE_006')
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('陈旧锁（pid 已不存在）被清除后 update 成功', () => {
  const file = tempFile()
  const store = new ConfigStore(file)
  const deadPid = 2147483647
  writeFileSync(file + '.lock', `${deadPid}\n${new Date().toISOString()}\n`, { mode: 0o600 })

  const result = store.update((config) => {
    config.defaultModelId = 'after-stale'
    return config
  }, { timeoutMs: 500 })
  assert.equal(result.defaultModelId, 'after-stale')
  assert.equal(existsSync(file + '.lock'), false)
})

test('update 抛错时不保留锁文件与临时文件', () => {
  const file = tempFile()
  const store = new ConfigStore(file)
  store.save({ version: 1, models: [] })

  assert.throws(
    () =>
      store.update(() => {
        throw new Error('mutator failed')
      }),
    /mutator failed/
  )
  assert.equal(existsSync(file + '.lock'), false)
})
