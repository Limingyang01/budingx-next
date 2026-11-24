import { spawnSync } from 'node:child_process'

const problems = []

const test = spawnSync(process.execPath, ['--test', 'test/*.test.mjs'], { encoding: 'utf8' })
if (test.status !== 0) {
  problems.push('测试未通过：\n' + (test.stdout ?? '') + (test.stderr ?? ''))
}

if (problems.length > 0) {
  for (const problem of problems) console.error('FAIL: ' + problem)
  process.exit(1)
}
console.log('OK: echo 子命令契约通过')
