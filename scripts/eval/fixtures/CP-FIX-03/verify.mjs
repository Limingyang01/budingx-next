import { readFileSync, existsSync } from 'node:fs'

const problems = []

const source = existsSync('src/memory.rs') ? readFileSync('src/memory.rs', 'utf8') : ''
if (/read_to_string\s*\(/.test(source)) {
  problems.push('src/memory.rs 仍然一次性读取整个文件')
}
if (!/BufReader/.test(source)) {
  problems.push('src/memory.rs 未使用流式读取')
}
if (!/8192/.test(source)) {
  problems.push('src/memory.rs 未使用 8192 字节的块大小')
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
    if (answer.strategy !== 'streaming') problems.push('strategy 应为 streaming，实际 ' + answer.strategy)
    if (answer.chunkBytes !== 8192) problems.push('chunkBytes 应为 8192，实际 ' + answer.chunkBytes)
    if (answer.readsWholeFile !== false) problems.push('readsWholeFile 应为 false')
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error('FAIL: ' + problem)
  process.exit(1)
}
console.log('OK: 已改为流式读取')
