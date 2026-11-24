import { spawnSync } from 'node:child_process'

const problems = []

const test = spawnSync('python', ['-m', 'unittest', 'discover', '-s', 'tests', '-t', '.'], {
  encoding: 'utf8'
})
if (test.status !== 0) {
  problems.push('测试未通过：\n' + (test.stdout ?? '') + (test.stderr ?? ''))
}

if (problems.length > 0) {
  for (const problem of problems) console.error('FAIL: ' + problem)
  process.exit(1)
}
console.log('OK: 日志解析缺陷已修复')
