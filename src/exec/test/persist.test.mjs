// SP004 T18 · 后台输出落盘与完成通知（design §4.4，CE-17）。
// 真实进程证据：输出写入 ~/.budingx 会话隔离路径，不写用户项目目录。
import { createHostProcessFixture } from './helpers/host-process.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs, { mkdirSync, mkdtempSync, readFileSync, existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

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
import {
  createOutputSpool,
  resolveTaskOutputPath,
  persistOutput,
  buildCommandFinishedEvent
} from '../../tui/dist/exec/persist.js'
import { createSandboxPolicy } from '../../tui/dist/exec/sandbox-policy.js'
import { OutputCollector } from '../../tui/dist/exec/output.js'

const verifiedBackend = createHostProcessFixture()

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

test('T18 路径解析：会话隔离的绝对路径且位于数据根下', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-persist-path-'))
  try {
    const p1 = resolveTaskOutputPath('session-a', 'task-1', home)
    const p2 = resolveTaskOutputPath('session-b', 'task-1', home)
    assert.ok(p1.endsWith(join('sessions', 'session-a', 'tasks', 'task-1.out')))
    assert.notEqual(p1, p2)
    assert.ok(p1.startsWith(home))
  } finally {
    await cleanupDir(home)
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
    await cleanupDir(home)
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
    await cleanupDir(home)
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
    assert.deepEqual(readdirSync(dirname(result.persistedOutputPath)), [basename(result.persistedOutputPath)])
  } finally {
    runner.dispose()
    await cleanupDir(home)
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
    await cleanupDir(home)
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
    await cleanupDir(home)
  }
})

test('SP004 输出快照只持有有界副本，不引用大输入块的底层缓冲', () => {
  const cap = 32768
  const collector = new OutputCollector(cap)
  const incoming = Buffer.alloc(2 * 1024 * 1024, 'x')
  collector.push(incoming)
  incoming.fill('y')
  const snapshot = collector.snapshot(cap)
  assert.equal(snapshot.bytes, incoming.length)
  assert.equal(snapshot.truncated, true)
  assert.ok(snapshot.text === 'x'.repeat(cap), '快照不应随已回收输入缓冲的修改而改变')
  const backingStores = new Set(Object.values(collector).flat().filter(Buffer.isBuffer).map((buffer) => buffer.buffer))
  assert.ok([...backingStores].reduce((total, buffer) => total + buffer.byteLength, 0) <= 2 * cap)
})

test('SP004 流式落盘临时文件冲突时恢复读取，并保留原文件', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-stream-collision-'))
  try {
    const path = join(home, 'owned.out')
    const partial = `${path}.partial`
    writeFileSync(partial, 'existing owner')
    const pauses = []
    const spool = createOutputSpool(path, (paused) => pauses.push(paused))
    spool.push(Buffer.alloc(64 * 1024))
    assert.deepEqual(await spool.finish(true), { warning: 'create_failed' })
    assert.equal(readFileSync(partial, 'utf8'), 'existing owner')
    assert.equal(existsSync(path), false)
    assert.deepEqual(pauses, [true, false])
  } finally {
    await cleanupDir(home)
  }
})

test('SP004 日志创建失败时保留前后台命令终态，并单独提示预期日志丢失', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-persist-unavailable-'))
  const events = []
  const runner = makeRunner(home, { onCommandFinished: (event) => events.push(event), persistThreshold: 4 })
  try {
    const tasks = dirname(resolveTaskOutputPath('session-a', 'fixture', home))
    mkdirSync(dirname(tasks), { recursive: true })
    writeFileSync(tasks, 'not a directory')
    const context = { signal: new AbortController().signal, cwd: home }
    const command = 'node -e "process.stdout.write(\'fixture\')"'
    const live = await runner.run({ command, runInBackground: true }, context)
    assert.equal(live.outcome, 'running')
    assert.equal(live.outputWarning, 'create_failed')
    assert.equal(runner.status(live.taskId).outputWarning, 'create_failed')
    const done = await waitForDone(runner, live.taskId)
    const foreground = await runner.run({ command }, context)
    for (const result of [done, foreground]) {
      assert.equal(result.outcome, 'completed')
      assert.equal(result.exitCode, 0)
      assert.equal(result.errorCode, undefined)
      assert.equal(result.stderr, '')
      assert.equal(result.stdout, 'fixture')
      assert.equal(result.outputWarning, 'create_failed')
      assert.equal(result.persistedOutputPath, undefined)
    }
    assert.equal(events.length, 1)
    assert.equal(events[0].outputWarning, 'create_failed')
    assert.equal(events[0].exitCode, 0)
    assert.equal(events[0].outputPath, undefined)
    const small = await runner.run({ command: 'node -e "process.stdout.write(\'tiny\')"' }, context)
    assert.equal(small.outcome, 'completed')
    assert.equal(small.outputWarning, undefined)
    assert.equal(readFileSync(tasks, 'utf8'), 'not a directory')
  } finally {
    runner.dispose()
    await cleanupDir(home)
  }
})

test('SP004 日志无法发布时返回发布失败警告并清理本次临时文件', async () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-publish-blocked-'))
  try {
    const path = join(home, 'blocked.out')
    mkdirSync(path)
    const spool = createOutputSpool(path, () => {})
    spool.push(Buffer.from('some output'))
    assert.deepEqual(await spool.finish(true), { warning: 'publish_failed' })
    assert.equal(existsSync(`${path}.partial`), false)
    assert.equal(statSync(path).isDirectory(), true)
  } finally {
    await cleanupDir(home)
  }
})

test('SP004 日志写入失败时恢复背压并清理临时文件', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-stream-write-blocked-'))
  const pauses = []
  // The spool really opens its file. Only the ensuing write is simulated as a full disk.
  const write = t.mock.method(fs, 'write', (_fd, _buffer, _offset, _length, _position, callback) => {
    process.nextTick(() => callback(Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' })))
  })
  try {
    const path = join(home, 'blocked.out')
    const spool = createOutputSpool(path, (paused) => pauses.push(paused))
    spool.push(Buffer.alloc(64 * 1024))
    assert.deepEqual(await spool.finish(true), { warning: 'write_failed' })
    assert.equal(write.mock.callCount(), 1)
    assert.deepEqual(pauses, [true, false])
    assert.deepEqual(readdirSync(home), [])
  } finally {
    write.mock.restore()
    await cleanupDir(home)
  }
})

test('SP004 前台、显式后台及自动后台均在进程退出前流式落盘', async (t) => {
  for (const mode of ['foreground', 'background', 'auto-background']) {
    await t.test(mode, async () => {
      const home = mkdtempSync(join(tmpdir(), 'budingx-stream-output-'))
      let child
      const size = 64 * 1024
      const fixture = createHostProcessFixture({
        spawn: (_program, _args, options) => {
          child = spawn(process.execPath, ['-e',
            `process.stdout.write(Buffer.alloc(${size}, 65)); process.stdin.resume()`], options)
          return child
        }
      })
      const backend = { ...fixture, keepsSupervisorStdinOpen: true }
      const runner = makeRunner(home, {
        sandboxPolicy: createSandboxPolicy({ backend }),
        persistThreshold: 1024,
        ...(mode === 'auto-background' ? { blockingBudgetMs: 100 } : {})
      })
      const running = runner.run({ command: 'node fixture.js', runInBackground: mode === 'background' },
        { signal: new AbortController().signal, cwd: home })
      try {
        const directory = join(home, '.budingx', 'sessions', 'session-a', 'tasks')
        const deadline = Date.now() + 3000
        let partial
        do {
          if (existsSync(directory)) {
            partial = readdirSync(directory).map((name) => join(directory, name))
              .find((path) => path.endsWith('.partial') && statSync(path).size === size)
          }
          if (!partial) await new Promise((resolve) => setTimeout(resolve, 20))
        } while (!partial && Date.now() < deadline)
        assert.ok(partial, '子进程正在等待时，完整原始数据已进入临时输出流文件')
        assert.equal(child.exitCode, null)
        assert.equal(readFileSync(partial, 'utf8'), 'A'.repeat(size))
        child.stdin.end()
        const result = await running
        const done = result.outcome === 'running' ? await waitForDone(runner, result.taskId) : result
        assert.equal(done.outcome, 'completed')
        assert.equal(done.bytes, size)
        assert.equal(done.truncated, true)
        assert.equal(done.persistedOutputSize, size)
        assert.equal(done.persistedOutputPath + '.partial', partial)
        assert.equal(existsSync(partial), false)
        assert.equal(readFileSync(done.persistedOutputPath, 'utf8'), 'A'.repeat(size))
      } finally {
        child?.stdin.end()
        runner.dispose()
        await running
        await cleanupDir(home)
      }
    })
  }
})
