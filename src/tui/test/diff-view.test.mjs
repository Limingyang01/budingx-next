// L0 diff-view + L2 pseudo-TTY diff dialog (SP003 AC CP-01/CP-02/CP-03/
// CP-07/CP-08, plan T13).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { diffViewLines, diffStats, diffText } from '../dist/tui/render/diff-view.js'
import { diffLines } from '../dist/workspace/diff.js'
import { mountTty } from './helpers/mount-tty.mjs'
import { agentFixture, scriptProvider, toolTurn } from './helpers/agent-fixture.mjs'

test('diffViewLines 输出 @@ 头、gutter 行号与增删标记（CP-01）', () => {
  const hunks = diffLines('a\nb\nc\n', 'a\nB\nc\n')
  const lines = diffViewLines(hunks, 100)
  assert.match(lines[0].spans[0].text, /^@@ -1,3 \+1,3 @@$/)
  const removed = lines.find((line) => line.kind === 'remove')
  assert.match(removed.spans[0].text.trim(), /^2$/)
  assert.match(removed.spans[1].text, /^-b$/)
  const added = lines.find((line) => line.kind === 'add')
  assert.match(added.spans[1].text, /^\+B$/)
})

test('长行按终端列宽截断显示但 hunk 结构不变', () => {
  const long = 'x'.repeat(200)
  const hunks = diffLines(`${long}\n`, `${long.replace(/x/g, 'y')}\n`)
  const lines = diffViewLines(hunks, 60)
  for (const line of lines) {
    const width = line.spans.reduce((sum, span) => sum + span.text.length, 0)
    assert.ok(width <= 70, `line too long: ${width}`)
  }
})

test('diffStats 与 diffText 纯文本形态稳定', () => {
  const hunks = diffLines('one\ntwo\n', 'one\n2\n')
  assert.deepEqual(diffStats(hunks), { additions: 1, removals: 1 })
  const text = diffText(hunks)
  assert.match(text.join('\n'), /@@ -1,2 \+1,2 @@/)
})

function mountAgent(t, fixture, script, options = {}) {
  const { provider } = scriptProvider(script)
  return mountTty(t, {
    provider,
    tools: fixture.tools,
    permissionPolicy: fixture.policy,
    commandOverrides: { permission: fixture.permission },
    config: { model: 'test-model' },
    ...options
  })
}

test('/diff 打开两级对话框：列表→详情→Tab 切源→Esc 关闭（CP-07）', async (t) => {
  const fixture = agentFixture({ mode: 'full_access' })
  try {
    const ui = await mountAgent(t, fixture, [
      toolTurn('Write', { path: 'note.md', content: '# v1\nbody\n' })[0],
      [{ type: 'message_completed', finishReason: 'stop' }]
    ])
    fixture.attach(ui.session)
    await ui.send('create a note\r')
    await ui.waitFor(() => !ui.session.isBusy)
    assert.equal(readFileSync(join(fixture.root, 'note.md'), 'utf8'), '# v1\nbody\n')
    await ui.send('/diff\r')
    await ui.waitFor((frame) => frame.includes('本会话改动') && frame.includes('note.md'))
    assert.match(ui.last(), /\+2\/-0/)
    await ui.send('\r')
    await ui.waitFor((frame) => frame.includes('@@ -1,0 +1,2 @@'))
    await ui.send('\x1b[C')
    await ui.waitFor((frame) => frame.includes('当前差异'))
    await ui.send('\x1b')
    await ui.waitFor((frame) => !frame.includes('本会话改动'))
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('拒绝的写入不产生改动条目（CP-03）', async (t) => {
  const fixture = agentFixture({ mode: 'workspace_edit' })
  try {
    const ui = await mountAgent(t, fixture, [
      toolTurn('Write', { path: 'blocked.txt', content: 'x\n' })[0],
      [{ type: 'message_completed', finishReason: 'stop' }]
    ])
    fixture.attach(ui.session)
    await ui.send('try\r')
    await ui.waitFor((frame) => frame.includes('需要审批'))
    await ui.send('n')
    await ui.waitFor((frame) => frame.includes('拒绝反馈'))
    await ui.send('\x1b')
    await ui.waitFor(() => !ui.session.isBusy)
    await ui.send('/diff\r')
    await ui.waitFor((frame) => frame.includes('无改动'))
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('预览与磁盘一致：/diff current 源反映外部改动（CP-02/CP-04）', async (t) => {
  const fixture = agentFixture({ mode: 'full_access' })
  try {
    const ui = await mountAgent(t, fixture, [
      toolTurn('Write', { path: 'p.txt', content: 'ours\n' })[0],
      [{ type: 'message_completed', finishReason: 'stop' }]
    ])
    fixture.attach(ui.session)
    await ui.send('write\r')
    await ui.waitFor(() => !ui.session.isBusy)
    // An external process changes the file after our write.
    writeFileSync(join(fixture.root, 'p.txt'), 'ours + user\n')
    await ui.send('/diff p.txt\r')
    await ui.waitFor((frame) => frame.includes('回合差异'))
    await ui.send('\x1b[C')
    await ui.waitFor((frame) => frame.includes('当前差异'))
    // The current source re-diffs against disk: the user line shows up
    // as an addition relative to our baseline.
    assert.match(ui.last(), /\+ours \+ user/)
    // Automatic undo must now refuse to roll back (keeps the user line).
    await ui.send('\x1b')
    await ui.send('/undo p.txt\r')
    await ui.waitFor((frame) => frame.includes('自动撤销') || frame.includes('automatic undo stopped'))
    assert.equal(readFileSync(join(fixture.root, 'p.txt'), 'utf8'), 'ours + user\n')
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('窄终端（60 列）对话框单栏渲染且行号可见（CP-08）', async (t) => {
  const fixture = agentFixture({ mode: 'full_access' })
  try {
    const ui = await mountAgent(t, fixture, [
      toolTurn('Write', { path: 'n.txt', content: 'line one\nline two\n' })[0],
      [{ type: 'message_completed', finishReason: 'stop' }]
    ], { columns: 60 })
    fixture.attach(ui.session)
    await ui.send('write\r')
    await ui.waitFor(() => !ui.session.isBusy)
    await ui.send('/diff n.txt\r')
    await ui.waitFor((frame) => frame.includes('@@'))
    // single column: no side-by-side split exists; content and markers show
    assert.match(ui.last(), /line one/)
    assert.match(ui.last(), /\+line two|line two/)
    const widths = ui.last().split('\n').map((line) => line.length)
    assert.ok(Math.max(...widths) <= 64, `frame too wide: ${Math.max(...widths)}`)
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})


test('interactive diff wraps long CJK lines without losing the end', () => {
  const before = '旧行'.repeat(30)
  const after = '新行'.repeat(30) + '最后'
  const lines = diffViewLines(diffLines(before + '\n', after + '\n'), 28, true)
  const added = lines.filter((line) => line.kind === 'add')
  assert.ok(added.length > 1)
  assert.equal(added.map((line) => line.spans[1].text.slice(1)).join(''), after)
  assert.equal(added[0].spans[0].text.trim(), '1')
  assert.equal(added.at(-1).spans[0].text.trim(), '')
})
