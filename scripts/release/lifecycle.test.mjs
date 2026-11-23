import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { isolatedEnv, directoryBytes, writeLegacyFixture } from './lifecycle.mjs'

test('the legacy fixture looks like an older user data root', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'budingx-fixture-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const snapshot = writeLegacyFixture(home)
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'config.json',
    'credentials.json',
    'memory/notes.md',
    'sessions/legacy-session/transcript.jsonl'
  ])
  const config = JSON.parse(
    readFileSync(path.join(home, '.budingx', 'config.json'), 'utf8')
  )
  assert.equal(config.version, 0)
  assert.equal(config.model, 'legacy-model')
  assert.deepEqual(config.legacyFlag, { keep: true })
  const credentials = JSON.parse(
    readFileSync(path.join(home, '.budingx', 'credentials.json'), 'utf8')
  )
  assert.equal(credentials.keys.legacy, 'legacy-key')
  const transcript = readFileSync(
    path.join(home, '.budingx', 'sessions', 'legacy-session', 'transcript.jsonl'),
    'utf8'
  )
  const records = transcript
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
  assert.equal(records[0].type, 'session_started')
  assert.equal(records[0].sessionId, 'legacy-session')
  assert.equal(records[1].blocks[0].text, 'legacy question')
})

test('child processes are kept inside the isolated home', () => {
  const env = isolatedEnv('/tmp/isolated-home')
  assert.equal(env.HOME, '/tmp/isolated-home')
  assert.equal(env.USERPROFILE, '/tmp/isolated-home')
})

test('the fixture snapshot reacts to a changed user data root', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'budingx-fixture-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  writeLegacyFixture(home)
  const dataRoot = path.join(home, '.budingx')
  const before = directoryBytes(dataRoot)
  writeFileSync(path.join(dataRoot, 'config.json'), '{"changed":true}')
  const after = directoryBytes(dataRoot)
  assert.notDeepEqual(before, after)
})
