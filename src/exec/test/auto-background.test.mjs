// SP004 T19 · 前台阻塞预算自动转后台（design §4.4，CE-16）。
// 真实进程证据：测试注入缩短预算（生产默认 EXEC_BLOCKING_BUDGET_MS=15000）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Windows 下刚退出的 shell 可能短暂占用临时目录：清理带重试并最终忽略失败。 */
async function cleanupDir(dir) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}
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
    canEnforceNetwork: true
  }
}

function makeRunner(home, extra = {}) {
  return createCommandRunner({
    defaultCwd: home,
    sandboxPolicy: createSandboxPolicy({ backend: verifiedBackend }),
    sessionId: 'session-auto',
    home,
    blockingBudgetMs: 300,
    ...extra
  })
}

async function waitForDone(runner, taskId, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const snap = runner.status(taskId)
    if (snap && snap.outcome !== 'running') return snap
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`任务 ${taskId} 未在 ${timeoutMs}ms 内结束`)
}

test('T19-1 超过阻塞预算：立即返回 running+autoBackgrounded，回合不被阻塞', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-auto-bg-'))
  const runner = makeRunner(home)
  try {
    const started = Date.now()
    const result = await runner.run(
      { command: `node -e "setTimeout(() => process.stdout.write('late-output'), 1200)"` },
      { signal: new AbortController().signal, cwd: home }
    )
    const elapsed = Date.now() - started
    assert.equal(result.outcome, 'running')
    assert.equal(result.autoBackgrounded, true)
    assert.ok(result.taskId, '自动转后台必须回填 taskId')
    assert.ok(elapsed < 1100, `回合应立即返回（实测 ${elapsed}ms）`)
    assert.match(result.reason ?? '', /阻塞预算/)
    assert.match(result.reason ?? '', /后台/)
    // 完成后经 status 查询终态，完整输出落盘回传。
    const done = await waitForDone(runner, result.taskId)
    assert.equal(done.outcome, 'completed')
    assert.equal(done.exitCode, 0)
    assert.ok(done.stdout.includes('late-output'))
    assert.ok(done.persistedOutputPath, '自动后台任务输出应落盘')
    assert.equal(readFileSync(done.persistedOutputPath, 'utf8').includes('late-output'), true)
    assert.ok(done.persistedOutputPath.startsWith(home))
  } finally {
    runner.dispose()
    await cleanupDir(home)
  }
})

test('T19-2 预算内完成：completed 不误转后台', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-auto-bg-fast-'))
  // 预算放宽到 3000ms：并行测试负载下 node 启动可能超过 300ms，本用例只验证「预算内不误转」。
  const runner = makeRunner(home, { blockingBudgetMs: 3000 })
  try {
    const result = await runner.run(
      { command: `node -e "process.stdout.write('quick')"` },
      { signal: new AbortController().signal, cwd: home }
    )
    assert.equal(result.outcome, 'completed')
    assert.equal(result.exitCode, 0)
    assert.ok(result.stdout.includes('quick'))
    assert.equal(result.autoBackgrounded, undefined)
    assert.equal(result.taskId, undefined)
  } finally {
    runner.dispose()
    await cleanupDir(home)
  }
})

test('T19-3 自动转后台后 status/cancel 可用且取消幂等', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-auto-bg-cancel-'))
  const runner = makeRunner(home, { blockingBudgetMs: 200 })
  try {
    const result = await runner.run(
      { command: `node -e "setTimeout(() => {}, 30000)"` },
      { signal: new AbortController().signal, cwd: home }
    )
    assert.equal(result.outcome, 'running')
    assert.equal(result.autoBackgrounded, true)
    const snap = runner.status(result.taskId)
    assert.ok(snap)
    assert.equal(snap.outcome, 'running')
    assert.equal(runner.cancel(result.taskId), true)
    const done = await waitForDone(runner, result.taskId)
    assert.equal(done.outcome, 'cancelled')
    assert.equal(runner.cancel(result.taskId), false, '已终态取消应幂等返回 false')
  } finally {
    runner.dispose()
    await cleanupDir(home)
  }
})