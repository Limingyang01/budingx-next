// SP009：技能触发不得把技能提示词回显到会话里。
// 一层是 normalize 的 <skill> 包装（模型仍拿到正文），另一层是真实 TUI 帧。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeForApi } from '../dist/core/normalize.js'
import { mountTty } from './helpers/mount-tty.mjs'

const idle = { async *stream() { yield { type: 'message_completed', finishReason: 'stop' } } }
const BODY = 'SKILL_BODY_MARKER_XYZ 这是一整段不该出现在会话里的技能提示词。'

const skill = {
  name: 'demo',
  description: '演示技能',
  body: BODY,
  path: '/fixture/.budingx/skills/demo/SKILL.md',
  scope: 'project',
  valid: true
}

test('技能正文作为 <skill> 包装交给模型，不混入用户自己的话', () => {
  const messages = [
    {
      id: 'm1',
      role: 'user',
      blocks: [
        { type: 'context', source: 'skill:demo', content: BODY },
        { type: 'text', text: '/demo' }
      ]
    }
  ]
  const [api] = normalizeForApi(messages)
  assert.match(api.content, /<skill name="demo">/)
  assert.match(api.content, /SKILL_BODY_MARKER_XYZ/)
  assert.doesNotMatch(api.content, /<file_context/)
})

test('TUI 里触发技能只显示一条短提示，不显示技能正文', async (t) => {
  const ui = await mountTty(t, {
    fullScreen: true,
    columns: 100,
    rows: 30,
    provider: idle,
    config: { model: 'fixture' },
    commandOverrides: { skills: [skill] }
  })
  await ui.send('/demo\r')
  await ui.waitFor((frame) => frame.includes('/demo'), 5000)
  const frame = ui.last()
  assert.ok(!frame.includes('SKILL_BODY_MARKER_XYZ'), `技能正文不应出现在会话里：\n${frame}`)
  assert.ok(!frame.includes('这是一整段不该出现'), '技能正文不应出现在会话里')
})

test('技能名出现在补全/帮助面，而不是会话正文', async (t) => {
  const ui = await mountTty(t, {
    fullScreen: true,
    columns: 100,
    rows: 30,
    provider: idle,
    config: { model: 'fixture' },
    commandOverrides: { skills: [skill] }
  })
  await ui.send('/help\r')
  await ui.waitFor((frame) => frame.includes('/demo'), 5000)
  assert.ok(!ui.last().includes('SKILL_BODY_MARKER_XYZ'))
})
