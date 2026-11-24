import assert from 'node:assert/strict'
import { test } from 'node:test'
import stringWidth from 'string-width'
import { frameWidths, mountTty } from './helpers/mount-tty.mjs'

test('AC-TASKS-01/02: /tasks shows the selected log and confirms stopping the exact task', async (t) => {
  const shell = { id: 'same-id', kind: 'shell', title: 'background shell', status: 'running' }
  const agent = { id: 'same-id', kind: 'agent', title: 'background agent', status: 'backgrounded' }
  let timedOut
  const reads = []
  const stops = []
  const taskPanel = {
    list: () => [{ ...shell }, { ...agent }, ...(timedOut ? [timedOut] : [])],
    readLog(row) {
      reads.push(row.kind)
      if (row.kind === 'agent') return { reason: 'no-log' }
      const lines = Array.from({ length: 25 }, (_, index) => `shell-log-line-${index + 1}`)
      return { text: [...lines, '\x1b[31mselected-shell-tail\x1b[0m'].join('\n'), truncated: true }
    },
    stop(row) {
      stops.push(row.kind)
      if (row.kind === 'agent') return { result: 'already-finished' }
      shell.status = 'cancelled'
      shell.exitReason = 'SIGTERM'
      return { result: 'requested' }
    }
  }
  const ui = await mountTty(t, {
    strategy: 'ascii',
    columns: 65,
    commandOverrides: { lang: 'en', taskPanel }
  })
  await ui.send('/tasks\r')
  let frame = await ui.waitFor((value) => value.includes('Background tasks') && value.includes('background shell'))
  assert.match(frame, /Shell.*running.*background shell/)
  assert.match(frame, /Agent.*backgrounded.*background agent/)
  assert.deepEqual(reads, [])

  await ui.send('\r')
  frame = await ui.waitFor((value) => value.includes('selected-shell-tail'))
  assert.match(frame, /Log tail/)
  assert.match(frame, /truncated/)
  assert.doesNotMatch(frame, /shell-log-line-1\b|background agent/)
  assert.deepEqual([...new Set(reads)], ['shell'])
  assert.ok(!ui.raw().includes('\x1b[31mselected-shell-tail'))
  assert.ok(frameWidths(frame, stringWidth).every((width) => width <= 65))

  await ui.send('\x1b[5~')
  await ui.waitFor((value) => value.includes('shell-log-line-10') && !value.includes('selected-shell-tail'))
  await ui.send('\x1b[6~')
  await ui.waitFor((value) => value.includes('selected-shell-tail'))

  await ui.send('s')
  await ui.waitFor((value) => value.includes('Stop background shell?'))
  assert.deepEqual(stops, [])
  await ui.send('n')
  await ui.waitFor((value) => !value.includes('Stop background shell?'))
  assert.deepEqual(stops, [])
  await ui.send('s')
  await ui.waitFor((value) => value.includes('Stop background shell?'))
  await ui.send('y')
  frame = await ui.waitFor((value) => value.includes('Stop requested') && value.includes('cancelled'))
  assert.match(frame, /SIGTERM/)
  assert.deepEqual(stops, ['shell'])

  await ui.send('\x1b')
  await ui.waitFor((value) => value.includes('Background tasks') && value.includes('background agent'))
  await ui.send('\x1b[B\r')
  frame = await ui.waitFor((value) => value.includes('No log is recorded for this task'))
  assert.match(frame, /Agent.*backgrounded/)
  assert.doesNotMatch(frame, /selected-shell-tail/)

  await ui.send('\x1b')
  await ui.waitFor((value) => value.includes('Background tasks') && value.includes('background agent'))
  await ui.send('s')
  await ui.waitFor((value) => value.includes('Stop background agent?'))
  agent.status = 'completed'
  await ui.send('y')
  frame = await ui.waitFor((value) => value.includes('Task already finished') && value.includes('completed'))
  assert.match(frame, /Agent.*completed/)
  assert.deepEqual(stops, ['shell', 'agent'])

  timedOut = { id: 'timed-out', kind: 'shell', title: 'timed-out shell', status: 'timeout' }
  await ui.waitFor((value) => value.includes('timeout') && value.includes('timed-out shell'))
  await ui.send('\x1b[As')
  frame = await ui.waitFor((value) => value.includes('Task already finished'))
  assert.doesNotMatch(frame, /Stop timed-out shell\?/)
  assert.deepEqual(stops, ['shell', 'agent'])

  await ui.send('\x1b')
  await ui.waitFor((value) => !value.includes('Background tasks'))
})
