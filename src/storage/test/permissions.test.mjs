// Permission rule persistence tests (SP003 AC PC-07/PC-11, plan T11).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PermissionsStore, emptyPermissions } from '../../tui/dist/storage/permissions.js'

function makeFile() {
  const base = mkdtempSync(join(tmpdir(), 'budingx-perms-'))
  return { base, file: join(base, '.budingx', 'permissions.json') }
}

test('missing file loads as an empty rule set without corruption', () => {
  const env = makeFile()
  try {
    const store = new PermissionsStore(env.file)
    const loaded = store.load()
    assert.equal(loaded.corrupt, false)
    assert.deepEqual(loaded.file.rules, [])
    assert.equal(loaded.file.schemaVersion, 1)
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('save then load round-trips rules and keeps unknown fields', () => {
  const env = makeFile()
  try {
    const store = new PermissionsStore(env.file)
    store.save({
      schemaVersion: 1,
      rules: [
        { id: 'r-1', action: 'allow', tool: 'Write', path: 'src/**', futureField: 42 }
      ]
    })
    const loaded = store.load()
    assert.equal(loaded.corrupt, false)
    assert.equal(loaded.file.rules[0].id, 'r-1')
    assert.equal(loaded.file.rules[0].futureField, 42)
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('a corrupt file is backed up, reported, and never erased', () => {
  const env = makeFile()
  try {
    mkdirSync(join(env.file, '..'), { recursive: true })
    const original = '{ not json at all'
    writeFileSync(env.file, original)
    const store = new PermissionsStore(env.file)
    const loaded = store.load()
    assert.equal(loaded.corrupt, true)
    assert.match(loaded.corruptReason, /corrupt/)
    assert.deepEqual(loaded.file.rules, [])
    // 原文件保留，备份存在。
    assert.equal(readFileSync(env.file, 'utf8'), original)
    assert.equal(existsSync(env.file + '.bak'), true)
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('a newer schema is refused read-only without rewriting', () => {
  const env = makeFile()
  try {
    mkdirSync(join(env.file, '..'), { recursive: true })
    const content = JSON.stringify({ schemaVersion: 2, rules: [] })
    writeFileSync(env.file, content)
    const store = new PermissionsStore(env.file)
    const loaded = store.load()
    assert.equal(loaded.corrupt, true)
    assert.match(loaded.corruptReason, /newer than supported/)
    assert.equal(readFileSync(env.file, 'utf8'), content)
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('contentPrefix rules are refused with a clear message', () => {
  const env = makeFile()
  try {
    const store = new PermissionsStore(env.file)
    assert.throws(
      () =>
        store.save({
          schemaVersion: 1,
          rules: [{ id: 'r-1', action: 'allow', tool: 'Bash', contentPrefix: 'npm' }]
        }),
      /contentPrefix is not supported/
    )
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('invalid rule shapes are refused on save; on load the file is kept and no rules run', () => {
  const env = makeFile()
  try {
    const store = new PermissionsStore(env.file)
    assert.throws(
      () => store.save({ schemaVersion: 1, rules: [{ id: 'x', action: 'maybe', tool: 'Write' }] }),
      /action must be allow or deny/
    )
    assert.throws(
      () => store.save({ schemaVersion: 1, rules: [{ action: 'allow', tool: 'Write' }] }),
      /needs an id/
    )
    mkdirSync(join(env.file, '..'), { recursive: true })
    const broken = JSON.stringify({ schemaVersion: 1, rules: [{ id: 'x', action: 'allow' }] })
    writeFileSync(env.file, broken)
    const loaded = store.load()
    assert.equal(loaded.corrupt, true)
    assert.match(loaded.corruptReason, /invalid rule/)
    assert.deepEqual(loaded.file.rules, [])
    assert.equal(readFileSync(env.file, 'utf8'), broken)
  } finally {
    rmSync(env.base, { recursive: true, force: true })
  }
})

test('emptyPermissions is version 1 with no rules', () => {
  const file = emptyPermissions()
  assert.equal(file.schemaVersion, 1)
  assert.deepEqual(file.rules, [])
})
