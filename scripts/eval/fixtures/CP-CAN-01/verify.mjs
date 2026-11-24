import { readFileSync, existsSync } from 'node:fs'

const problems = []

const source = existsSync('src/task.go') ? readFileSync('src/task.go', 'utf8') : ''
if (/not implemented/.test(source)) {
  problems.push('src/task.go 仍是未实现桩')
}
if (!/state\.Done/.test(source)) {
  problems.push('src/task.go 未使用 state.Done 记录进度')
}
if (!/ctx\.Done\s*\(\s*\)/.test(source)) {
  problems.push('src/task.go 未检查取消信号')
}

if (!existsSync('answer.json')) {
  problems.push('缺少 answer.json')
} else {
  let answer
  try {
    answer = JSON.parse(readFileSync('answer.json', 'utf8'))
  } catch (error) {
    problems.push('answer.json 不是合法 JSON：' + error.message)
  }
  if (answer) {
    if (answer.sideEffects !== 1) problems.push('sideEffects 应为 1，实际 ' + answer.sideEffects)
    if (answer.resumed !== true) problems.push('resumed 应为 true')
    if (answer.replayed !== false) problems.push('replayed 应为 false')
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error('FAIL: ' + problem)
  process.exit(1)
}
console.log('OK: 取消恢复语义契约通过')
