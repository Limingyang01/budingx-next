import { readFileSync, existsSync } from 'node:fs'

const problems = []

// 独立模型：按 config.rs 的优先级复算（环境变量 > 本地覆盖 > 基础配置）。
const hasLocal = existsSync('config.local.toml')
const effective = hasLocal ? 'config.local.toml' : 'config.toml'
const overridden = ['config.toml', 'APP_PROFILE'].filter((item) => item !== effective)

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
    if (answer.effective !== effective) {
      problems.push('生效来源应为 ' + effective + '，实际 ' + answer.effective)
    }
    const listed = Array.isArray(answer.overridden) ? answer.overridden : []
    for (const item of overridden) {
      if (!listed.includes(item)) problems.push('缺少被覆盖来源：' + item)
    }
    for (const item of listed) {
      if (!overridden.includes(item)) problems.push('多出的被覆盖来源：' + item)
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error('FAIL: ' + problem)
  process.exit(1)
}
console.log('OK: 生效来源与被覆盖来源一致')
