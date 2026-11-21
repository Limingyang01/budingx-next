#!/usr/bin/env node
// SP007 §4.5：真实模型评估运行器（opt-in，不进 npm test）。
// 用法：node scripts/eval/live.mjs [--tasks id1,id2,...] [--run-id NAME]
// 需要 .env.e2e.local 配置 BUDINGX_API_KEY / BUDINGX_BASE_URL / BUDINGX_MODEL。
// 约定：ESM、2 空格缩进、无分号。
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadTasks } from './lib/tasks.mjs'
import { runLiveTask } from './lib/runner-core.mjs'
import { buildSummary, writeReport, reportDir } from './lib/report.mjs'
import { repoRoot } from './lib/util.mjs'

const ROOT = repoRoot()

function parseEnv(filePath) {
  const env = {}
  if (!existsSync(filePath)) return env
  const lines = readFileSync(filePath, 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function parseArgs(argv) {
  const args = argv.slice(2)
  const opts = { tasks: null, runId: null }
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--tasks' && args[i + 1]) {
      opts.tasks = args[i + 1].split(',').map((s) => s.trim())
      i += 1
    } else if (args[i] === '--run-id' && args[i + 1]) {
      opts.runId = args[i + 1]
      i += 1
    }
  }
  return opts
}

async function main() {
  const envPath = join(ROOT, '.env.e2e.local')
  const env = parseEnv(envPath)
  const apiKey = env.BUDINGX_API_KEY
  const baseUrl = env.BUDINGX_BASE_URL ?? 'https://api.openai.com/v1'
  const model = env.BUDINGX_MODEL ?? 'gpt-4o-mini'

  if (!apiKey) {
    console.error('缺少 BUDINGX_API_KEY，请在 .env.e2e.local 中配置。')
    console.error('live.mjs 是 opt-in 的真实模型评估，不会在 npm test 中自动运行。')
    process.exitCode = 1
    return
  }

  // Dynamic import to avoid loading provider in offline tests
  const { createOpenAiProvider } = await import('../src/tui/dist/provider/openai.js')
  const provider = createOpenAiProvider({ baseUrl, apiKey })

  const allTasks = loadTasks(ROOT)
  const liveTasks = allTasks.filter((t) => t.live === true)
  if (liveTasks.length === 0) {
    console.error('没有标记 live:true 的任务。')
    process.exitCode = 1
    return
  }

  const opts = parseArgs(process.argv)
  let tasks = liveTasks
  if (opts.tasks) {
    const set = new Set(opts.tasks)
    tasks = liveTasks.filter((t) => set.has(t.id))
    if (tasks.length === 0) {
      console.error('未找到指定的 live 任务：', opts.tasks.join(', '))
      process.exitCode = 1
      return
    }
  }

  const runId = opts.runId ?? 'live-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const startedAt = new Date().toISOString()
  console.log('开始真实模型评估：', runId)
  console.log('模型：', model, '| 端点：', baseUrl)
  console.log('任务数：', tasks.length)

  const results = []
  for (const task of tasks) {
    console.log('  ▶', task.id, '...')
    const result = await runLiveTask(task, {
      root: ROOT,
      provider,
      snapshot: { modelId: model, model, baseUrlHost: new URL(baseUrl).host, capabilities: { tools: true, vision: true } }
    })
    results.push(result)
    console.log('    ', result.status, '(' + result.durationMs + 'ms, ' + result.requestCount + ' req)')
  }

  const finishedAt = new Date().toISOString()
  const summary = buildSummary({ runId, mode: 'live', results, startedAt, finishedAt })
  const dir = reportDir(ROOT, runId)
  const { jsonPath, mdPath } = writeReport(summary, dir)
  console.log('\n报告已写入：')
  console.log('  JSON:', jsonPath)
  console.log('  MD:  ', mdPath)
  console.log('总体：', summary.totals.passed, '/', summary.totals.total, '通过')

  if (summary.totals.failed > 0 || summary.totals.error > 0) {
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
