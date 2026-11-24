import { readFileSync, existsSync } from 'node:fs'

const problems = []

const source = existsSync('src/task.go') ? readFileSync('src/task.go', 'utf8') : ''
if (!/ctx\.Done\s*\(\s*\)/.test(source)) {
  problems.push('src/task.go 未检查 ctx.Done()')
}
if (!/ctx\.Err\s*\(\s*\)/.test(source)) {
  problems.push('src/task.go 未返回 ctx.Err()')
}
if (!/select/.test(source)) {
  problems.push('src/task.go 未使用 select 监听取消')
}
if (/not implemented/.test(source)) {
  problems.push('src/task.go 仍是未实现桩')
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
    if (answer.processed !== 3) problems.push('processed 应为 3，实际 ' + answer.processed)
    if (answer.err !== 'context canceled') problems.push('err 应为 context canceled，实际 ' + answer.err)
    if (answer.cancelled !== true) problems.push('cancelled 应为 true')
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error('FAIL: ' + problem)
  process.exit(1)
}
console.log('OK: 可取消任务接口契约通过')
