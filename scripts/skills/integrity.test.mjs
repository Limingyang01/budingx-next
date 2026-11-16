import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse } from 'yaml'
import {
  SKILLS,
  FAMILIES,
  canonicalPath,
  syncEntries
} from './sync-entries.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')

function filesIn(directory) {
  return readdirSync(path.join(root, directory), {
    withFileTypes: true
  }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`
    return entry.isDirectory() ? filesIn(file) : [file]
  })
}

test('every managed skill is discoverable through all generated entry families', () => {
  assert.deepEqual(syncEntries(root, { check: true }), [])
  assert.ok(SKILLS.includes('buding-npm-release'))
  assert.equal(SKILLS.length, 20)
  for (const family of FAMILIES) {
    for (const name of SKILLS) {
      const file = `${family}/skills/${name}/SKILL.md`
      const text = read(file)
      const metadata = parse(text.match(/^---\n([\s\S]*?)\n---\n/)[1])
      assert.equal(metadata.name, name)
      assert.ok(metadata.description.trim())
      assert.ok(text.includes(canonicalPath(name)))
      assert.ok(existsSync(path.join(root, canonicalPath(name))))
    }
  }
})

test('the licensed upstream snapshot retains every pinned byte and its license', () => {
  const manifest = JSON.parse(read('skills/superpowers/UPSTREAM.json'))
  assert.equal(manifest.repository, 'https://github.com/obra/superpowers')
  assert.equal(manifest.license, 'MIT')
  assert.match(
    read('skills/superpowers/LICENSE'),
    /Copyright \(c\) 2025 Jesse Vincent/
  )
  for (const [file, expected] of Object.entries(manifest.files)) {
    const actual = createHash('sha256')
      .update(readFileSync(path.join(root, 'skills/superpowers', file)))
      .digest('hex')
    assert.equal(
      actual,
      expected,
      `Upstream file changed or incomplete: ${file}`
    )
  }
})

test('project documentation, canonical workflows and discovery entries have existing local file links', () => {
  const project = SKILLS.filter((name) => !name.startsWith('superpowers-'))
  const candidates = [
    'README.md',
    'AGENTS.md',
    'CLAUDE.md',
    'THIRD-PARTY-NOTICES.md',
    'skills/README.md',
    ...filesIn('docs').filter((file) => file.endsWith('.md')),
    ...filesIn('SP').filter((file) => file.endsWith('.md')),
    ...project.flatMap((name) =>
      filesIn(`skills/${name}`).filter((file) => file.endsWith('.md'))
    ),
    ...FAMILIES.flatMap((family) =>
      SKILLS.map((name) => `${family}/skills/${name}/SKILL.md`)
    )
  ]
  const failures = []
  for (const file of candidates) {
    const text = read(file).replace(/```[\s\S]*?```/g, '')
    for (const match of text.matchAll(
      /!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g
    )) {
      const destination = match[1].replace(/^<|>$/g, '')
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(destination)) continue
      const relative = decodeURIComponent(destination.split('#')[0])
      if (
        relative &&
        !existsSync(path.resolve(root, path.dirname(file), relative))
      )
        failures.push(`${file} -> ${destination}`)
    }
  }
  assert.deepEqual(failures, [])
})

test('the migration manifest only claims development assets and Node maintenance remains private', () => {
  const manifest = JSON.parse(read('docs/migration/migration-manifest.json'))
  assert.equal(manifest.kind, 'development-assets-only')
  for (const entry of manifest.byte_copied) {
    assert.ok(
      entry.source.startsWith('skills/superpowers/') ||
        entry.source.startsWith('scripts/skills/'),
      entry.source
    )
  }
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.private, true)
  for (const command of ['skills:check', 'skills:sync', 'skills:test'])
    assert.ok(pkg.scripts[command])
  assert.equal(JSON.parse(read('src/tui/package.json')).name, 'budingx')
  for (const command of Object.values(pkg.scripts))
    assert.doesNotMatch(command, /\b(?:bun|bunx)\b/)
  const guide = read('docs/development.md')
  for (const match of guide.matchAll(/npm run ([\w:-]+)/g))
    assert.ok(
      pkg.scripts[match[1]],
      `Unimplemented command in developer guide: ${match[1]}`
    )
})
