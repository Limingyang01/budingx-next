#!/usr/bin/env node
// SP007 §4.5 / SP010 T4–T5：真实模型评估运行器（opt-in，不进 npm test）。
// 用法：
//   node scripts/eval/live.mjs --set cp-v1 --repeats 3 --run-id <ID>
//   node scripts/eval/live.mjs --set cp-v1 --repeats 3 --resume <ID>
// 需要 .env.e2e.local 配置 BUDINGX_API_KEY / BUDINGX_BASE_URL / BUDINGX_MODEL，
// 以及可选的 BUDINGX_E2E_MAX_REQUESTS / BUDINGX_E2E_BUDGET_USD 总闸。
// 约定：ESM、2 空格缩进、无分号。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { loadTasks, CHECKPOINT_BUDGET_PROFILES, CHECKPOINT_BUDGET_VERSION } from './lib/tasks.mjs'
import { runLiveTask } from './lib/runner-core.mjs'
import { runCanTask } from './lib/can-runner.mjs'
import { buildSummary, writeReport, reportDir, redactTaskForDisk } from './lib/report.mjs'
import {
  buildRunIdentity,
  compareIdentity,
  readIdentity,
  writeIdentity,
  writeRunResult
} from './lib/run-identity.mjs'
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
  const opts = { tasks: null, runId: null, set: null, repeats: null, resume: null, threshold: null }
  for (let i = 0; i < args.length; i += 1) {
    const next = args[i + 1]
    if (args[i] === '--tasks' && next) {
      opts.tasks = next.split(',').map((s) => s.trim())
      i += 1
    } else if (args[i] === '--run-id' && next) {
      opts.runId = next
      i += 1
    } else if (args[i] === '--set' && next) {
      opts.set = next
      i += 1
    } else if (args[i] === '--repeats' && next) {
      opts.repeats = Number(next)
      i += 1
    } else if (args[i] === '--resume' && next) {
      opts.resume = next
      i += 1
    } else if (args[i] === '--threshold' && next) {
      opts.threshold = Number(next)
      i += 1
    }
  }
  return opts
}

/** 读取任务集：cp-v1 用中期任务集，其余用既有 SP007 回归集。 */
function loadTaskSet(name) {
  if (!name || name === 'sp007') return loadTasks(ROOT)
  if (name !== 'cp-v1') throw new Error('未知任务集：' + name)
  return JSON.parse(readFileSync(join(ROOT, 'scripts', 'eval', 'tasks', 'set-cp-v1.json'), 'utf8'))
}

/** 候选源码 SHA。 */
function candidateSha() {
  const run = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
  return (run.stdout ?? '').trim() || 'unknown'
}

/** 题集与快照摘要：任一快照内容变化都会改变摘要。 */
function taskSetDigest(tasks) {
  const hash = createHash('sha256')
  for (const task of tasks) {
    hash.update(task.id + ':' + (task.snapshot ?? 0) + '\n')
    const manifest = join(ROOT, 'scripts', 'eval', 'fixtures', task.fixture ?? task.id, 'snapshot.json')
    if (existsSync(manifest)) hash.update(readFileSync(manifest, 'utf8'))
  }
  return hash.digest('hex')
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

  const opts = parseArgs(process.argv)
  const tasks = loadTaskSet(opts.set)
  const repeats = opts.repeats ?? (opts.set === 'cp-v1' ? 3 : 1)
  const sp = opts.set === 'cp-v1' ? 'SP010' : undefined
  const slug = opts.set === 'cp-v1' ? 'coding-parity-checkpoint' : undefined
  const runId = opts.runId ?? opts.resume ?? 'live-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = reportDir(ROOT, runId, { sp, slug })

  const maxRequests = Number(env.BUDINGX_E2E_MAX_REQUESTS ?? Infinity)
  const maxCost = Number(env.BUDINGX_E2E_BUDGET_USD ?? Infinity)

  const identity = buildRunIdentity({
    candidateSha: candidateSha(),
    evaluatorVersion: opts.set ?? 'sp007',
    taskSetVersion: opts.set ?? 'sp007',
    snapshotDigest: taskSetDigest(tasks),
    providerId: new URL(baseUrl).host,
    modelId: model,
    runParams: { repeats, threshold: opts.threshold ?? null },
    budgetVersion: opts.set === 'cp-v1' ? CHECKPOINT_BUDGET_VERSION : 'sp007',
    budgetLimits: opts.set === 'cp-v1' ? CHECKPOINT_BUDGET_PROFILES : {},
    plannedRepeats: repeats
  })

  // 续跑：先核对身份清单，任一字段变化即拒绝。
  const previous = readIdentity(dir)
  let resumedFrom = undefined
  if (opts.resume) {
    if (!previous) {
      console.error('拒绝续跑：缺少身份清单 ' + join(dir, 'identity.json'))
      process.exitCode = 1
      return
    }
    const comparison = compareIdentity(previous, identity)
    if (!comparison.resumable) {
      console.error('拒绝续跑：身份发生变化（' + comparison.changed.join('、') + '），请使用新的 run ID')
      process.exitCode = 1
      return
    }
    resumedFrom = opts.resume
  } else {
    writeIdentity(dir, identity)
  }

  // Dynamic import to avoid loading provider in offline tests
  const { createOpenAiProvider } = await import('../../src/tui/dist/provider/openai.js')
  const provider = createOpenAiProvider({ baseUrl, apiKey })

  let selected = tasks
  if (opts.tasks) {
    const set = new Set(opts.tasks)
    selected = tasks.filter((task) => set.has(task.id))
    if (selected.length === 0) {
      console.error('未找到指定的任务：', opts.tasks.join(', '))
      process.exitCode = 1
      return
    }
  }

  const startedAt = new Date().toISOString()
  console.log('开始真实模型评估：' + runId)
  console.log('模型：' + model + ' | 端点：' + baseUrl)
  console.log('任务数：' + selected.length + ' | 重复：' + repeats)
  console.log('总闸：请求 ≤ ' + maxRequests + '，费用 ≤ $' + maxCost)

  const results = []
  const skipped = new Set()
  let requestsUsed = 0
  let costUsed = 0
  let budgetStopped = false

  for (const task of selected) {
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      const key = task.id + '-' + repeat
      if (skipped.has(key)) {
        console.log('  ↺ ' + key + ' 已完成，跳过')
        continue
      }
      if (budgetStopped) {
        const unverified = {
          id: task.id,
          version: task.version,
          group: task.group,
          category: task.category,
          blind: task.blind === true,
          status: 'unverified',
          outcome: 'unknown',
          durationMs: 0,
          requestCount: 0,
          tokens: 0,
          repeat,
          failureClass: undefined,
          harnessError: '预算总闸触顶，本条未执行'
        }
        results.push(unverified)
        writeRunResult(join(dir, 'results'), unverified, redactTaskForDisk)
        continue
      }
      console.log('  ▶ ' + key + ' ...')
      const result =
        task.category === 'CAN'
          ? await runCanTask(task, {
              root: ROOT,
              config: { baseUrl, model, apiKey, timeoutMs: 120_000, source: 'env' },
              provider: undefined,
              repeat
            })
          : await runLiveTask(task, {
              root: ROOT,
              provider,
              repeat,
              snapshot: {
                modelId: model,
                model,
                baseUrlHost: new URL(baseUrl).host,
                capabilities: { tools: true, vision: true }
              }
            })
      result.repeat = repeat
      results.push(result)
      requestsUsed += result.requestCount ?? 0
      writeRunResult(join(dir, 'results'), result, redactTaskForDisk)
      console.log('    ' + result.status + ' (' + result.durationMs + 'ms, ' + result.requestCount + ' req)')
      if (requestsUsed >= maxRequests) {
        budgetStopped = true
        console.log('    ! 请求总闸触顶，剩余条目标 UNVERIFIED')
      }
    }
  }

  const finishedAt = new Date().toISOString()
  const planned = selected.map((task) => task.id)
  const summary = buildSummary({
    runId,
    mode: 'live',
    sp,
    slug,
    candidate: identity.candidateSha,
    results,
    startedAt,
    finishedAt,
    repeats,
    planned,
    threshold: opts.threshold ?? undefined,
    pricePerThousandTokens: undefined
  })
  summary.identity = identity
  summary.budget = { maxRequests, maxCost, requestsUsed, costUsed, stopped: budgetStopped }
  summary.resumedFrom = resumedFrom
  const { jsonPath, mdPath } = writeReport(summary, dir)
  console.log('\n报告已写入：')
  console.log('  JSON: ' + jsonPath)
  console.log('  MD:   ' + mdPath)
  console.log('总体：' + summary.totals.passed + '/' + summary.totals.total + ' 通过')
  console.log('任务等权完成率：' + (summary.completion.weightedRate * 100).toFixed(1) + '%')
  console.log('证据充分性：' + (summary.completion.evidenceSufficient ? '充分' : '证据不足'))

  if (summary.totals.failed > 0 || summary.totals.error > 0) {
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
