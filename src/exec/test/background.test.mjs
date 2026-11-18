// SP004 T4 · 后台任务与进程树取消 RED→GREEN。证据层级 L1（真实进程）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCommandRunner } from '../../tui/dist/exec/runner.js'
import { createSandboxPolicy } from '../../tui/dist/exec/sandbox-policy.js'

const verifiedBackend = {
  id: 'synthetic-backend',
  label: '合成验收后端',
  verified: true,
  capabilities: {
    allowWrite: [],
    denyWrite: [],
    allowRead: [],
    denyRead: [],
    networkDomains: [],
    canEnforceNetwork: false
  }
}

function makeRunner(extra = {}) {
  return createCommandRunner({
    defaultCwd: process.cwd(),
    sandboxPolicy: createSandboxPolicy({ backend: verifiedBackend }),
    ...extra
  })
}

function ctx(signal) {
  return { signal: signal ?? new AbortController().signal, cwd: process.cwd() }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(fn, timeoutMs = 5000, stepMs = 50) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = fn()
    if (value) return value
    await sleep(stepMs)
  }
  return undefined
}

test('CE-06 runInBackground 立即返回 running 与 taskId', async () => {
  const runner = makeRunner()
  const started = Date.now()
  const result = await runner.run(
    { command: 'node -e "setTimeout(()=>{},3000)"', runInBackground: true },
    ctx()
  )
  assert.ok(Date.now() - started < 2000, '后台启动必须立即返回')
  assert.equal(result.outcome, 'running')
  assert.ok(result.taskId, '必须返回 taskId')
  assert.equal(runner.status(result.taskId)?.outcome, 'running')
  assert.ok(runner.list().some((task) => task.taskId === result.taskId))
  assert.equal(runner.cancel(result.taskId), true)
})

test('CE-06 status 轮询可见终态与输出', async () => {
  const runner = makeRunner()
  const result = await runner.run(
    { command: `node -e "process.stdout.write('bg-out')"`, runInBackground: true },
    ctx()
  )
  const final = await waitFor(() => {
    const snapshot = runner.status(result.taskId)
    return snapshot && snapshot.outcome !== 'running' ? snapshot : undefined
  })
  assert.ok(final, '5s 内必须到达终态')
  assert.equal(final.outcome, 'completed')
  assert.equal(final.exitCode, 0)
  assert.ok(final.stdout.includes('bg-out'))
  // 终态后取消幂等返回 false。
  assert.equal(runner.cancel(result.taskId), false)
})

test('CE-07 cancel 终止任务且重复取消幂等', async () => {
  const runner = makeRunner()
  const result = await runner.run(
    { command: 'node -e "setTimeout(()=>{},60000)"', runInBackground: true },
    ctx()
  )
  assert.equal(runner.cancel(result.taskId), true)
  const final = await waitFor(() => {
    const snapshot = runner.status(result.taskId)
    return snapshot && snapshot.outcome === 'cancelled' ? snapshot : undefined
  })
  assert.ok(final, '取消后 5s 内状态必须为 cancelled')
  assert.equal(runner.cancel(result.taskId), false)
  assert.equal(runner.cancel('task-not-exists'), false)
})

test('CE-07/R-02 取消终止整棵进程树（孙进程 5s 内消失）', async () => {
  const runner = makeRunner()
  const script =
    "const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)']);" +
    'process.stdout.write(String(c.pid));setTimeout(()=>{},60000)'
  const result = await runner.run(
    { command: `node -e "${script}"`, runInBackground: true },
    ctx()
  )
  const pidText = await waitFor(() => {
    const snapshot = runner.status(result.taskId)
    const text = snapshot?.stdout ?? ''
    return /^\d+$/.test(text.trim()) ? text.trim() : undefined
  })
  assert.ok(pidText, '5s 内必须读到孙进程 pid')
  const grandPid = Number(pidText)
  assert.equal(runner.cancel(result.taskId), true)
  const gone = await waitFor(() => {
    try {
      process.kill(grandPid, 0)
      return false
    } catch {
      return true
    }
  })
  assert.ok(gone, '孙进程必须在取消后 5s 内消失')
})

test('CE-14 AbortSignal 触发后台任务转 cancelled', async () => {
  const runner = makeRunner()
  const controller = new AbortController()
  const result = await runner.run(
    { command: 'node -e "setTimeout(()=>{},60000)"', runInBackground: true },
    ctx(controller.signal)
  )
  await sleep(300)
  controller.abort()
  const final = await waitFor(() => {
    const snapshot = runner.status(result.taskId)
    return snapshot && snapshot.outcome === 'cancelled' ? snapshot : undefined
  })
  assert.ok(final, 'abort 后 5s 内状态必须为 cancelled')
})