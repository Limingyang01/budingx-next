import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const problems = []

const test = spawnSync(process.execPath, ['--test', 'test/*.test.mjs'], { encoding: 'utf8' })
if (test.status !== 0) {
  problems.push('测试未通过：\n' + (test.stdout ?? '') + (test.stderr ?? ''))
}

if (!existsSync('notes.md')) {
  problems.push('缺少 notes.md')
} else {
  const lines = readFileSync('notes.md', 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length !== 4) problems.push('notes.md 应记录四步，实际 ' + lines.length + ' 行')
}

if (problems.length > 0) {
  for (const problem of problems) console.error('FAIL: ' + problem)
  process.exit(1)
}
console.log('OK: 四步改造完成且测试通过')
