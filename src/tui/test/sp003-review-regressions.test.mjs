import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mountTty } from './helpers/mount-tty.mjs'
import { agentFixture, scriptProvider, toolTurn } from './helpers/agent-fixture.mjs'
import { readWorkspaceFile } from '../dist/workspace/read.js'
import { grepWorkspace, globWorkspace } from '../dist/workspace/search.js'
import { applyCompletion, activeToken, fileCandidates } from '../dist/tui/render/completion.js'
import { extractFileReferences } from '../dist/workspace/context.js'
const stop = [{ type: 'message_completed', finishReason: 'stop' }]

function fixture(t, mode = 'full_access') {
  const f = agentFixture({ mode })
  t.after(() => rmSync(f.base, { recursive: true, force: true }))
  return f
}

async function mount(t, f, script) {
  const { provider, calls } = scriptProvider(script)
  const ui = await mountTty(t, {
    provider,
    tools: f.tools,
    permissionPolicy: f.policy,
    commandOverrides: { permission: f.permission },
    config: { model: 'test-model' }
  })
  f.attach(ui.session)
  return { ui, calls }
}

async function send(ui, text) {
  await ui.send(text)
  await ui.send('\r')
}

function handler(f, name, input) {
  const tool = f.tools.find((tool) => tool.name === name)
  return tool.execute(input, { turnId: 'turn1', signal: new AbortController().signal })
}

test('FC-04 and FC-08: submitted file range reaches provider', async (t) => {
  const f = fixture(t)
  f.writeSeedFile('note.txt', 'first-line\nwanted-content\nlast-line')
  const { ui, calls } = await mount(t, f, [stop])
  await send(ui, 'Explain @note.txt#L2')
  await ui.waitFor(() => calls.length === 1 && !ui.session.isBusy)
  const messages = JSON.stringify(calls[0].messages)
  assert.match(messages, /wanted-content/)
  assert.doesNotMatch(messages, /first-line|last-line/)
})

test('CP-02: approval displays the proposed lines before writing', async (t) => {
  const f = fixture(t, 'workspace_edit')
  f.writeSeedFile('review.txt', 'existing-approval-content\n')
  const { ui } = await mount(t, f, [
    toolTurn('Read', { path: 'review.txt' })[0],
    toolTurn('Edit', {
      path: 'review.txt',
      old_string: 'existing-approval-content',
      new_string: 'visible-proposed-line'
    })[0],
    stop
  ])
  await send(ui, 'edit file')
  await ui.waitFor((frame) => frame.includes('review.txt') && frame.includes('需要审批'))
  assert.equal(readFileSync(join(f.root, 'review.txt'), 'utf8'), 'existing-approval-content\n')
  const approval = ui.last().slice(ui.last().lastIndexOf('需要审批'))
  assert.match(approval, /-existing-approval-content/)
  assert.match(approval, /\+visible-proposed-line/)
  await ui.send('1')
  await ui.waitFor(() => !ui.session.isBusy)
  assert.equal(readFileSync(join(f.root, 'review.txt'), 'utf8'), 'visible-proposed-line\n')
})

test('CP-09: turn diff keeps both edits to the same file', async (t) => {
  const f = fixture(t)
  const { ui } = await mount(t, f, [
    toolTurn('Write', { path: 'combo.txt', content: 'first-added\n' })[0],
    toolTurn('Write', { path: 'combo.txt', content: 'first-added\nsecond-added\n' })[0],
    stop
  ])
  await send(ui, 'make two writes')
  await ui.waitFor(() => !ui.session.isBusy && f.checkpoint.changes().length === 2)
  assert.equal(readFileSync(join(f.root, 'combo.txt'), 'utf8'), 'first-added\nsecond-added\n')
  await send(ui, '/diff combo.txt')
  await ui.waitFor((frame) => frame.includes('second-added') && frame.includes('@@'))
  assert.match(ui.last(), /\+first-added/)
})

test('CP-05: undo restores original CRLF bytes', async (t) => {
  const f = fixture(t)
  const original = 'first\r\nsecond\r\n'
  f.writeSeedFile('win.txt', original)
  await handler(f, 'Read', { path: 'win.txt' })
  await handler(f, 'Edit', { path: 'win.txt', old_string: 'first', new_string: 'edited' })
  assert.equal(f.permission.undo('win.txt').undone, true)
  assert.equal(readFileSync(join(f.root, 'win.txt'), 'utf8'), original)
})

test('WT-07: exact literal edit preserves CRLF in multiline insertion', async (t) => {
  const f = fixture(t)
  f.writeSeedFile('win.txt', 'first\r\nsecond\r\n')
  await handler(f, 'Read', { path: 'win.txt' })
  await handler(f, 'Edit', { path: 'win.txt', old_string: 'first', new_string: 'new1\nnew2' })
  assert.equal(readFileSync(join(f.root, 'win.txt'), 'utf8'), 'new1\r\nnew2\r\nsecond\r\n')
})

test('FC-02: selecting a filename with spaces round-trips as one reference', () => {
  const line = '@two'
  const result = applyCompletion(line, activeToken(line, line.length, []), {
    kind: 'file', directory: false, value: 'two words.txt'
  })
  assert.deepEqual(extractFileReferences(result).map((ref) => ref.path), ['two words.txt'])
})

test('FC-08: two different ranges starting on the same line are retained', () => {
  assert.deepEqual(
    extractFileReferences('@rows.txt#L2-3 @rows.txt#L2-8').map((ref) => ref.range),
    [{ start: 2, end: 3 }, { start: 2, end: 8 }]
  )
})

test('WT-12: /only.txt is anchored to the root of its ignore file', (t) => {
  const f = fixture(t)
  f.writeSeedFile('.gitignore', '/only.txt\n')
  f.writeSeedFile('only.txt', 'root')
  f.writeSeedFile('nested/only.txt', 'keep')
  const result = globWorkspace(f.workspace, { pattern: '**/only.txt' })
  assert.equal(result.total, 1)
  assert.match(result.text, /nested\/only\.txt/)
})

test('Grep can search one selected file', (t) => {
  const f = fixture(t)
  f.writeSeedFile('single.txt', 'needle content\n')
  f.writeSeedFile('other.txt', 'needle other\n')
  const result = grepWorkspace(f.workspace, { pattern: 'needle', path: 'single.txt' })
  assert.match(result.text, /single\.txt/)
  assert.doesNotMatch(result.text, /other\.txt/)
})

test('Grep reads matches beyond the old 2 MiB cap and flags incomplete searches', (t) => {
  const f = fixture(t)
  f.writeSeedFile('large.txt', 'data line\n'.repeat(220000) + 'needle\n')
  assert.match(grepWorkspace(f.workspace, { pattern: 'needle' }).text, /large\.txt/)
  const partial = grepWorkspace(f.workspace, { pattern: 'needle', maxFileBytes: 1024 })
  assert.equal(partial.truncated, true)
  assert.match(partial.text, /Incomplete search/)
})

test('Read accepts a deliberately encoded U+FFFD in valid UTF-8', (t) => {
  const f = fixture(t)
  f.writeSeedFile('valid.txt', 'valid \uFFFD marker\n')
  assert.match(readWorkspaceFile(f.workspace, { path: 'valid.txt' }).text, /\uFFFD/)
})

test('Grep multiline matches blank lines without a synthetic final match', (t) => {
  const f = fixture(t)
  f.writeSeedFile('rows.txt', 'a\n\nb\n')
  const result = grepWorkspace(f.workspace, { pattern: '^$', multiline: true, outputMode: 'content' })
  assert.match(result.text, /rows\.txt:2:/)
  assert.equal(result.total, 1)
})

test('Grep accepts the reference case and line number flags', async (t) => {
  const f = fixture(t)
  f.writeSeedFile('flags.txt', 'Needle\n')
  const result = await handler(f, 'Grep', { pattern: 'needle', '-i': true, '-n': false })
  assert.equal(result, 'flags.txt:Needle')
})

test('bare /undo targets the latest turn only', async (t) => {
  const f = fixture(t)
  const script = [
    ...toolTurn('Write', { path: 'earlier.txt', content: 'first\n' }),
    ...toolTurn('Write', { path: 'latest.txt', content: 'second\n' })
  ]
  const { ui } = await mount(t, f, script)
  await send(ui, 'first turn')
  await ui.waitFor(() => !ui.session.isBusy && f.checkpoint.changes().length === 1)
  await send(ui, 'second turn')
  await ui.waitFor(() => !ui.session.isBusy && f.checkpoint.changes().length === 2)
  await send(ui, '/undo')
  await ui.waitFor(() => !existsSync(join(f.root, 'latest.txt')))
  assert.ok(existsSync(join(f.root, 'earlier.txt')))
})
test('Current diff list reflects the disk after undo', async (t) => {
  const f = fixture(t)
  const { ui } = await mount(t, f, toolTurn('Write', { path: 'reverted.txt', content: 'one\n' }))
  await send(ui, 'write then undo')
  await ui.waitFor(() => !ui.session.isBusy && f.checkpoint.changes().length === 1)
  await send(ui, '/undo')
  await ui.waitFor(() => !existsSync(join(f.root, 'reverted.txt')))
  await send(ui, '/diff')
  await ui.waitFor((frame) => frame.includes('reverted.txt'))
  await ui.send('\x1b[C')
  await ui.waitFor((frame) => frame.includes('\u5f53\u524d\u5dee\u5f02'))
  assert.doesNotMatch(ui.last(), /reverted\.txt\s+\+1\/-0/)
})
test('Glob includes brace alternatives and Grep applies ignore character classes', (t) => {
  const f = fixture(t)
  f.writeSeedFile('src/one.ts', 'needle\n')
  f.writeSeedFile('src/two.tsx', 'needle\n')
  f.writeSeedFile('src/spec3.ts', 'needle\n')
  f.writeSeedFile('src/other.md', 'needle\n')
  f.writeSeedFile('.gitignore', 'spec[0-9].ts\n')
  assert.equal(globWorkspace(f.workspace, { pattern: '**/*.{ts,tsx}' }).total, 2)
  assert.doesNotMatch(grepWorkspace(f.workspace, { pattern: 'needle' }).text, /spec3/)
})


test('a small line range can be read in a file larger than the old range limit', (t) => {
  const f = fixture(t)
  const row = 'x'.repeat(1023) + '\n'
  f.writeSeedFile('range.txt', row.repeat(11000) + 'target\n')
  const result = readWorkspaceFile(f.workspace, { path: 'range.txt', offset: 11001, limit: 1 })
  assert.match(result.text, /11001.*target/)
  assert.ok(result.fingerprint)
})

test('manual ignored and denied file mentions provide feedback and stay out of requests', async (t) => {
  const f = fixture(t)
  f.writeSeedFile('.gitignore', 'ignored.txt\n')
  f.writeSeedFile('ignored.txt', 'ignored fixture content\n')
  f.writeSeedFile('denied.txt', 'denied fixture content\n')
  f.policy.setRules([{ id: 'fixture', action: 'deny', tool: 'Read', path: 'denied.txt' }])
  const { ui, calls } = await mount(t, f, [stop])
  await send(ui, 'Inspect @ignored.txt and @denied.txt')
  await ui.waitFor(() => calls.length === 1 && !ui.session.isBusy)
  assert.doesNotMatch(JSON.stringify(calls[0].messages), /fixture content|file_context/)
  assert.match(ui.frames().join('\n'), /ignored by workspace ignore rules/)
  assert.match(ui.frames().join('\n'), /Denied by rule fixture/)
})

test('a new target appearing while approval is open remains untouched', async (t) => {
  const f = fixture(t, 'workspace_edit')
  const { ui, calls } = await mount(t, f, [
    toolTurn('Write', { path: 'race.txt', content: 'agent proposed content\n' })[0],
    stop
  ])
  await send(ui, 'create a file')
  await ui.waitFor((frame) => frame.includes('+agent proposed content'))
  f.writeSeedFile('race.txt', 'external content\n')
  await ui.send('1')
  await ui.waitFor(() => calls.length === 2 && !ui.session.isBusy)
  assert.match(JSON.stringify(calls[1].messages), /File changed since it was read/)
  assert.equal(readFileSync(join(f.root, 'race.txt'), 'utf8'), 'external content\n')
  assert.equal(f.checkpoint.changes().length, 0)
})


test('queued file context is read from disk when the next request starts', async (t) => {
  const f = fixture(t)
  f.writeSeedFile('queued.txt', 'before queue release\n')
  const calls = []
  const barrier = Promise.withResolvers()
  t.after(() => barrier.resolve())
  const provider = {
    async *stream(request) {
      calls.push(request)
      if (calls.length === 1) await barrier.promise
      yield* stop
    }
  }
  const ui = await mountTty(t, {
    provider,
    tools: f.tools,
    permissionPolicy: f.policy,
    commandOverrides: { permission: f.permission },
    config: { model: 'test-model' }
  })
  await send(ui, 'hold the first turn')
  await ui.waitFor(() => calls.length === 1)
  await send(ui, 'read @queued.txt')
  await ui.waitFor(() => ui.session.queuedInputs.length === 1)
  f.writeSeedFile('queued.txt', 'after queue release\n')
  barrier.resolve()
  await ui.waitFor(() => calls.length === 2 && !ui.session.isBusy)
  assert.match(JSON.stringify(calls[1].messages), /after queue release/)
  assert.doesNotMatch(JSON.stringify(calls[1].messages), /before queue release/)
})

test('file completion can find a nested file by its fuzzy basename', () => {
  const matches = fileCandidates('cfgjs', ['src/config.js', 'main.ts'])
  assert.equal(matches[0]?.value, 'src/config.js')
})


test('Git diff source displays changes made outside this session', async (t) => {
  const f = fixture(t)
  const git = (...args) => execFileSync('git', args, { cwd: f.root, windowsHide: true, stdio: 'pipe' })
  git('init', '--quiet')
  f.writeSeedFile('tracked.txt', 'original from HEAD\n')
  git('add', '--', 'tracked.txt')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture')
  f.writeSeedFile('tracked.txt', 'updated outside session\n')
  f.writeSeedFile('untracked.txt', 'new outside session\n')
  const { ui } = await mount(t, f, [])
  await send(ui, '/diff')
  await ui.waitFor((frame) => frame.includes('\u5f53\u524d\u5dee\u5f02'))
  await ui.send('\x1b[C')
  await ui.waitFor((frame) => frame.includes('Git') && frame.includes('tracked.txt +1/-1'))
  assert.match(ui.last(), /untracked\.txt \+1\/-0/)
  await ui.send('\r')
  await ui.waitFor((frame) => frame.includes('+updated outside session'))
  assert.match(ui.last(), /-original from HEAD/)
})

test('external edits made during approval invalidate the proposed patch', async (t) => {
  const f = fixture(t, 'workspace_edit')
  f.writeSeedFile('changed.txt', 'read baseline\n')
  const { ui, calls } = await mount(t, f, [
    toolTurn('Read', { path: 'changed.txt' })[0],
    toolTurn('Edit', {
      path: 'changed.txt', old_string: 'read baseline', new_string: 'proposed revision'
    })[0],
    stop
  ])
  await send(ui, 'edit changed file')
  await ui.waitFor((frame) => frame.includes('+proposed revision'))
  f.writeSeedFile('changed.txt', 'different external edit\n')
  await ui.send('2')
  await ui.waitFor(() => calls.length === 3 && !ui.session.isBusy)
  assert.match(JSON.stringify(calls[2].messages), /File changed since it was read/)
  assert.equal(readFileSync(join(f.root, 'changed.txt'), 'utf8'), 'different external edit\n')
  assert.equal(f.checkpoint.changes().length, 0)
  assert.equal(f.policy.decide({ tool: 'Edit', capability: 'write', path: 'changed.txt' }).action, 'ask')
})
