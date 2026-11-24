import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  loadProjectInstructions,
  loadProjectInstructionsSync,
  PROJECT_INSTRUCTION_FILE_LIMIT,
  PROJECT_INSTRUCTION_TOTAL_LIMIT
} from '../dist/tui/project-instructions.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'budingx-rules-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const homeDir = join(root, 'home')
  const workspaceDir = join(root, 'workspace')
  await mkdir(homeDir)
  await mkdir(workspaceDir)
  const write = async (rootDir, path, content) => {
    const file = join(rootDir, path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, content)
    return file
  }
  return { root, homeDir, workspaceDir, maxAncestorLevels: 0, write }
}

test('AC-RULES-01 expands Markdown leaf references and recursively resolves paths relative to their source', async (t) => {
  const { workspaceDir, write, ...options } = await fixture(t)
  const root = await write(workspaceDir, 'AGENTS.md', [
    'ROOT-RULE',
    '',
    '- **@./rules/one.md**',
    '- @./rules/with\\ space.md',
    '- [@./label.md](./@./destination.md)',
    '',
    '`@inline.md`',
    '\\@escaped.md',
    '',
    '```md',
    '@fenced.md',
    '```',
    '',
    '    @indented.md',
    '',
    '@import one.md',
    '@import **one.md**',
    'owner@example.md'
  ].join('\n'))
  const one = await write(workspaceDir, 'rules/one.md', '> ONE-RULE @nested/two.md')
  const two = await write(workspaceDir, 'rules/nested/two.md', 'TWO-RULE')
  const withSpace = await write(workspaceDir, 'rules/with space.md', 'FILE-WITH-SPACE')
  const label = await write(workspaceDir, 'label.md', 'LINK-LABEL-RULE')
  for (const file of ['inline.md', 'escaped.md', 'fenced.md', 'indented.md', 'import', 'example.md', 'destination.md']) {
    await write(workspaceDir, file, 'UNEXPECTED-IMPORT')
  }
  const input = { ...options, workspaceDir }
  const result = await loadProjectInstructions(input)
  assert.deepEqual(result.files, [two, one, withSpace, label, root])
  assert.match(result.content, /TWO-RULE[\s\S]+ONE-RULE[\s\S]+FILE-WITH-SPACE[\s\S]+LINK-LABEL-RULE[\s\S]+ROOT-RULE/)
  assert.doesNotMatch(result.content, /UNEXPECTED-IMPORT/)
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(loadProjectInstructionsSync(input), result)
})

test('AC-RULES-01 only adds the selected directory’s rule ancestry and refreshes edits', async (t) => {
  const { workspaceDir, write, ...options } = await fixture(t)
  const root = await write(workspaceDir, 'AGENTS.md', 'ROOT-RULE')
  const parent = await write(workspaceDir, 'src/AGENTS.md', 'SRC-RULE')
  const child = await write(workspaceDir, 'src/red/AGENTS.md', 'RED-RULE @local.md')
  const imported = await write(workspaceDir, 'src/red/local.md', 'RED-LOCAL')
  const sibling = await write(workspaceDir, 'src/blue/AGENTS.md', 'BLUE-RULE')
  await mkdir(join(workspaceDir, 'src', 'red', 'deep', 'too-deep'), { recursive: true })
  await write(workspaceDir, 'src/red/deep/too-deep/AGENTS.md', 'TOO-DEEP-RULE')
  const input = { ...options, workspaceDir }
  const unscoped = loadProjectInstructionsSync(input)
  assert.deepEqual(unscoped.files, [root])
  const selected = await loadProjectInstructions({ ...input, targetDir: 'src/red/deep/too-deep' })
  assert.deepEqual(selected.files, [root, parent, imported, child])
  assert.deepEqual(selected.scopedFiles, [parent, imported, child])
  assert.match(selected.scopedContent, /SRC-RULE[\s\S]+RED-LOCAL[\s\S]+RED-RULE/)
  assert.doesNotMatch(selected.scopedContent, /ROOT-RULE|BLUE-RULE|TOO-DEEP-RULE/)
  await write(workspaceDir, 'src/blue/AGENTS.md', 'BLUE-REFRESHED')
  const blue = loadProjectInstructionsSync({ ...input, targetDir: join(workspaceDir, 'src', 'blue') })
  assert.deepEqual(blue.files, [root, parent, sibling])
  assert.match(blue.scopedContent, /BLUE-REFRESHED/)
  assert.doesNotMatch(blue.content, /RED-LOCAL/)
  assert.deepEqual(loadProjectInstructionsSync({ ...input, targetDir: 'src/red', maxNestedDepth: 1 }).scopedFiles, [parent])
})

test('AC-RULES-02 diagnoses repeated imports, cycles, invalid paths, symlinks and trust boundaries', async (t) => {
  const { root, homeDir, workspaceDir, write, ...options } = await fixture(t)
  const privateRule = await write(homeDir, '.claude/hidden.md', 'HOME-PRIVATE')
  const configRule = await write(homeDir, '.budingx/user.md', 'CONFIG-RULE')
  const userRule = await write(homeDir, 'AGENTS.md', '@~/.budingx/user.md @~/.claude/hidden.md @outside.md')
  const outsideRule = await write(root, 'outside.md', 'OUTSIDE-RULE')
  const undecodable = await write(workspaceDir, 'bad-utf8.md', Buffer.from([0xff]))
  const one = await write(workspaceDir, 'one.md', 'ONE-RULE @AGENTS.md')
  const aliased = join(workspaceDir, 'linked')
  await symlink(root, aliased, process.platform === 'win32' ? 'junction' : 'dir')
  const projectRule = await write(workspaceDir, 'AGENTS.md', [
    '@one.md @./one.md',
    '@missing.md @../outside.md @linked/outside.md @linked/absent.md',
    '@~/.budingx/user.md @bad-utf8.md',
    '@' + one.replaceAll('\\', '/')
  ].join('\n'))
  const result = loadProjectInstructionsSync({ ...options, workspaceDir, homeDir, targetDir: aliased })
  assert.deepEqual(result.files, [configRule, userRule, one, projectRule])
  assert.doesNotMatch(result.content, /HOME-PRIVATE|OUTSIDE-RULE/)
  assert.ok(result.warnings.some((warning) => warning.includes('RULES_IMPORT_CYCLE') && warning.includes('one.md')))
  assert.ok(result.warnings.some((warning) => warning.includes('RULES_IMPORT_DUPLICATE') && warning.includes('@./one.md')))
  assert.ok(result.warnings.some((warning) => warning.includes('RULES_IMPORT_INVALID') && warning.includes('@missing.md')))
  assert.ok(result.warnings.some((warning) => warning.includes('RULES_IMPORT_OUTSIDE') && warning.includes('@../outside.md')))
  assert.ok(result.warnings.some((warning) => warning.includes('RULES_IMPORT_OUTSIDE') && warning.includes('@~/.budingx/user.md')))
  assert.ok(result.warnings.some((warning) => warning.includes('RULES_IMPORT_SYMLINK') && warning.includes('@linked/outside.md')))
  assert.ok(result.warnings.some((warning) => warning.includes('RULES_IMPORT_SYMLINK') && warning.includes('@linked/absent.md')))
  assert.ok(result.warnings.some((warning) => warning.includes('RULES_SCOPE') && warning.includes('linked')))
  assert.ok(result.warnings.some((warning) => warning.includes('AGENTS.md:2:') && warning.includes('@missing.md')))
  assert.ok(result.warnings.some((warning) => warning.includes('RULES_IMPORT_INVALID') && warning.includes('@bad-utf8.md')))
  assert.ok([privateRule, outsideRule, undecodable].every((path) => !result.files.includes(path)))
})

test('AC-RULES-02 applies depth and byte limits to the complete import traversal', async (t) => {
  const { workspaceDir, write, ...options } = await fixture(t)
  await write(workspaceDir, 'AGENTS.md', 'ROOT-BUDGET @1.md @large.md @tail.md @ignored.md')
  for (let depth = 1; depth <= 5; depth += 1) {
    await write(workspaceDir, `${depth}.md`, `DEPTH-${depth} @${depth + 1}.md`)
  }
  await write(workspaceDir, '6.md', 'DEPTH-LIMIT-EXCEEDED')
  const large = await write(workspaceDir, 'large.md', '大'.repeat(PROJECT_INSTRUCTION_FILE_LIMIT))
  await write(workspaceDir, 'tail.md', 'ø'.repeat(PROJECT_INSTRUCTION_FILE_LIMIT))
  await write(workspaceDir, 'ignored.md', 'BYTE-LIMIT-EXCEEDED')
  const result = await loadProjectInstructions({ ...options, workspaceDir })
  assert.match(result.content, /DEPTH-5/)
  assert.match(result.content, /ROOT-BUDGET/)
  assert.doesNotMatch(result.content, /DEPTH-LIMIT-EXCEEDED|BYTE-LIMIT-EXCEEDED|\uFFFD/)
  assert.equal(result.sources.find(({ path }) => path === large)?.truncated, true)
  assert.ok(result.warnings.some((warning) => warning.includes('RULES_IMPORT_DEPTH') && warning.includes('@6.md')))
  assert.ok(result.warnings.some((warning) => warning.includes('64 KiB') && warning.includes('large.md')))
  assert.ok(result.warnings.some((warning) => warning.includes('128 KiB') && warning.includes('tail.md')))
  assert.ok(Buffer.byteLength(result.content) <= PROJECT_INSTRUCTION_TOTAL_LIMIT)
})
