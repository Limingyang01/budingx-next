import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commands, run } from '../src/cli.ts'

test('已有 greet 子命令仍然可用', () => {
  assert.ok(commands.some((item) => item.name === 'greet'))
})

test('echo 子命令按 --times 重复输出', () => {
  const written = []
  const original = process.stdout.write
  process.stdout.write = (chunk) => {
    written.push(String(chunk))
    return true
  }
  try {
    const code = run(['echo', 'hi', '--times', '3'])
    assert.equal(code, 0)
  } finally {
    process.stdout.write = original
  }
  assert.equal(written.join(''), 'hi\nhi\nhi\n')
})

test('echo 缺少位置参数时返回非零', () => {
  assert.notEqual(run(['echo']), 0)
})
