import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const problems = []

const test = spawnSync(process.execPath, ['--test', 'test/*.test.mjs'], { encoding: 'utf8' })
if (test.status !== 0) {
  problems.push('测试未通过：\n' + (test.stdout ?? '') + (test.stderr ?? ''))
}

const source = readFileSync('src/order.ts', 'utf8')
if (/customer\.address\.zip/.test(source)) {
  problems.push('src/order.ts 仍在无保护地解引用 customer.address.zip')
}
if (!/subtotal/.test(source)) {
  problems.push('src/order.ts 丢失了 subtotal 计算')
}

if (problems.length > 0) {
  for (const problem of problems) console.error('FAIL: ' + problem)
  process.exit(1)
}
console.log('OK: 结算缺陷已修复且测试通过')
