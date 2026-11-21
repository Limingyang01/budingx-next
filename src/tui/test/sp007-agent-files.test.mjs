// SP007 T3 (SA-01/02): agent file discovery IO, override order, cache, save/delete.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadAgentDefinitions,
  invalidateAgentCache,
  saveAgentFile,
  deleteAgentFile
} from '../../tui/dist/tui/agents.js'

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'budingx-agents-'))
  const home = join(base, 'home')
  const root = join(base, 'repo')
  const cwd = join(root, 'packages', 'app')
  mkdirSync(join(home, '.budingx', 'agents'), { recursive: true })
  mkdirSync(join(root, '.git'), { recursive: true })
  mkdirSync(cwd, { recursive: true })
  mkdirSync(join(root, '.budingx', 'agents'), { recursive: true })
  return { base, home, root, cwd }
}

function writeAgent(dir, name, extra = '') {
  writeFileSync(join(dir, name + '.md'), '---\nname: ' + name + '\ndescription: ' + name + ' desc\n' + extra + '---\nBody of ' + name + '.\n')
}

test('discovery: built-in → user → project override; upward walk to git root', () => {
  const { base, home, root, cwd } = setup()
  try {
    const userDir = join(home, '.budingx', 'agents')
    const rootDir = join(root, '.budingx', 'agents')
    writeAgent(userDir, 'Explore', 'color: red\n')
    writeAgent(userDir, 'helper')
    writeAgent(rootDir, 'helper', 'color: blue\n')
    writeAgent(rootDir, 'root-only')
    const { agents, warnings } = loadAgentDefinitions({ cwd, home })
    assert.deepEqual(warnings, [])
    const byName = new Map(agents.map((a) => [a.name, a]))
    assert.equal(byName.get('Explore').source, 'user')
    assert.equal(byName.get('Explore').color, 'red')
    assert.equal(byName.get('helper').source, 'project')
    assert.equal(byName.get('helper').color, 'blue')
    assert.equal(byName.get('root-only').source, 'project')
    assert.ok(byName.get('general-purpose'))
    assert.ok(byName.get('Plan'))
  } finally {
    invalidateAgentCache()
    rmSync(base, { recursive: true, force: true })
  }
})

test('discovery: nearer project directory wins over git-root directory', () => {
  const { base, home, root, cwd } = setup()
  try {
    mkdirSync(join(cwd, '.budingx', 'agents'), { recursive: true })
    writeAgent(join(root, '.budingx', 'agents'), 'dup', 'color: red\n')
    writeAgent(join(cwd, '.budingx', 'agents'), 'dup', 'color: green\n')
    const { agents } = loadAgentDefinitions({ cwd, home })
    const dup = agents.find((a) => a.name === 'dup')
    assert.equal(dup.color, 'green')
    assert.equal(dup.filePath, join(cwd, '.budingx', 'agents', 'dup.md'))
  } finally {
    invalidateAgentCache()
    rmSync(base, { recursive: true, force: true })
  }
})

test('discovery: invalid file skipped with path warning; non-git cwd only local level', () => {
  const { base, home, root, cwd } = setup()
  try {
    const rootDir = join(root, '.budingx', 'agents')
    writeFileSync(join(rootDir, 'broken.md'), '---\nname: broken\n---\nno description')
    const { agents, warnings } = loadAgentDefinitions({ cwd, home })
    assert.ok(!agents.some((a) => a.name === 'broken'))
    assert.ok(warnings.some((w) => w.includes('broken.md')))
    // non-git directory: parent-level agents must NOT be discovered
    const plain = join(base, 'plain', 'sub')
    mkdirSync(join(base, 'plain', '.budingx', 'agents'), { recursive: true })
    mkdirSync(plain, { recursive: true })
    writeAgent(join(base, 'plain', '.budingx', 'agents'), 'parent-level')
    const local = loadAgentDefinitions({ cwd: plain, home })
    assert.ok(!local.agents.some((a) => a.name === 'parent-level'))
  } finally {
    invalidateAgentCache()
    rmSync(base, { recursive: true, force: true })
  }
})

test('cache: repeated load is cached until invalidateAgentCache', () => {
  const { base, home, cwd } = setup()
  try {
    const userDir = join(home, '.budingx', 'agents')
    const first = loadAgentDefinitions({ cwd, home })
    writeAgent(userDir, 'late')
    const second = loadAgentDefinitions({ cwd, home })
    assert.ok(!second.agents.some((a) => a.name === 'late'))
    invalidateAgentCache()
    const third = loadAgentDefinitions({ cwd, home })
    assert.ok(third.agents.some((a) => a.name === 'late'))
    assert.notEqual(first, second)
  } finally {
    invalidateAgentCache()
    rmSync(base, { recursive: true, force: true })
  }
})

test('save/delete: wx guard, locations, built-in protection, cache invalidation', async () => {
  const { base, home, root, cwd } = setup()
  try {
    const definition = { name: 'fresh', description: 'A "quoted" description', source: 'project', body: 'Do things.' }
    const path = await saveAgentFile({ location: 'project', cwd, home, definition })
    assert.equal(path, join(root, '.budingx', 'agents', 'fresh.md'))
    assert.ok(existsSync(path))
    assert.match(readFileSync(path, 'utf8'), /description: "A \\"quoted\\" description"/)
    await assert.rejects(() => saveAgentFile({ location: 'project', cwd, home, definition }))
    const loaded = loadAgentDefinitions({ cwd, home })
    assert.ok(loaded.agents.some((a) => a.name === 'fresh' && a.source === 'project'))
    const userPath = await saveAgentFile({ location: 'user', cwd, home, definition: { ...definition, name: 'personal', source: 'user' } })
    assert.equal(userPath, join(home, '.budingx', 'agents', 'personal.md'))
    const fresh = loadAgentDefinitions({ cwd, home }).agents.find((a) => a.name === 'fresh')
    await deleteAgentFile(fresh)
    assert.ok(!existsSync(path))
    assert.ok(!loadAgentDefinitions({ cwd, home }).agents.some((a) => a.name === 'fresh'))
    const builtIn = loadAgentDefinitions({ cwd, home }).agents.find((a) => a.name === 'Explore')
    await assert.rejects(() => deleteAgentFile(builtIn))
  } finally {
    invalidateAgentCache()
    rmSync(base, { recursive: true, force: true })
  }
})
