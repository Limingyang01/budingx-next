import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  syncEntries,
  SKILLS,
  FAMILIES,
  canonicalPath,
} from './sync-entries.mjs'

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'buding-skills-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const name of SKILLS) {
    const dir = path.dirname(path.join(root, canonicalPath(name)))
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---\nname: ${name.startsWith('superpowers-') ? name.slice('superpowers-'.length) : name}\ndescription: Use when verifying ${name}.\n---\n\n# Test skill\n`,
    )
  }
  return root
}

test('generates all three entry families, resolves canonical references and is idempotent', (t) => {
  const root = fixture(t)
  assert.equal(syncEntries(root).length, SKILLS.length * FAMILIES.length)
  for (const family of FAMILIES) {
    for (const name of SKILLS) {
      const entry = path.join(root, family, 'skills', name, 'SKILL.md')
      const body = readFileSync(entry, 'utf8')
      const target = body.match(/\[正文\]\(([^)]+)\)/)[1]
      assert.equal(
        path.resolve(path.dirname(entry), target),
        path.join(root, canonicalPath(name)),
      )
      assert.ok(body.includes('Use when verifying'))
      assert.ok(!body.includes('# Test skill'))
    }
  }
  assert.deepEqual(syncEntries(root), [])
  assert.deepEqual(syncEntries(root, { check: true }), [])
})

test('check reports drift without creating or modifying entries', (t) => {
  const root = fixture(t)
  assert.throws(() => syncEntries(root, { check: true }), /out of date/)
  assert.equal(existsSync(path.join(root, '.agents')), false)
  syncEntries(root)
  const canonical = path.join(root, canonicalPath(SKILLS[0]))
  const entry = path.join(root, '.agents/skills', SKILLS[0], 'SKILL.md')
  const previous = readFileSync(entry, 'utf8')
  writeFileSync(
    canonical,
    readFileSync(canonical, 'utf8').replace('Use when', 'Updated when'),
  )
  assert.throws(() => syncEntries(root, { check: true }), /out of date/)
  assert.equal(readFileSync(entry, 'utf8'), previous)
})

test('missing canonical input fails before any output is written', (t) => {
  const root = fixture(t)
  rmSync(path.join(root, canonicalPath(SKILLS.at(-1))))
  assert.throws(() => syncEntries(root), /ENOENT/)
  assert.equal(existsSync(path.join(root, '.agents')), false)
})

test('does not overwrite a hand-written entry or touch unrelated skills', (t) => {
  const root = fixture(t)
  const owned = path.join(root, '.budingx/skills', SKILLS.at(-1), 'SKILL.md')
  mkdirSync(path.dirname(owned), { recursive: true })
  writeFileSync(owned, 'User instructions')
  const unrelated = path.join(root, '.agents/skills/other/SKILL.md')
  mkdirSync(path.dirname(unrelated), { recursive: true })
  writeFileSync(unrelated, 'Leave intact')
  assert.throws(() => syncEntries(root), /unmanaged entry/)
  assert.equal(readFileSync(owned, 'utf8'), 'User instructions')
  assert.equal(readFileSync(unrelated, 'utf8'), 'Leave intact')
  assert.equal(existsSync(path.join(root, '.agents/skills', SKILLS[0])), false)
})

test('rejects invalid metadata before writing', (t) => {
  const root = fixture(t)
  writeFileSync(
    path.join(root, canonicalPath(SKILLS[0])),
    '---\nname: other\ndescription: example\n---\n',
  )
  assert.throws(() => syncEntries(root), /metadata/)
  assert.equal(existsSync(path.join(root, '.agents')), false)
})
