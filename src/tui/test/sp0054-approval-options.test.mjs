// 0.5.4：审批卡选项编号与按键必须一致。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'
import { agentFixture, scriptProvider, toolTurn } from './helpers/agent-fixture.mjs'

test('0.5.4 无「本会话记住」时审批卡用 1/2 编号，按 2 即进入拒绝', async (t) => {
  // .git writes are a hard approval floor: never "remember for this session".
  const fixture = agentFixture({ mode: 'workspace_edit' })
  const { provider } = scriptProvider([
    toolTurn('Write', { path: '.git/config', content: 'x' })[0],
    [{ type: 'message_completed', finishReason: 'stop' }]
  ])
  const ui = await mountTty(t, {
    provider,
    tools: fixture.tools,
    permissionPolicy: fixture.policy,
    commandOverrides: { permission: fixture.permission },
    config: { model: 'test-model' }
  })
  fixture.attach(ui.session)
  await ui.send('write the git config\r')
  await ui.waitFor((frame) => frame.includes('允许一次'))
  const numbered = ui.frames().filter((frame) => frame.includes('允许一次'))
  assert.ok(
    numbered.some((frame) => /1 允许一次 · 2 拒绝（或 Esc）/.test(frame)),
    'expected 1/2 numbering; got:\n' + numbered.at(-1)
  )
  assert.ok(
    !numbered.some((frame) => /· 3 拒绝/.test(frame)),
    'must not offer option 3 when 2 is deny; got:\n' + numbered.at(-1)
  )
  // 2 must open the deny path, not silently do nothing.
  await ui.send('2')
  await ui.waitFor((frame) => frame.includes('拒绝反馈'))
  await ui.send('\x1b')
  await ui.waitFor((frame) => !frame.includes('需要审批'))
})
