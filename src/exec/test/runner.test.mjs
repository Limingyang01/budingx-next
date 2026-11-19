// SP004 T3 · 真实进程执行（前台）RED→GREEN。证据层级 L1（真实进程）。
import { createHostProcessFixture } from './helpers/host-process.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCommandRunner } from '../../tui/dist/exec/runner.js'
import { createSandboxPolicy } from '../../tui/dist/exec/sandbox-policy.js'
import { EXEC_OUTPUT_CAP } from '../../tui/dist/core/exec.js'

const verifiedBackend = createHostProcessFixture()

function makeRunner(extra = {}) {
  const { spawn: spawnOverride, ...options } = extra
  return createCommandRunner({
    defaultCwd: process.cwd(),
    sandboxPolicy: createSandboxPolicy({
      backend: spawnOverride === undefined ? verifiedBackend : createHostProcessFixture({ spawn: spawnOverride })
    }),
    ...options
  })
}

function ctx(cwd = process.cwd()) {
  return { signal: new AbortController().signal, cwd }
}

test('CE-01 stdout/stderr 分离且退出码为 0', async () => {
  const runner = makeRunner()
  const result = await runner.run(
    { command: `node -e "process.stdout.write('out');process.stderr.write('err')"` },
    ctx()
  )
  assert.equal(result.outcome, 'completed')
  assert.equal(result.exitCode, 0)
  assert.ok(result.stdout.includes('out'))
  assert.ok(result.stderr.includes('err'))
  assert.ok(!result.stdout.includes('err'))
  assert.ok(result.output.includes('out') && result.output.includes('err'))
})

test('CE-01/CT-08 非零退出码不被吞', async () => {
  const runner = makeRunner()
  const result = await runner.run({ command: 'node -e "process.exit(3)"' }, ctx())
  assert.equal(result.outcome, 'failed')
  assert.equal(result.exitCode, 3)
})

test('CE-02 含空格与中文的 cwd 原样到达子进程', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp004 空格 中文-'))
  try {
    const runner = makeRunner()
    const result = await runner.run(
      { command: 'node -e "process.stdout.write(process.cwd())"', cwd: dir },
      ctx(dir)
    )
    assert.equal(result.outcome, 'completed')
    assert.equal(result.stdout, fs.realpathSync(dir))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('CE-02 含空格/中文路径的脚本参数经 quoting 原样到达', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp004 脚本-'))
  const scriptPath = path.join(dir, '脚本 空格.mjs')
  fs.writeFileSync(scriptPath, 'process.stdout.write(process.argv[1])\n')
  try {
    const runner = makeRunner()
    const result = await runner.run({ command: `node "${scriptPath}"`, cwd: dir }, ctx(dir))
    assert.equal(result.outcome, 'completed')
    assert.equal(result.stdout, scriptPath)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('CE-04 超时终止进程并返回 timeout', async () => {
  const runner = makeRunner()
  const started = Date.now()
  const result = await runner.run(
    { command: 'node -e "setTimeout(()=>{},60000)"', timeoutMs: 300 },
    ctx()
  )
  const elapsed = Date.now() - started
  assert.equal(result.outcome, 'timeout')
  assert.ok(elapsed < 5000, `耗时应 < 5s，实际 ${elapsed}ms`)
  assert.ok(result.reason && result.reason.length > 0)
})

test('CE-05 100KB 输出触发截断标注', async () => {
  const runner = makeRunner()
  const result = await runner.run(
    { command: `node -e "process.stdout.write('x'.repeat(100000))"` },
    ctx()
  )
  assert.equal(result.outcome, 'completed')
  assert.equal(result.truncated, true)
  assert.ok(result.bytes > EXEC_OUTPUT_CAP)
  assert.ok(result.output.includes('[输出已截断'))
  assert.ok(result.stdout.includes('[输出已截断'))
})

test('CE-15 自定义环境变量到达子进程', async () => {
  const runner = makeRunner({ allowedEnv: ['BUDINGX_TEST_VAR'] })
  const result = await runner.run(
    {
      command: 'node -e "process.stdout.write(process.env.BUDINGX_TEST_VAR)"',
      env: { BUDINGX_TEST_VAR: '你好-sp004' }
    },
    ctx()
  )
  assert.equal(result.outcome, 'completed')
  assert.equal(result.stdout, '你好-sp004')
})

test('CE-12 交互式族命令显式失败且不挂起', async () => {
  const runner = makeRunner()
  const started = Date.now()
  const result = await runner.run({ command: 'vim somefile.txt' }, ctx())
  assert.equal(result.outcome, 'failed')
  assert.ok(result.reason.includes('交互式'))
  assert.ok(Date.now() - started < 2000)
})

test('CE-13 阻塞等待族命令拦截并指引后台', async () => {
  const runner = makeRunner()
  const result = await runner.run({ command: 'sleep 30' }, ctx())
  assert.equal(result.outcome, 'blocked')
  assert.ok(result.reason.includes('runInBackground'))
})

test('CE-19 缺隔离后端拒绝且零 spawn', async () => {
  let starts = 0
  const runner = createCommandRunner({ defaultCwd: process.cwd() })
  const result = await runner.run({ command: 'node --version' }, {
    ...ctx(),
    onStarted: () => starts++
  })
  assert.equal(result.outcome, 'blocked')
  assert.ok(result.reason.includes('隔离'))
  assert.equal(starts, 0)
})

test('缺少启动与终止能力的后端即使标记已验证也不能启动', async () => {
  const runner = createCommandRunner({
    defaultCwd: process.cwd(),
    sandboxPolicy: createSandboxPolicy({
      backend: { ...verifiedBackend, start: undefined, terminate: undefined }
    })
  })
  assert.equal((await runner.run({ command: 'node --version' }, ctx())).outcome, 'blocked')
})

test('当前项目之外的工作目录在后端启动前被拒绝', async () => {
  let starts = 0
  const runner = makeRunner({
    spawn: (...args) => {
      starts++
      return spawn(...args)
    }
  })
  const result = await runner.run({ command: 'node --version', cwd: path.dirname(process.cwd()) }, ctx())
  assert.equal(result.outcome, 'blocked')
  assert.equal(starts, 0)
})

test('隔离后端启动和终止进程，且只收到明确放行的环境变量', async () => {
  const secret = 'BUDINGX_REVIEW_PRIVATE'
  process.env[secret] = 'synthetic'
  const launched = []
  const terminated = []
  try {
    const backend = {
      ...verifiedBackend,
      capabilities: { ...verifiedBackend.capabilities, canEnforceNetwork: true },
      start(request) {
        launched.push(request)
        return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'])
      },
      terminate(child) {
        terminated.push(child)
        child.kill()
      }
    }
    const runner = createCommandRunner({
      defaultCwd: process.cwd(),
      sandboxPolicy: createSandboxPolicy({ backend }),
      allowedEnv: ['BUDINGX_REVIEW_ALLOWED']
    })
    const result = await runner.run({
      command: 'node --version',
      env: { BUDINGX_REVIEW_ALLOWED: 'fixture', NODE_OPTIONS: 'fixture', [secret]: 'fixture' },
      timeoutMs: 150
    }, ctx())
    assert.equal(result.outcome, 'timeout')
    assert.equal(launched.length, 1)
    assert.equal(terminated.length, 1)
    assert.equal(launched[0].env.BUDINGX_REVIEW_ALLOWED, 'fixture')
    assert.equal(launched[0].env.NODE_OPTIONS, undefined)
    assert.equal(launched[0].env[secret], undefined)
  } finally {
    delete process.env[secret]
  }
})

test('交互式/阻塞拦截路径同样零 spawn', async () => {
  let calls = 0
  const countingSpawn = (...args) => {
    calls += 1
    return spawn(...args)
  }
  const runner = makeRunner({ spawn: countingSpawn })
  const interactive = await runner.run({ command: 'vim' }, ctx())
  const blocking = await runner.run({ command: 'sleep 5' }, ctx())
  assert.equal(interactive.outcome, 'failed')
  assert.equal(blocking.outcome, 'blocked')
  assert.equal(calls, 0)
})

test('硬上限超时拒绝启动且零 spawn', async () => {
  let calls = 0
  const countingSpawn = (...args) => {
    calls += 1
    return spawn(...args)
  }
  const runner = makeRunner({ spawn: countingSpawn })
  const result = await runner.run({ command: 'node --version', timeoutMs: 900001 }, ctx())
  assert.notEqual(result.outcome, 'completed')
  assert.ok(result.reason.includes('硬上限'))
  assert.equal(calls, 0)
})

test('预先 abort 的信号直接 cancelled 且零 spawn', async () => {
  let calls = 0
  const countingSpawn = (...args) => {
    calls += 1
    return spawn(...args)
  }
  const runner = makeRunner({ spawn: countingSpawn })
  const controller = new AbortController()
  controller.abort()
  const result = await runner.run({ command: 'node --version' }, { signal: controller.signal, cwd: process.cwd() })
  assert.equal(result.outcome, 'cancelled')
  assert.equal(calls, 0)
})
