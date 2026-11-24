import { readFileSync, existsSync } from 'node:fs'

const problems = []

const source = existsSync('src/cache.rs') ? readFileSync('src/cache.rs', 'utf8') : ''
if (!/expired/.test(source)) {
  problems.push('src/cache.rs 未判断条目是否过期')
}
if (!/return 0/.test(source)) {
  problems.push('src/cache.rs 未对过期条目返回 0')
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
    if (answer.liveTtl !== 30) problems.push('liveTtl 应为 30，实际 ' + answer.liveTtl)
    if (answer.expiredTtl !== 0) problems.push('expiredTtl 应为 0，实际 ' + answer.expiredTtl)
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error('FAIL: ' + problem)
  process.exit(1)
}
console.log('OK: TTL 实现与规格一致')
