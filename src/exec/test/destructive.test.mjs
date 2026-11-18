// SP004 T20 · 破坏性命令警告层（设计 §4.6，CE-18）。
// 警告只提示不阻断；只读模式的底线拒绝由权限策略负责，不在本层。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectDestructiveCommand, destructiveWarningText } from '../../tui/dist/exec/destructive.js'

test('破坏性清单：git 数据丢失/远端改写/不可逆删除/安全绕过逐条命中', () => {
  const cases = [
    ['git reset --hard', 'reset'],
    ['git reset --hard HEAD~1', 'reset'],
    ['git checkout .', 'checkout'],
    ['git restore .', 'restore'],
    ['git clean -f', 'clean'],
    ['git clean -fd', 'clean'],
    ['git push --force', 'push'],
    ['git push --force-with-lease', 'push'],
    ['git push -f origin master', 'push'],
    ['git stash drop', 'stash'],
    ['git stash clear', 'stash'],
    ['git branch -D feature', 'branch'],
    ['git branch --delete --force feature', 'branch'],
    ['git commit --no-verify -m x', 'no-verify'],
    ['git push --no-verify', 'no-verify'],
    ['git merge --no-verify feature', 'no-verify']
  ]
  for (const [command, keyword] of cases) {
    const result = detectDestructiveCommand(command)
    assert.equal(result.destructive, true, command)
    assert.ok(result.reason && result.reason.length > 0, command)
    assert.ok(result.reason.includes(keyword), `${command} → ${result.reason}`)
  }
})

test('破坏性清单：文件系统族逐条命中', () => {
  const cases = [
    ['rm -rf build', 'rm'],
    ['rm -r build', 'rm'],
    ['rm -fr build', 'rm'],
    ['del /s build', 'del'],
    ['Remove-Item -Recurse -Force build', 'Remove-Item'],
    ['remove-item -recurse -force build', 'Remove-Item'],
    ['format D:', 'format'],
    ['dd if=image.iso of=/dev/sda', 'dd']
  ]
  for (const [command, keyword] of cases) {
    const result = detectDestructiveCommand(command)
    assert.equal(result.destructive, true, command)
    assert.ok(result.reason.includes(keyword), `${command} → ${result.reason}`)
  }
})

test('git clean -n / --dry-run 不命中；普通命令不命中', () => {
  for (const command of ['git clean -n', 'git clean --dry-run', 'git clean -fn', 'git status', 'git diff', 'ls -la', 'echo hello', 'npm test', 'git branch --list']) {
    const result = detectDestructiveCommand(command)
    assert.equal(result.destructive, false, command)
    assert.equal(result.reason, undefined, command)
  }
})

test('警告文案固定格式', () => {
  const result = detectDestructiveCommand('git reset --hard')
  assert.equal(destructiveWarningText(result.reason), `⚠ 该命令可能造成不可逆的数据丢失：${result.reason}`)
})