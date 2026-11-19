// SP004 T21 · 结构化只读命令表测试（design §4.5；AC CE-09）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isBlockingWaitCommand,
  isInteractiveCommand,
  isReadOnlyCommand
} from '../../tui/dist/exec/readonly-commands.js'

test('T21-10 常见 Git 只读命令豁免', () => {
  assert.equal(isReadOnlyCommand('git diff'), true)
  assert.equal(isReadOnlyCommand('git status'), true)
  assert.equal(isReadOnlyCommand('git log --oneline -5'), true)
  assert.equal(isReadOnlyCommand('git diff --stat'), true)
  assert.equal(isReadOnlyCommand('git show HEAD'), true)
  assert.equal(isReadOnlyCommand('git rev-parse HEAD'), true)
})

test('T21-11 未知参数不豁免', () => {
  assert.equal(isReadOnlyCommand('git diff --unknown-flag'), false)
  assert.equal(isReadOnlyCommand('git status --bogus'), false)
  assert.equal(isReadOnlyCommand('ls --bogus'), false)
})

test('T21-12 Git 写命令与包管理写命令不豁免', () => {
  assert.equal(isReadOnlyCommand('git push'), false)
  assert.equal(isReadOnlyCommand('git commit -m x'), false)
  assert.equal(isReadOnlyCommand('git checkout -- .'), false)
  assert.equal(isReadOnlyCommand('git branch -D feature'), false)
  assert.equal(isReadOnlyCommand('npm install'), false)
  assert.equal(isReadOnlyCommand('npm test'), false)
})

test('T21-13 复合命令与不透明命令不豁免', () => {
  assert.equal(isReadOnlyCommand('git status; rm -rf /'), false)
  assert.equal(isReadOnlyCommand('git status && rm -rf /'), false)
  assert.equal(isReadOnlyCommand('git status > out.txt'), false)
  assert.equal(isReadOnlyCommand('git status $(whoami)'), false)
  assert.equal(isReadOnlyCommand('node -e "process.exit(0)"'), false)
})

test('T21-14 阻塞等待族与交互式族识别', () => {
  assert.equal(isBlockingWaitCommand('sleep 5'), true)
  assert.equal(isBlockingWaitCommand('ping 127.0.0.1'), true)
  assert.equal(isBlockingWaitCommand('echo sleep'), false)
  assert.equal(isInteractiveCommand('vim a.txt'), true)
  assert.equal(isInteractiveCommand('python'), true)
  assert.equal(isInteractiveCommand('python -c "print(1)"'), false)
})

test('Python unittest 批处理命令不需要 TTY，也不获得只读豁免', () => {
  for (const command of [
    'python3 -m unittest discover',
    'python -B -W ignore -m unittest "tests/测试 文件.py"',
    'python3 -m unittest --help'
  ]) {
    assert.equal(isInteractiveCommand(command), false, command)
    assert.equal(isReadOnlyCommand(command), false, command)
  }
  for (const command of [
    'python3',
    'python3 -m',
    'python3 -m pydoc -b',
    'python3 -i -m unittest discover',
    'python3 -Bi -m unittest discover',
    'python3 -i -c "print(1)"',
    'python3 script.py -m unittest'
  ]) {
    assert.equal(isInteractiveCommand(command), true, command)
  }
})
