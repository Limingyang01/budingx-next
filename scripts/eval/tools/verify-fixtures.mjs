#!/usr/bin/env node
// SP010 T1：核对 CP-SET-v1 每条基本编码任务的「未预先解出」性质。
// 每条任务自带 verify.mjs； pristine 快照必须让 verify 失败，否则说明题目在起点就已满足。
// 只检查失败方向，不保存任何参考答案，避免把盲测题目的已知答案写进仓库。
// 用法：node scripts/eval/tools/verify-fixtures.mjs [--set cp-v1]
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repoRoot } from '../lib/util.mjs'

const TOOLCHAIN_ERRORS = [
  'is not recognized as an internal or external command',
  'command not found',
  'No module named',
  'unable to locate package',
  'Error: spawnSync'
]

function main() {
  const args = process.argv.slice(2)
  const setIndex = args.indexOf('--set')
  const setName = setIndex >= 0 ? args[setIndex + 1] : 'cp-v1'
  if (setName !== 'cp-v1') {
    console.error('Unsupported task set: ' + setName)
    process.exitCode = 1
    return
  }
  const root = repoRoot()
  const tasks = JSON.parse(readFileSync(join(root, 'scripts', 'eval', 'tasks', 'set-cp-v1.json'), 'utf8'))
  const problems = []
  let checked = 0
  for (const task of tasks) {
    if (task.category === 'PROT') continue
    const commands = task.verify?.commands ?? []
    if (commands.length === 0) {
      problems.push(task.id + ' 没有声明 verify 命令')
      continue
    }
    const directory = mkdtempSync(join(tmpdir(), 'cp-fixture-check-'))
    try {
      cpSync(join(root, 'scripts', 'eval', 'fixtures', task.fixture ?? task.id), directory, {
        recursive: true
      })
      const [command, ...args] = commands[0]
      const run = spawnSync(command, args, { cwd: directory, encoding: 'utf8' })
      checked += 1
      const output = (run.stdout ?? '') + (run.stderr ?? '')
      if (run.status === 0) {
        problems.push(task.id + ' 在 pristine 快照上已经通过验证，题目被预先解出')
        continue
      }
      if (TOOLCHAIN_ERRORS.some((marker) => output.includes(marker))) {
        problems.push(task.id + ' 的验证因工具链缺失而失败，不算有效的未解出证据')
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error('FAIL: ' + problem)
    console.error('不合格任务数：' + problems.length)
    process.exitCode = 1
    return
  }
  console.log('CP-SET-v1: ' + checked + ' 条基本编码任务在 pristine 快照上均未预先解出')
}

main()
