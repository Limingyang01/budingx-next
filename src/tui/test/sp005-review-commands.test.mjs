// SP005 复审回归：/memory 缺少分隔符时的用法提示。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runCommand } from '../dist/tui/commands.js'

test('/memory 缺少分隔符时给出用法，而不是把整串当成标题', async () => {
  const written = []
  const context = {
    memory: {
      read: () => ({ entries: [] }),
      write: (scope, title, text) => {
        written.push({ scope, title, text })
        return { ok: true }
      }
    }
  }
  const outcome = await runCommand('/memory project add 没有冒号的标题', context)
  assert.match(outcome.error, /Usage/)
  assert.equal(written.length, 0)
})
