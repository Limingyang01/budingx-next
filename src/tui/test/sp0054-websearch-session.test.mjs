// 0.5.4：联网搜索审批提供「本会话记住」，记住后同工具不再逐次询问。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'
import { agentFixture } from './helpers/agent-fixture.mjs'
import { createWebSearchTool } from '../dist/provider/web-search.js'

function searchCall(id, query) {
  return [
    { type: 'tool_call_delta', index: 0, callId: id, nameDelta: 'WebSearch', argsDelta: JSON.stringify({ query }) },
    { type: 'message_completed', finishReason: 'tool_calls' }
  ]
}

test('0.5.4 联网搜索审批卡含「本会话记住」，选 2 后第二次搜索不再询问', async (t) => {
  const fixture = agentFixture({ mode: 'workspace_edit' })
  // Mock the Tavily backend so no real network I/O happens.
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    results: [{ title: 'A', url: 'https://example.test/a', content: 'snippet' }]
  }))
  let round = 0
  const provider = {
    async *stream() {
      round += 1
      if (round === 1) { yield* searchCall('call-s1', 'first query'); return }
      if (round === 2) { yield* searchCall('call-s2', 'second query'); return }
      yield { type: 'message_completed', finishReason: 'stop' }
    }
  }
  const ui = await mountTty(t, {
    provider,
    tools: [...fixture.tools, createWebSearchTool('fixture-key')],
    permissionPolicy: fixture.policy,
    commandOverrides: { permission: fixture.permission },
    config: { model: 'test-model' }
  })
  fixture.attach(ui.session)
  const approvals = []
  ui.session.on((event) => { if (event.type === 'approval_requested') approvals.push(event.name) })
  await ui.send('search something\r')
  // First search must ask, and the card must offer the session-allow option.
  await ui.waitFor((frame) => frame.includes('需要审批') && frame.includes('WebSearch'), 5000)
  await ui.waitFor((frame) => frame.includes('2 本会话记住'), 3000)
  await ui.send('2') // allow for this session
  // Second search in the same session must NOT raise another approval card.
  await ui.waitFor(() => !ui.session.isBusy, 8000)
  assert.deepEqual(approvals, ['WebSearch'], 'only the first search may ask; the remembered one must not')
  assert.doesNotMatch(ui.last(), /需要审批/)
})