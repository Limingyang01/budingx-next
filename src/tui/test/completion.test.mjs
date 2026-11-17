// L0 completion candidates + L2 pseudo-TTY overlay (SP003 AC FC-01…03,
// plan T15).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  activeToken,
  applyCompletion,
  commandCandidates,
  fileCandidates
} from '../dist/tui/render/completion.js'
import { mountTty } from './helpers/mount-tty.mjs'
import { agentFixture, scriptProvider } from './helpers/agent-fixture.mjs'

test('activeToken 识别行首命令与任意位置 @token，忽略光标后内容', () => {
  assert.deepEqual(activeToken('/prov', 5, ['provider']), {
    kind: 'command',
    token: 'prov',
    start: 0,
    length: 5
  })
  const token = activeToken('explain @src/comp', 17, ['help'])
  assert.equal(token.kind, 'file')
  assert.equal(token.token, 'src/comp')
  assert.equal(token.start, 8)
  assert.equal(token.length, 9)
  assert.equal(activeToken('mid text', 4, ['help']), null)
  assert.equal(activeToken('/xyz', 4, ['help']), null)
})

test('fileCandidates 目录续补、前缀过滤且上限 5 条', () => {
  // The host supplies files already sorted, as the walk does.
  const files = [
    'src/a.ts',
    'src/component/c.tsx',
    'src/deep/b.ts',
    'src/readme-note.md',
    'top.ts',
    'x/y.ts',
    'z/w.ts'
  ]
  assert.deepEqual(
    fileCandidates('src/', files).map((candidate) => candidate.value),
    ['src/a.ts', 'src/component/', 'src/deep/', 'src/readme-note.md']
  )
  assert.equal(fileCandidates('src/', files).length, 4)
  assert.deepEqual(
    fileCandidates('src/com', files).map((candidate) => candidate.value),
    ['src/component/']
  )
  assert.deepEqual(
    fileCandidates('', files).map((candidate) => candidate.value),
    ['src/', 'top.ts', 'x/', 'z/']
  )
  assert.deepEqual(commandCandidates('pro', ['provider', 'permission']), [
    { value: 'provider', kind: 'command', directory: false }
  ])
})

test('applyCompletion 替换活动 token 为选中值', () => {
  const line = 'explain @src/comp please'
  const token = activeToken(line, 17, ['help'])
  const applied = applyCompletion(line, token, {
    value: 'src/component/',
    kind: 'file',
    directory: true
  })
  assert.equal(applied, 'explain @src/component/ please')
})

function mountAgent(t, fixture, options = {}) {
  const { provider } = scriptProvider([
    [{ type: 'message_completed', finishReason: 'stop' }]
  ])
  return mountTty(t, {
    provider,
    tools: fixture.tools,
    permissionPolicy: fixture.policy,
    commandOverrides: { permission: fixture.permission },
    config: { model: 'test-model' },
    ...options
  })
}

test('@ 触发 overlay：目录续补、忽略文件不出现、↓+Tab 插入完整路径（FC-01/FC-02）', async (t) => {
  const fixture = agentFixture()
  try {
    fixture.writeSeedFile('src/alpha.ts', 'a\n')
    fixture.writeSeedFile('src/beta.ts', 'b\n')
    fixture.writeSeedFile('debug.log', 'ignored\n')
    writeFileSync(join(fixture.root, '.gitignore'), '*.log\n')
    const ui = await mountAgent(t, fixture)
    fixture.attach(ui.session)
    await ui.send('@')
    await ui.waitFor((frame) => frame.includes('Tab 插入'))
    assert.ok(ui.last().includes('src/'))
    // Ignored files never enter the candidate list.
    assert.equal(ui.last().includes('debug.log'), false)
    await ui.send('src/')
    await ui.waitFor((frame) => frame.includes('alpha.ts'))
    await ui.send('\x1b[B')
    await ui.send('\t')
    await ui.waitFor((frame) => frame.includes('@src/beta.ts'))
    assert.equal(ui.last().includes('debug.log'), false)
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('/ 与 @ 共用 overlay：候选命令 Tab 补全后 Enter 执行（FC-03）', async (t) => {
  const fixture = agentFixture()
  try {
    const ui = await mountAgent(t, fixture)
    fixture.attach(ui.session)
    await ui.send('/perm')
    await ui.waitFor((frame) => frame.includes('/permission'))
    await ui.send('\t')
    await ui.waitFor((frame) => frame.includes('> /permission'))
    await ui.send('\r')
    await ui.waitFor((frame) => frame.includes('当前权限模式'))
    assert.match(ui.last(), /工作区内修改/)
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('Esc 关闭 overlay，再次输入重新打开', async (t) => {
  const fixture = agentFixture()
  try {
    fixture.writeSeedFile('a.ts', 'x\n')
    const ui = await mountAgent(t, fixture)
    fixture.attach(ui.session)
    await ui.send('@')
    await ui.waitFor((frame) => frame.includes('Tab 插入'))
    await ui.send('\x1b')
    await ui.waitFor((frame) => !frame.includes('Tab 插入'))
    await ui.send('a')
    await ui.waitFor((frame) => frame.includes('Tab 插入'))
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})
