import { readFileSync, existsSync } from 'node:fs'

const problems = []

// 独立模型：统一的规范化规则。
function normalize(input) {
  return input
    .split('\\')
    .join('/')
    .split('/')
    .filter((part) => part.length > 0)
    .join('/')
}

const samples = ['a\\b\\c', 'a//b///c', 'a/b/', '\\a\\b\\', 'a']
const expected = samples.map(normalize)

const source = existsSync('src/PathHelper.cs') ? readFileSync('src/PathHelper.cs', 'utf8') : ''
if (/DirectorySeparatorChar/.test(source) && !/Replace\s*\(/.test(source)) {
  problems.push('src/PathHelper.cs 仍依赖平台分隔符，未做统一替换')
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
    const results = Array.isArray(answer.results) ? answer.results : []
    for (let index = 0; index < expected.length; index += 1) {
      if (results[index] !== expected[index]) {
        problems.push('第 ' + (index + 1) + ' 个结果应为 ' + expected[index] + '，实际 ' + results[index])
      }
    }
    if (results.length !== expected.length) {
      problems.push('结果数量应为 ' + expected.length + '，实际 ' + results.length)
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error('FAIL: ' + problem)
  process.exit(1)
}
console.log('OK: 路径规范化结果一致')
