#!/usr/bin/env node
// SP007 §4.5：离线评估运行器。
// 用法：node scripts/eval/runner.mjs [--repeats N] [--tasks id1,id2,...] [--run-id NAME]
// 评分只依据可自动断言的事实；失败必须落到 SP007 的失败分类里。
// 约定：ESM、2 空格缩进、无分号。
import { loadTasks, validateTasks } from './lib/tasks.mjs'
import { runTasks } from './lib/runner-core.mjs'
import { buildSummary, writeReport, reportDir } from './lib/report.mjs'
import { repoRoot } from './lib/util.mjs'

const ROOT = repoRoot()

function parseArgs(argv) {
  const args = argv.slice(2)
  const opts = { repeats: 1, tasks: null, runId: null, set: 'sp007' }
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--repeats' && args[i + 1]) {
      opts.repeats = Number(args[i + 1])
      i += 1
    } else if (args[i] === '--tasks' && args[i + 1]) {
      opts.tasks = args[i + 1].split(',').map((s) => s.trim())
      i += 1
    } else if (args[i] === '--run-id' && args[i + 1]) {
      opts.runId = args[i + 1]
      i += 1
    } else if (args[i] === '--set' && args[i + 1]) {
      opts.set = args[i + 1]
      i += 1
    }
  }
  return opts
}

async function main() {
  const opts = parseArgs(process.argv)
  if (opts.set === 'cp-v1') {
    // CP-SET-v1 的题目需要真实模型驱动，不存在离线场景脚本；
    // 离线可做的是题目校验与「未预先解出」自检。
    console.error('cp-v1 任务集需要真实模型：请使用 scripts/eval/live.mjs --set cp-v1。')
    console.error('离线自检：node scripts/eval/validate.mjs --set cp-v1')
    console.error('         node scripts/eval/tools/verify-fixtures.mjs --set cp-v1')
    process.exitCode = 1
    return
  }
  if (opts.set !== 'sp007') {
    console.error('未知任务集：' + opts.set)
    process.exitCode = 1
    return
  }
  const allTasks = loadTasks(ROOT)
  const { errors, summary: validationSummary } = validateTasks(allTasks)
  if (errors.length > 0) {
    console.error('任务清单校验失败：')
    for (const e of errors) console.error('  -', e)
    process.exitCode = 1
    return
  }
  console.log('任务清单校验通过：', JSON.stringify(validationSummary))

  let tasks = allTasks
  if (opts.tasks) {
    const set = new Set(opts.tasks)
    tasks = allTasks.filter((t) => set.has(t.id))
    if (tasks.length === 0) {
      console.error('未找到指定任务：', opts.tasks.join(', '))
      process.exitCode = 1
      return
    }
  }

  const runId = opts.runId ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const startedAt = new Date().toISOString()
  console.log('开始评估运行：', runId, '（', tasks.length, '个任务 ×', opts.repeats, '次重复）')

  const results = await runTasks(tasks, { root: ROOT, repeats: opts.repeats })
  const finishedAt = new Date().toISOString()

  const summary = buildSummary({
    runId,
    mode: 'offline',
    results,
    startedAt,
    finishedAt,
    repeats: opts.repeats
  })

  const dir = reportDir(ROOT, runId)
  const { jsonPath, mdPath } = writeReport(summary, dir)
  console.log('报告已写入：')
  console.log('  JSON:', jsonPath)
  console.log('  MD:  ', mdPath)
  console.log('总体：', summary.totals.passed, '/', summary.totals.total, '通过，',
    summary.totals.failed, '失败，', summary.totals.error, '错误')

  if (summary.totals.failed > 0 || summary.totals.error > 0) {
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
