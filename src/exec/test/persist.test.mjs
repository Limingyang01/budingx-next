// SP004 T18 · 后台输出落盘与完成通知（design §4.4，CE-17）。
// 真实进程证据：输出写入 ~/.budingx 会话隔离路径，不写用户项目目录。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCommandRunner } from '../../tui/dist/exec/runner.js'
import {
  resolveTaskOutputPath,
  persistOutput,
  buildCommandFinishedEvent
} from '../../tui/dist/exec/persist.js'
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
    sessionId: 'session-a',
    home,
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

test('T18 路径解析：会话隔离的绝对路径且位于数据根下', () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-persist-path-'))
  try {
    const p1 = resolveTaskOutputPath('session-a', 'task-1', home)
    const p2 = resolveTaskOutputPath('session-b', 'task-1', home)
    assert.ok(p1.endsWith(join('sessions', 'session-a', 'tasks', 'task-1.out')))
    assert.notEqual(p1, p2)
    assert.ok(p1.startsWith(home))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('T18 persistOutput：创建目录并返回真实字节数', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-persist-write-'))
  try {
    const path = resolveTaskOutputPath('session-a', 'task-w', home)
    const content = '你好，输出\nsecond line\n'
    const result = await persistOutput(path, content)
    assert.equal(result.path, path)
    assert.equal(result.size, Buffer.byteLength(content, 'utf8'))
    assert.equal(readFileSync(path, 'utf8'), content)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('T18-1 后台任务输出落盘且内容与实际输出一致（真实进程）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-persist-bg-'))
  const runner = makeRunner(home)
  try {
    const started = await runner.run(
      { command: 'node -e "process.stdout.write(\'persist-ok\')"', runInBackground: true },
      { signal: new AbortController().signal, cwd: home }
    )
    assert.equal(started.outcome, 'running')
    const done = await waitForDone(runner, started.taskId)
    assert.equal(done.outcome, 'completed')
    assert.ok(done.persistedOutputPath, '后台完成应回传落盘路径')
    assert.ok(done.persistedOutputPath.startsWith(home))
    assert.ok(!done.persistedOutputPath.startsWith(process.cwd()))
    assert.equal(readFileSync(done.persistedOutputPath, 'utf8'), 'persist-ok')
    assert.equal(done.persistedOutputSize, Buffer.byteLength('persist-ok', 'utf8'))
    const snap = runner.status(started.taskId)
    assert.equal(snap.persistedOutputPath, done.persistedOutputPath)
  } finally {
    runner.dispose()
    rmSync(home, { recursive: true, force: true })
  }
})

test('T18-2 超大前台输出落盘并回传路径与字节数（真实进程）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-persist-big-'))
  const runner = makeRunner(home, { persistThreshold: 1024 })
  try {
    const result = await runner.run(
      { command: 'node -e "process.stdout.write(\'x\'.repeat(8192))"' },
      { signal: new AbortController().signal, cwd: home }
    )
    assert.equal(result.outcome, 'completed')
    assert.equal(result.bytes, 8192)
    assert.ok(result.persistedOutputPath, '超阈值前台输出应落盘')
    assert.equal(result.persistedOutputSize, 8192)
    assert.equal(readFileSync(result.persistedOutputPath, 'utf8'), 'x'.repeat(8192))
    // 小输出不落盘。
    const small = await runner.run(
      { command: 'node -e "process.stdout.write(\'tiny\')" ' },
      { signal: new AbortController().signal, cwd: home }
    )
    assert.equal(small.outcome, 'completed')
    assert.equal(small.persistedOutputPath, undefined)
  } finally {
    runner.dispose()
    rmSync(home, { recursive: true, force: true })
  }
})

test('T18-3 不同会话 ID 的输出互不覆盖（真实进程）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-persist-sess-'))
  const runnerA = makeRunner(home)
  const runnerB = makeRunner(home, { sessionId: 'session-b' })
  try {
    const a = await runnerA.run(
      { command: 'node -e "process.stdout.write(\'AAA\')"', runInBackground: true },
      { signal: new AbortController().signal, cwd: home }
    )
    const b = await runnerB.run(
      { command: 'node -e "process.stdout.write(\'BBB\')"', runInBackground: true },
      { signal: new AbortController().signal, cwd: home }
    )
    const doneA = await waitForDone(runnerA, a.taskId)
    const doneB = await waitForDone(runnerB, b.taskId)
    assert.notEqual(doneA.persistedOutputPath, doneB.persistedOutputPath)
    assert.ok(doneA.persistedOutputPath.includes('session-a'))
    assert.ok(doneB.persistedOutputPath.includes('session-b'))
    assert.equal(readFileSync(doneA.persistedOutputPath, 'utf8'), 'AAA')
    assert.equal(readFileSync(doneB.persistedOutputPath, 'utf8'), 'BBB')
  } finally {
    runnerA.dispose()
    runnerB.dispose()
    rmSync(home, { recursive: true, force: true })
  }
})

test('T18-4 任务完成产生 command_finished 事件（真实进程）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-persist-event-'))
  const events = []
  const runner = makeRunner(home, { onCommandFinished: (event) => events.push(event) })
  try {
    const started = await runner.run(
      { command: 'node -e "process.stdout.write(\'evt\'); process.exit(2)"', runInBackground: true },
      { signal: new AbortController().signal, cwd: home }
    )
    const done = await waitForDone(runner, started.taskId)
    assert.equal(done.outcome, 'failed')
    assert.equal(done.exitCode, 2)
    assert.equal(events.length, 1)
    const event = events[0]
    assert.equal(event.type, 'command_finished')
    assert.equal(event.taskId, started.taskId)
    assert.equal(event.outcome, 'failed')
    assert.equal(event.exitCode, 2)
    assert.equal(event.outputPath, done.persistedOutputPath)
    assert.equal(typeof event.finishedAt, 'number')
    // 事件构造器纯函数形状一致。
    const built = buildCommandFinishedEvent({
      taskId: 'task-x',
      outcome: 'completed',
      exitCode: 0,
      outputPath: '/tmp/x.out',
      finishedAt: 123
    })
    assert.deepEqual(built, {
      type: 'command_finished',
      taskId: 'task-x',
      outcome: 'completed',
      exitCode: 0,
      outputPath: '/tmp/x.out',
      finishedAt: 123
    })
  } finally {
    runner.dispose()
    rmSync(home, { recursive: true, force: true })
  }
})