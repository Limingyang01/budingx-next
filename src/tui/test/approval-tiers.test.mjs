// L2 pseudo-TTY e2e for SP003 approval tiers, permission modes and denials
// (AC PC-02/PC-03/PC-05/PC-06/PC-10 + PC-08 via full-access floor).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mountTty } from './helpers/mount-tty.mjs'
import { agentFixture, scriptProvider, toolTurn } from './helpers/agent-fixture.mjs'

function mount(t, fixture, script) {
  const { provider } = scriptProvider(script)
  return mountTty(t, {
    provider,
    tools: fixture.tools,
    permissionPolicy: fixture.policy,
    commandOverrides: { permission: fixture.permission },
    config: { model: 'test-model' }
  })
}

test('工作区内修改：审批卡显示三档，选 2 记住后同目标不再询问（PC-06）', async (t) => {
  const fixture = agentFixture({ mode: 'workspace_edit' })
  try {
    const ui = await mount(t, fixture, [
      toolTurn('Write', { path: 'note.txt', content: 'v1\n' })[0],
      [{ type: 'message_completed', finishReason: 'stop' }],
      toolTurn('Write', { path: 'note.txt', content: 'v2\n' })[0],
      [{ type: 'message_completed', finishReason: 'stop' }]
    ])
    fixture.attach(ui.session)
    await ui.send('write it\r')
    await ui.waitFor((frame) => frame.includes('需要审批') && frame.includes('2 本会话记住'))
    await ui.send('2')
    await ui.waitFor(() => !ui.session.isBusy)
    assert.equal(readFileSync(join(fixture.root, 'note.txt'), 'utf8'), 'v1\n')
    await ui.send('again\r')
    await ui.waitFor(() => !ui.session.isBusy)
    // Second write to the remembered target: no approval card appears.
    assert.equal(ui.raw().includes('note.txt'), true)
    assert.equal(readFileSync(join(fixture.root, 'note.txt'), 'utf8'), 'v2\n')
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('选 1 只放行一次：同目标下一回合仍会询问（PC-06）', async (t) => {
  const fixture = agentFixture({ mode: 'workspace_edit' })
  try {
    const ui = await mount(t, fixture, [
      ...toolTurn('Write', { path: 'once.txt', content: 'a\n' }).slice(0, 1),
      [{ type: 'message_completed', finishReason: 'stop' }],
      ...toolTurn('Write', { path: 'once.txt', content: 'b\n' }).slice(0, 1),
      [{ type: 'message_completed', finishReason: 'stop' }]
    ])
    fixture.attach(ui.session)
    await ui.send('first\r')
    await ui.waitFor((frame) => frame.includes('需要审批'))
    await ui.send('1')
    await ui.waitFor(() => !ui.session.isBusy)
    await ui.send('second\r')
    await ui.waitFor((frame) => frame.includes('需要审批'))
    await ui.send('n')
    await ui.waitFor(() => !ui.session.isBusy)
    assert.equal(readFileSync(join(fixture.root, 'once.txt'), 'utf8'), 'a\n')
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('拒绝后磁盘不变、会话继续，/denials 可见记录（PC-10）', async (t) => {
  const fixture = agentFixture({ mode: 'workspace_edit' })
  try {
    const ui = await mount(t, fixture, [
      ...toolTurn('Write', { path: 'denied.txt', content: 'x\n' }).slice(0, 1),
      [{ type: 'message_completed', finishReason: 'stop' }]
    ])
    fixture.attach(ui.session)
    await ui.send('try it\r')
    await ui.waitFor((frame) => frame.includes('需要审批'))
    await ui.send('3')
    await ui.waitFor(() => !ui.session.isBusy)
    assert.equal(existsSync(join(fixture.root, 'denied.txt')), false)
    await ui.send('/denials\r')
    await ui.waitFor((frame) => frame.includes('Write denied.txt'))
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('Shift+Tab 轮播三模式且徽标可见；完全权限自动执行不弹卡（PC-02/PC-05）', async (t) => {
  const fixture = agentFixture({ mode: 'read_only' })
  try {
    const ui = await mount(t, fixture, [
      ...toolTurn('Write', { path: 'full.txt', content: 'z\n' }).slice(0, 1),
      [{ type: 'message_completed', finishReason: 'stop' }]
    ])
    fixture.attach(ui.session)
    await ui.waitFor((frame) => frame.includes('仅可查看'))
    await ui.send('\x1b[Z')
    await ui.waitFor((frame) => frame.includes('工作区内修改'))
    await ui.send('\x1b[Z')
    await ui.waitFor((frame) => frame.includes('完全权限'))
    await ui.send('write now\r')
    await ui.waitFor(() => !ui.session.isBusy)
    // full access: the write ran without an approval card.
    assert.equal(ui.frames().some((frame) => frame.includes('需要审批')), false)
    assert.equal(readFileSync(join(fixture.root, 'full.txt'), 'utf8'), 'z\n')
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('read_only 直接拒绝写请求且不弹卡（PC-03）', async (t) => {
  const fixture = agentFixture({ mode: 'read_only' })
  try {
    const ui = await mount(t, fixture, [
      ...toolTurn('Write', { path: 'ro.txt', content: 'x\n' }).slice(0, 1),
      [{ type: 'message_completed', finishReason: 'stop' }]
    ])
    fixture.attach(ui.session)
    await ui.send('attempt\r')
    await ui.waitFor(() => !ui.session.isBusy)
    assert.equal(ui.frames().some((frame) => frame.includes('需要审批')), false)
    assert.equal(existsSync(join(fixture.root, 'ro.txt')), false)
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('完全权限仍拒绝凭据特征文件（PC-08 底线不可绕过）', async (t) => {
  const fixture = agentFixture({ mode: 'full_access' })
  try {
    const ui = await mount(t, fixture, [
      ...toolTurn('Write', { path: '.env', content: 'SECRET=1\n' }).slice(0, 1),
      [{ type: 'message_completed', finishReason: 'stop' }]
    ])
    fixture.attach(ui.session)
    await ui.send('leak it\r')
    await ui.waitFor(() => !ui.session.isBusy)
    assert.equal(existsSync(join(fixture.root, '.env')), false)
    await ui.send('/denials\r')
    await ui.waitFor((frame) => frame.includes('Credential files are off-limits'))
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})
