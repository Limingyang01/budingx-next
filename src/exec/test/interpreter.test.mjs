// SP004 T2 · 解释器选择与只读/阻塞/交互式命令族判定（设计 §4.2 / §4.3 / §4.5）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { selectInterpreter } from '../../tui/dist/exec/interpreter.js'
import {
  isReadOnlyCommand,
  isBlockingWaitCommand,
  isInteractiveCommand
} from '../../tui/dist/exec/readonly-commands.js'

test('Windows Bash 探测到真实 Git Bash', (t) => {
  if (process.platform !== 'win32') return t.skip('仅 Windows 主机')
  const result = selectInterpreter('Bash', 'win32')
  assert.ok(!('error' in result), JSON.stringify(result))
  assert.ok(result.shell.toLowerCase().endsWith('bash.exe'), result.shell)
  assert.equal(existsSync(result.shell), true)
  assert.deepEqual(result.args, ['-c'])
  assert.equal(result.label, 'Git Bash')
})

test('POSIX Bash 探测与缺失回落（注入探测）', () => {
  const found = selectInterpreter('Bash', 'linux', { exists: () => true })
  assert.ok(!('error' in found))
  assert.equal(found.shell, '/bin/bash')
  assert.deepEqual(found.args, ['-c'])
  assert.equal(found.label, 'Bash')
  const missing = selectInterpreter('Bash', 'linux', { exists: () => false })
  assert.ok('error' in missing)
  assert.ok(missing.error.includes('Bash'), missing.error)
})

test('Windows 缺 Git Bash 返回结构化错误（注入探测）', () => {
  const missing = selectInterpreter('Bash', 'win32', { exists: () => false })
  assert.ok('error' in missing)
  assert.ok(missing.error.includes('Git Bash'), missing.error)
})

test('Windows PowerShell 探测到真实 Windows PowerShell', (t) => {
  if (process.platform !== 'win32') return t.skip('仅 Windows 主机')
  const result = selectInterpreter('PowerShell', 'win32')
  assert.ok(!('error' in result), JSON.stringify(result))
  assert.ok(result.shell.toLowerCase().endsWith('powershell.exe'), result.shell)
  assert.equal(existsSync(result.shell), true)
  assert.deepEqual(result.args, ['-NoProfile', '-NonInteractive', '-Command'])
  assert.equal(result.label, 'Windows PowerShell')
})

test('POSIX PowerShell 明确不可用', () => {
  const result = selectInterpreter('PowerShell', 'linux', { exists: () => true })
  assert.ok('error' in result)
  assert.ok(result.error.includes('PowerShell'), result.error)
})

test('只读命令表：固定只读操作获得豁免', () => {
  const positives = [
    'git status',
    'git status --porcelain',
    'git log --oneline -5',
    'git diff',
    'git diff --stat',
    'git show HEAD',
    'git rev-parse HEAD',
    'git branch',
    'git branch --list',
    'git remote -v',
    'ls',
    'ls -la',
    'ls -la src',
    'cat package.json',
    'head -20 file.txt',
    'tail -n 5 file.txt',
    'pwd',
    'echo hello',
    'which node',
    'node --version',
    'npm --version',
    'git --version'
  ]
  for (const command of positives) {
    assert.equal(isReadOnlyCommand(command), true, command)
  }
})

test('只读命令表：写操作与未知参数不豁免', () => {
  const negatives = [
    'git push',
    'git commit -m "x"',
    'git checkout .',
    'git branch -D feature',
    'git status --bogus',
    'rm -rf build',
    'npm test',
    'node -e "process.exit(1)"',
    'node script.js',
    'cat',
    'ls --bogus',
    'unknown-command'
  ]
  for (const command of negatives) {
    assert.equal(isReadOnlyCommand(command), false, command)
  }
})

test('只读命令表：复合语句与重定向不豁免', () => {
  const negatives = [
    'git status && rm -rf /',
    'git status; ls',
    'ls | grep src',
    'git status > out.txt',
    'cat a >> b',
    'echo $(git push)',
    'echo `git push`',
    'ls\nrm x'
  ]
  for (const command of negatives) {
    assert.equal(isReadOnlyCommand(command), false, command)
  }
})

test('只读命令表：argv 形式同样判定', () => {
  assert.equal(isReadOnlyCommand('', ['git', 'status', '--porcelain']), true)
  assert.equal(isReadOnlyCommand('', ['git', 'push']), false)
  assert.equal(isReadOnlyCommand('', ['rm', '-rf', 'x']), false)
})

test('阻塞等待族判定', () => {
  for (const command of ['sleep 5', 'ping example.com', 'timeout 5', 'wait', 'Start-Sleep -Seconds 5']) {
    assert.equal(isBlockingWaitCommand(command), true, command)
  }
  for (const command of ['echo sleep', 'node -e "setTimeout(()=>{},100)"', 'git status', '']) {
    assert.equal(isBlockingWaitCommand(command), false, command)
  }
})

test('交互式族判定', () => {
  const positives = ['vim file', 'vi', 'nano', 'emacs', 'less file', 'more', 'top', 'htop', 'ssh host', 'psql', 'mysql', 'python', 'python3', 'python script.py']
  for (const command of positives) {
    assert.equal(isInteractiveCommand(command), true, command)
  }
  const negatives = ['python -c "print(1)"', 'python3 -c "print(1)"', 'echo vim', 'git status', 'node -e "1"']
  for (const command of negatives) {
    assert.equal(isInteractiveCommand(command), false, command)
  }
})