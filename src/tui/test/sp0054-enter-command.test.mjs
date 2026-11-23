// 0.5.4：命令补全选中后回车直接执行。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mountTty } from './helpers/mount-tty.mjs'

test('0.5.4 选中 /help 回车直接执行而非报未知命令', async (t) => {
  const skill = {
    name: 'fixture-skill',
    description: '固定技能帮助说明',
    body: 'Fixture skill instructions',
    path: '<fixture>',
    scope: 'project',
    valid: true
  }
  const ui = await mountTty(t, {
    fullScreen: true,
    columns: 90,
    rows: 30,
    config: { model: 'fixture' },
    commandOverrides: { skills: [skill] },
    provider: {
      async *stream() {
        yield { type: 'message_completed', finishReason: 'stop' }
      }
    }
  })
  await ui.send('/')
  await ui.waitFor((f) => f.includes('/help'), 3000)
  await ui.send('\r')
  // 固定技能的说明出现在帮助正文末尾，全屏滚动到底时仍可见。
  const skillHelp = `/${skill.name}  ${skill.description}`
  const help = await ui.waitFor((frame) => frame.includes(skillHelp), 4000)
  assert.doesNotMatch(help, /未知命令/)
})
