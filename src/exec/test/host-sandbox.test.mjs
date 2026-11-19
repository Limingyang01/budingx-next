import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { existsSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import { createHostSandboxFromEnvironment } from '../../tui/dist/exec/host-sandbox.js'
import { createCommandRunner } from '../../tui/dist/exec/runner.js'
import { createSandboxPolicy } from '../../tui/dist/exec/sandbox-policy.js'

test('host backend requires explicit opt-in', () => {
  assert.equal(createHostSandboxFromEnvironment({}), undefined)
  assert.equal(createHostSandboxFromEnvironment({ BUDINGX_SANDBOX: 'unknown' }), undefined)
})

test('Bubblewrap gates workspace, credentials, network, and cancellation in real processes', {
  skip: process.env.BUDINGX_TEST_BUBBLEWRAP !== '1' && 'requires host Bubblewrap smoke opt-in',
  timeout: 45000
}, async (t) => {
  const backend = createHostSandboxFromEnvironment({
    ...process.env, BUDINGX_SANDBOX: 'bubblewrap'
  })
  assert.ok(backend?.verified, 'Bubblewrap must pass its runtime verification on this host')
  const temp = realpathSync(tmpdir())
  const root = mkdtempSync(join(temp, 'sp004-bwrap-'))
  t.after(() => {
    assert.equal(dirname(realpathSync(root)), temp)
    assert.match(basename(root), /^sp004-bwrap-/)
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const workspace = join(root, 'space 中文')
  mkdirSync(join(workspace, 'nested', '.git'), { recursive: true })
  mkdirSync(join(workspace, '.ssh'))
  writeFileSync(join(workspace, 'visible.txt'), 'workspace-visible')
  writeFileSync(join(workspace, 'denied.txt'), 'workspace-denied')
  writeFileSync(join(workspace, 'nested', '.env'), 'private fixture')
  linkSync(join(workspace, 'nested', '.env'), join(workspace, 'credential-alias.txt'))
  writeFileSync(join(workspace, 'nested', '.git', 'config'), 'private fixture')
  writeFileSync(join(root, 'outside.txt'), 'private fixture')

  const socket = createServer()
  await new Promise((resolve, reject) => {
    socket.on('error', reject)
    socket.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => socket.close())
  assert.equal(typeof socket.address(), 'object')
  const runner = createCommandRunner({
    defaultCwd: workspace,
    sandboxPolicy: createSandboxPolicy({ backend }),
    isWorkspacePathReadable: (path) => path !== 'denied.txt'
  })
  t.after(() => runner.dispose())
  const run = (command, mode, background = false) => runner.run({
    command, interpreter: 'Bash', runInBackground: background
  }, { signal: new AbortController().signal, cwd: workspace, mode })
  const before = await run(`set -eu
    cat visible.txt
    test ! -e nested/.git && test ! -e nested/.env && test ! -e .ssh
    test ! -e denied.txt && test ! -e credential-alias.txt && test ! -e ../outside.txt && test ! -e /mnt/c
    if ( : >/dev/tcp/127.0.0.1/${socket.address().port} ) 2>/dev/null; then exit 19; fi
    test ! -e /init
    if command -v python3 >/dev/null; then
      python3 -c 'import errno, socket
try:
    socket.socket(socket.AF_VSOCK)
except OSError as error:
    assert error.errno == errno.EAFNOSUPPORT
else:
    raise AssertionError("non-local socket family was allowed")'
    fi
  `, 'read_only')
  assert.equal(before.exitCode, 0, before.output || before.reason)
  assert.match(before.stdout, /workspace-visible/)
  const readonly = await run('printf test > generated.txt', 'read_only')
  assert.notEqual(readonly.exitCode, 0, readonly.output)
  const writable = await run('printf test > generated.txt && cat generated.txt', 'workspace')
  assert.equal(writable.exitCode, 0, writable.output || writable.reason)
  assert.match(writable.stdout, /test/)
  assert.equal(existsSync(join(workspace, 'generated.txt')), false)
  const marker = `budingx-isolation-${randomUUID()}`
  function runningDescendant() {
    const argv = ['-f', `^${marker} `]
    const distro = process.env.BUDINGX_WSL_DISTRO
    const processList = process.platform === 'win32'
      ? spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe'), [
        ...(distro ? ['--distribution', distro] : []), '--cd', '/', '--exec', '/usr/bin/pgrep', ...argv
      ], { timeout: 5000, windowsHide: true })
      : spawnSync('/usr/bin/pgrep', argv, { timeout: 5000 })
    assert.ok(processList.status === 0 || processList.status === 1)
    return processList.status === 0
  }
  const background = await run(`/bin/bash -c 'exec -a ${marker} /usr/bin/sleep 30' & wait`, 'workspace', true)
  assert.equal(background.outcome, 'running', background.reason)
  const startedDeadline = Date.now() + 5000
  let descendantStarted = runningDescendant()
  while (Date.now() < startedDeadline && !descendantStarted) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    descendantStarted = runningDescendant()
  }
  assert.equal(descendantStarted, true, 'fixture descendant must exist before cancellation')
  assert.equal(runner.cancel(background.taskId), true)
  const deadline = Date.now() + 8000
  while (Date.now() < deadline && runner.status(background.taskId)?.outcome === 'running') {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.equal(runner.status(background.taskId)?.outcome, 'cancelled')
  assert.equal(runningDescendant(), false, 'the real sandbox descendant must be gone after cancellation')
})
