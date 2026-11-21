// SP007 §4.5：评估报告（summary JSON + markdown）。
// 报告必须给出总体结果、分组结果与失败分类，并附未测能力清单；
// 盲测任务的失败细节脱敏，不回流到调优过程（SP001 §8）。
// 约定：ESM、2 空格缩进、无分号。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatDuration, formatTokens } from './util.mjs'

/** ER-05：本轮未覆盖的能力清单（团队/浏览器/CU/调度/多端不在 SP007 范围）。 */
export const UNTESTED_CAPABILITIES = [
  '团队协作与共享会话',
  '浏览器自动化（Browser 工具）',
  'CU 单元测试生成与执行',
  '定时调度与后台计划',
  '多端宿主（Desktop / VS Code / Mobile）'
]

/** 报告输出根目录（相对仓库根）。 */
export function reportRoot(root) {
  return join(root, 'artifacts', 'quality-runs', 'SP007', 'agent-quality-and-extensions')
}

/** 生成运行目录路径。 */
export function reportDir(root, runId) {
  return join(reportRoot(root), runId)
}

/** 盲测任务脱敏：只保留状态与计数，不保留失败细节。 */
function redactTask(result) {
  const base = {
    id: result.id,
    version: result.version,
    group: result.group,
    category: result.category,
    blind: result.blind === true,
    status: result.status,
    outcome: result.outcome,
    durationMs: result.durationMs,
    requestCount: result.requestCount,
    tokens: result.tokens,
    repeat: result.repeat ?? 1,
    failureClass: result.failureClass
  }
  if (result.blind === true) return { ...base, redacted: true }
  return {
    ...base,
    error: result.error,
    budgetExceeded: result.budgetExceeded,
    changed: result.changed,
    checks: result.checks,
    harnessError: result.harnessError
  }
}

/**
 * 汇总一次评估运行。
 * 统计口径遵循 SP001 §9：独立任务数、重复运行、分组结果、波动区间。
 */
export function buildSummary({ runId, mode, results, startedAt, finishedAt, repeats = 1 }) {
  const totals = { total: results.length, passed: 0, failed: 0, error: 0, blind: 0 }
  const groups = {}
  const failureClasses = {}
  const taskIds = new Set()
  for (const result of results) {
    if (result.status === 'passed') totals.passed += 1
    else if (result.status === 'failed') totals.failed += 1
    else totals.error += 1
    if (result.blind) totals.blind += 1
    taskIds.add(result.id)
    const group = (groups[result.group] ??= { total: 0, passed: 0, failed: 0, error: 0, tasks: [] })
    group.total += 1
    group[result.status] += 1
    group.tasks.push(result.id)
    if (result.status !== 'passed') {
      const key = result.failureClass ?? 'assertion'
      failureClasses[key] = (failureClasses[key] ?? 0) + 1
    }
  }
  const durations = results.map((result) => result.durationMs).sort((a, b) => a - b)
  return {
    runId,
    mode,
    startedAt,
    finishedAt,
    repeats,
    totals: { ...totals, uniqueTasks: taskIds.size },
    groups,
    failureClasses,
    untested: UNTESTED_CAPABILITIES,
    tasks: results.map(redactTask)
  }
}

/** markdown 报告。 */
export function renderMarkdown(summary) {
  const lines = []
  lines.push('# SP007 Agent 质量评估报告')
  lines.push('')
  lines.push('- 运行 ID：' + summary.runId)
  lines.push('- 模式：' + summary.mode)
  lines.push('- 开始：' + summary.startedAt)
  lines.push('- 结束：' + summary.finishedAt)
  lines.push('- 重复次数：' + summary.repeats)
  lines.push(
    '- 总体：独立任务 ' +
      summary.totals.uniqueTasks +
      ' 个，运行 ' +
      summary.totals.total +
      ' 次，通过 ' +
      summary.totals.passed +
      '，失败 ' +
      summary.totals.failed +
      '，错误 ' +
      summary.totals.error +
      '（盲测 ' +
      summary.totals.blind +
      '）'
  )
  lines.push('')
  lines.push('## 分组结果')
  lines.push('')
  lines.push('| 分组 | 任务数 | 通过 | 失败 | 错误 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const [group, value] of Object.entries(summary.groups)) {
    lines.push(
      '| ' + group + ' | ' + value.total + ' | ' + value.passed + ' | ' + value.failed + ' | ' + value.error + ' |'
    )
  }
  lines.push('')
  lines.push('## 失败分类')
  lines.push('')
  if (Object.keys(summary.failureClasses).length === 0) {
    lines.push('本轮无失败。')
  } else {
    lines.push('| 分类 | 次数 |')
    lines.push('| --- | --- |')
    for (const [key, count] of Object.entries(summary.failureClasses)) {
      lines.push('| ' + key + ' | ' + count + ' |')
    }
  }
  lines.push('')
  lines.push('## 未测能力清单（ER-05）')
  lines.push('')
  for (const item of summary.untested) lines.push('- ' + item)
  lines.push('')
  lines.push('## 任务明细')
  lines.push('')
  lines.push('| 任务 | 分组 | 盲测 | 状态 | 耗时 | 请求数 | token |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const task of summary.tasks) {
    lines.push(
      '| ' +
        task.id +
        ' | ' +
        task.group +
        ' | ' +
        (task.blind ? '是' : '否') +
        ' | ' +
        task.status +
        ' | ' +
        formatDuration(task.durationMs) +
        ' | ' +
        task.requestCount +
        ' | ' +
        formatTokens(task.tokens ?? 0) +
        ' |'
    )
  }
  lines.push('')
  return lines.join('\n')
}

/** 写出 summary.json 与 summary.md。 */
export function writeReport(summary, dir) {
  mkdirSync(dir, { recursive: true })
  const jsonPath = join(dir, 'summary.json')
  const mdPath = join(dir, 'summary.md')
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2) + '\n', 'utf8')
  writeFileSync(mdPath, renderMarkdown(summary), 'utf8')
  return { jsonPath, mdPath }
}
