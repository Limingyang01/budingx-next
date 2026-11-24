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
console.log('OK: 依赖升级导致的测试失败已修复')
