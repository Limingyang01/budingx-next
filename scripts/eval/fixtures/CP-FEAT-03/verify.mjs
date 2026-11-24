import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'

const problems = []

rmSync('out', { recursive: true, force: true })
const compile = spawnSync('javac', ['-encoding', 'UTF-8', '-d', 'out', 'src/main/java/com/example/Writer.java', 'src/main/java/com/example/SelfTest.java'], {
  encoding: 'utf8'
})
if (compile.status !== 0) {
  problems.push('编译失败：\n' + (compile.stdout ?? '') + (compile.stderr ?? ''))
} else {
  const run = spawnSync('java', ['-cp', 'out', 'com.example.SelfTest'], { encoding: 'utf8' })
  if (run.status !== 0) {
    problems.push('自检失败：\n' + (run.stdout ?? '') + (run.stderr ?? ''))
  }
}
rmSync('out', { recursive: true, force: true })

if (problems.length > 0) {
  for (const problem of problems) console.error('FAIL: ' + problem)
  process.exit(1)
}
console.log('OK: 边界写入接口通过自检')
