import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import * as skills from '../dist/tui/skills.js'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'budingx-skill-loader-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const homeDir = join(root, 'home')
  const workspaceDir = join(root, 'repo', 'child')
  mkdirSync(join(root, 'repo', '.git'), { recursive: true })
  return {
    root,
    homeDir,
    workspaceDir,
    load: (name) => skills.findSkill(skills.discoverSkills({ homeDir, workspaceDir }), name)
  }
}

function writeSkill(base, name, body, meta = '') {
  const dir = join(base, '.budingx', 'skills', name)
  writeExample(join(dir, 'SKILL.md'), `---\nname: ${name}\n${meta}---\n${body}\n`)
  return dir
}

function writeExample(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

test('skill discovery keeps source precedence even when the winning skill disables a caller', (t) => {
  const { homeDir, workspaceDir, load } = fixture(t)
  writeSkill(homeDir, 'demo', 'user', 'disable-model-invocation: true\n')
  writeSkill(workspaceDir, 'demo', 'near')
  writeSkill(dirname(workspaceDir), 'demo', 'far')
  writeSkill(workspaceDir, 'skillify', 'near overrides built-in', 'user-invocable: false\n')
  writeSkill(dirname(workspaceDir), 'skillify', 'far')

  const user = load('DEMO')
  assert.equal(user.scope, 'user')
  assert.equal(user.meta?.disableModelInvocation, true)
  assert.deepEqual(skills.activateSkill(user, 'manual'), { ok: true, body: 'user' })
  assert.equal(skills.activateSkill(user, 'model').ok, false)

  const near = load('skillify')
  assert.equal(near.scope, 'project')
  assert.equal(near.meta?.userInvocable, false)
  assert.deepEqual(skills.activateSkill(near, 'model'), {
    ok: true,
    body: 'near overrides built-in'
  })
  assert.equal(skills.activateSkill(near, 'manual').ok, false)
})

test('rediscovery updates invocation flags and reads legacy declarations', (t) => {
  const { workspaceDir, load } = fixture(t)
  const dir = writeSkill(workspaceDir, 'demo', 'first')
  assert.equal(load('demo').meta, undefined)
  writeExample(
    join(dir, 'SKILL.md'),
    [
      'name: demo',
      'description: legacy skill',
      'disable-model-invocation: TRUE',
      'user-invocable: "false"',
      '',
      'second'
    ].join('\n')
  )
  const changed = load('demo')
  assert.equal(changed.body, 'second')
  assert.deepEqual(changed.meta, { userInvocable: false, disableModelInvocation: true })
  assert.equal(skills.activateSkill(changed, 'manual').ok, false)
  assert.equal(skills.activateSkill(changed, 'model').ok, false)
})

test('manual and model activation resolve the same root-relative text with the same tool restrictions', (t) => {
  const { workspaceDir, load } = fixture(t)
  const dir = writeSkill(
    workspaceDir,
    'demo',
    [
      'Run this check',
      '@./docs/check.md',
      '@"./notes with spaces.md"',
      '```text',
      '@./literal-example.md',
      '```',
      'After the examples'
    ].join('\n'),
    'allowed-tools: Read, Grep Read\n'
  )
  writeExample(join(dir, 'docs', 'check.md'), 'Steps\r\n@./final.md\r\n')
  writeExample(join(dir, 'final.md'), 'Finish here\n')
  writeExample(join(dir, 'notes with spaces.md'), 'Read these notes\n')
  const entry = load('demo')
  assert.equal(entry.meta.allowedTools, 'Read, Grep Read')
  const expected = {
    ok: true,
    body: 'Run this check\nSteps\nFinish here\nRead these notes\n```text\n@./literal-example.md\n```\nAfter the examples',
    allowedTools: ['Read', 'Grep']
  }
  assert.equal(typeof skills.activateSkill, 'function')
  assert.deepEqual(skills.activateSkill(entry, 'manual'), expected)
  assert.deepEqual(skills.activateSkill(entry, 'model'), expected)
})

test('an explicit empty allowlist restricts every tool', (t) => {
  const { workspaceDir, load } = fixture(t)
  writeSkill(workspaceDir, 'demo', 'instructions', 'allowed-tools: []\n')
  assert.equal(typeof skills.activateSkill, 'function')
  assert.deepEqual(skills.activateSkill(load('demo'), 'manual'), {
    ok: true,
    body: 'instructions',
    allowedTools: []
  })
})

test('resource errors include the importer and reference and leave no partial activation', (t) => {
  const { workspaceDir, load } = fixture(t)
  const dir = writeSkill(workspaceDir, 'demo', '@./rules.md', 'allowed-tools: Read\n')
  const missing = ['./missing.md', /无法读取|不存在/]
  const traversal = ['./sub/../../outside.md', /技能根|路径/]
  const absolute = ['/outside.md', /技能根|路径/]
  const drive = ['"C:\\outside.md"', /技能根|路径/]
  const cycle = ['./rules.md', /循环/]
  assert.equal(typeof skills.activateSkill, 'function')
  for (const [reference, reason] of [missing, traversal, absolute, drive, cycle]) {
    writeExample(join(dir, 'rules.md'), `@${reference}`)
    const result = skills.activateSkill(load('demo'), 'model')
    assert.deepEqual(Object.keys(result).sort(), ['error', 'ok'])
    assert.equal(result.ok, false)
    assert.ok(result.error.includes('rules.md'))
    assert.ok(result.error.includes(reference.replaceAll('"', '')))
    assert.match(result.error, reason)
  }
})

test('resource activation checks the real path of nested symlinks', (t) => {
  const { root, workspaceDir, load } = fixture(t)
  const dir = writeSkill(workspaceDir, 'demo', '@./link/file.md')
  const outside = join(root, 'outside')
  writeExample(join(outside, 'file.md'), 'outside details')
  symlinkSync(outside, join(dir, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(typeof skills.activateSkill, 'function')
  const result = skills.activateSkill(load('demo'), 'manual')
  assert.equal(result.ok, false)
  assert.match(result.error, /SKILL\.md:4 @\.\/link\/file\.md/)
  assert.match(result.error, /技能根|符号链接/)
  assert.doesNotMatch(result.error, /outside details/)
})

test('activation rejects oversized and malformed resources at the source', (t) => {
  const { workspaceDir, load } = fixture(t)
  const dir = writeSkill(workspaceDir, 'demo', '@./large.md')
  writeExample(join(dir, 'large.md'), 'a'.repeat(256 * 1024))
  assert.equal(typeof skills.activateSkill, 'function')
  const oversized = skills.activateSkill(load('demo'), 'manual')
  assert.equal(oversized.ok, false)
  assert.match(oversized.error, /large\.md.*上限/)
  writeExample(join(dir, 'large.md'), Buffer.from([0xff]))
  const binary = skills.activateSkill(load('demo'), 'manual')
  assert.equal(binary.ok, false)
  assert.match(binary.error, /large\.md.*UTF-8/)
})

test('nested resource activation permits five levels and rejects the sixth', (t) => {
  const { workspaceDir, load } = fixture(t)
  const dir = writeSkill(workspaceDir, 'demo', '@./1.md')
  for (let level = 1; level < 5; level++) {
    writeExample(join(dir, level + '.md'), '@./' + (level + 1) + '.md')
  }
  writeExample(join(dir, '5.md'), 'last level')
  assert.deepEqual(skills.activateSkill(load('demo'), 'manual'), { ok: true, body: 'last level' })
  writeExample(join(dir, '5.md'), '@./6.md')
  writeExample(join(dir, '6.md'), 'too deep')
  const result = skills.activateSkill(load('demo'), 'manual')
  assert.equal(result.ok, false)
  assert.match(result.error, /5\.md:1 @\.\/6\.md.*深度/)
})

test('the aggregate budget counts repeated imports alongside the skill text', (t) => {
  const { workspaceDir, load } = fixture(t)
  const dir = writeSkill(workspaceDir, 'demo', '@./fragment.md\n'.repeat(3))
  writeExample(join(dir, 'fragment.md'), 'a'.repeat(48 * 1024))
  const result = skills.activateSkill(load('demo'), 'manual')
  assert.equal(result.ok, false)
  assert.match(result.error, /fragment\.md.*总量/)
})

test('short repeated references cannot exceed the directive count limit', (t) => {
  const { workspaceDir, load } = fixture(t)
  const dir = writeSkill(workspaceDir, 'demo', '@./empty.md\n'.repeat(33))
  writeExample(join(dir, 'empty.md'), '')
  const result = skills.activateSkill(load('demo'), 'manual')
  assert.equal(result.ok, false)
  assert.match(result.error, /empty\.md.*32/)
})

test('an already discovered skill cannot load resources after its root is retargeted', (t) => {
  const { root, workspaceDir, load } = fixture(t)
  const dir = writeSkill(workspaceDir, 'demo', '@./rules.md')
  writeExample(join(dir, 'rules.md'), 'original rules')
  const entry = load('demo')
  renameSync(dir, dir + '-old')
  const redirected = join(root, 'redirected')
  writeExample(join(redirected, 'SKILL.md'), 'outside skill')
  writeExample(join(redirected, 'rules.md'), 'outside rules')
  symlinkSync(redirected, dir, process.platform === 'win32' ? 'junction' : 'dir')
  const result = skills.activateSkill(entry, 'manual')
  assert.equal(result.ok, false)
  assert.match(result.error, /rules\.md.*技能根/)
  assert.doesNotMatch(result.error, /outside rules/)
})
