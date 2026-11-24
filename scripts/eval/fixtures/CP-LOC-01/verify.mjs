import { readFileSync, existsSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const problems = []

function listTsFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listTsFiles(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

// 独立模型：直接在源码里数调用点，定义处本身不算。
const expected = new Set()
for (const file of listTsFiles('src')) {
  const rel = file.split('\\').join('/')
  if (rel === 'src/config.ts') continue
  const text = readFileSync(file, 'utf8')
  if (/parseConfig\s*\(/.test(text)) expected.add(rel)
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
    const listed = Array.isArray(answer.callsites) ? answer.callsites : []
    for (const item of expected) {
      if (!listed.includes(item)) problems.push('缺少调用点：' + item)
    }
    for (const item of listed) {
      if (!expected.has(item)) problems.push('多出的调用点：' + item)
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error('FAIL: ' + problem)
  process.exit(1)
}
console.log('OK: ' + expected.size + ' 个调用点与源码一致')
