// SP007 §4.5 / SP010 T4：评估报告（summary JSON + markdown）。
// 报告必须给出总体结果、分组结果与失败分类，并附未测能力清单；
// 盲测任务的失败细节脱敏，不回流到调优过程（SP001 §8）。
// SP010 起补充：按类别的任务等权完成率与 95% 区间、延迟分位数、费用估算与证据充分性。
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

/** 报告措辞红线：效果口径只报自有测量，不使用替代或等效类表述（SP001 O5=B）。 */
export const FORBIDDEN_REPORT_PHRASES = ['完整替代', '已对齐', '同等效果']

/** 报告输出根目录（相对仓库根）。SP010 起按迭代与 slug 参数化。 */
export function reportRoot(root, options = {}) {
  const sp = options.sp ?? 'SP007'
  const slug = options.slug ?? 'agent-quality-and-extensions'
  return join(root, 'artifacts', 'quality-runs', sp, slug)
}

/** 生成运行目录路径。 */
export function reportDir(root, runId, options = {}) {
  return join(reportRoot(root, options), runId)
}

/** 盲测任务脱敏：只保留状态与计数，不保留失败细节。 */
export function redactTaskForDisk(result) {
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

/** 百分位（最近秩法）。 */
export function percentile(values, ratio) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil(ratio * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

/**
 * Hoeffding 区间：任务等权分数的有界 95% 区间。
 * 半宽取 sqrt(log(2 / 0.05) / (2n))，端点裁到 0–1。
 * 同题重复只形成一个分数；全部通过也保留区间宽度。
 */
export function hoeffdingInterval(mean, taskCount, alpha = 0.05) {
  if (!taskCount) return { low: 0, high: 1, halfWidth: 1 }
  const halfWidth = Math.sqrt(Math.log(2 / alpha) / (2 * taskCount))
  return {
    low: Math.max(0, Math.min(1, mean - halfWidth)),
    high: Math.max(0, Math.min(1, mean + halfWidth)),
    halfWidth
  }
}

/** 按任务汇总：同一任务的多次重复只形成一个分数。 */
export function collectTaskScores(results) {
  const byTask = new Map()
  for (const result of results) {
    const entry = byTask.get(result.id) ?? {
      id: result.id,
      category: result.category,
      group: result.group,
      blind: result.blind === true,
      runs: 0,
      passed: 0,
      failed: 0,
      error: 0,
      unverified: 0,
      budgetFailures: 0
    }
    entry.runs += 1
    if (result.status === 'passed') entry.passed += 1
    else if (result.status === 'failed') entry.failed += 1
    else if (result.status === 'unverified') entry.unverified += 1
    else entry.error += 1
    if (result.failureClass === 'BUDGET' || result.failureClass === 'budget') entry.budgetFailures += 1
    byTask.set(result.id, entry)
  }
  const scores = []
  for (const entry of byTask.values()) {
    const decided = entry.passed + entry.failed
    scores.push({
      ...entry,
      // 未验证的运行按未通过计入分母，避免把缺证当作通过。
      score: entry.runs === 0 ? 0 : entry.passed / entry.runs
    })
  }
  scores.sort((a, b) => a.id.localeCompare(b.id))
  return scores
}

/** 计算任务等权完成率及其区间。 */
export function buildCompletion({ results, planned, repeats, threshold }) {
  const scores = collectTaskScores(results)
  const independentTasks = scores.length
  const mean = independentTasks
    ? scores.reduce((sum, entry) => sum + entry.score, 0) / independentTasks
    : 0
  const interval = hoeffdingInterval(mean, independentTasks)
  const missingRepeats = scores
    .filter((entry) => repeats > 0 && entry.runs < repeats)
    .map((entry) => entry.id)
  const plannedIds = Array.isArray(planned) ? planned : []
  const missingTasks = plannedIds.filter((id) => !scores.some((entry) => entry.id === id))
  const reasons = []
  if (missingTasks.length > 0) reasons.push('缺少计划内任务：' + missingTasks.join('、'))
  if (missingRepeats.length > 0) reasons.push('重复次数不足：' + missingRepeats.join('、'))
  if (independentTasks === 0) reasons.push('没有可用的独立任务结果')
  if (
    typeof threshold === 'number' &&
    interval.low < threshold &&
    threshold < interval.high
  ) {
    reasons.push('完成率区间跨越适用门槛 ' + threshold + '，证据不足')
  }
  return {
    independentTasks,
    weightedRate: mean,
    interval,
    threshold: typeof threshold === 'number' ? threshold : undefined,
    missingRepeats,
    missingTasks,
    evidenceSufficient: reasons.length === 0,
    reasons,
    taskScores: scores
  }
}

/**
 * 汇总一次评估运行。
 * 统计口径遵循 SP001 §9：独立任务数、重复运行、分组结果、波动区间。
 */
export function buildSummary({
  runId,
  mode,
  results,
  startedAt,
  finishedAt,
  repeats = 1,
  planned,
  threshold,
  sp,
  slug,
  untested,
  pricePerThousandTokens,
  candidate
}) {
  const totals = { total: results.length, passed: 0, failed: 0, error: 0, unverified: 0, blind: 0 }
  const groups = {}
  const categories = {}
  const failureClasses = {}
  const taskIds = new Set()
  let totalTokens = 0
  let budgetFailures = 0
  for (const result of results) {
    if (result.status === 'passed') totals.passed += 1
    else if (result.status === 'failed') totals.failed += 1
    else if (result.status === 'unverified') totals.unverified += 1
    else totals.error += 1
    if (result.blind) totals.blind += 1
    taskIds.add(result.id)
    totalTokens += result.tokens ?? 0
    const group = (groups[result.group] ??= { total: 0, passed: 0, failed: 0, error: 0, unverified: 0, tasks: [] })
    group.total += 1
    group[result.status] += 1
    group.tasks.push(result.id)
    const category = (categories[result.category] ??= {
      total: 0,
      passed: 0,
      failed: 0,
      error: 0,
      unverified: 0,
      independentTasks: 0
    })
    category.total += 1
    category[result.status] += 1
    if (result.status !== 'passed') {
      const key = result.failureClass ?? 'assertion'
      failureClasses[key] = (failureClasses[key] ?? 0) + 1
      if (key === 'BUDGET' || key === 'budget') budgetFailures += 1
    }
  }
  // 每个类别的独立任务数（同一任务多次重复只算一个）。
  const categoryTasks = new Map()
  for (const result of results) {
    if (!categoryTasks.has(result.category)) categoryTasks.set(result.category, new Set())
    categoryTasks.get(result.category).add(result.id)
  }
  for (const [name, category] of Object.entries(categories)) {
    category.independentTasks = categoryTasks.get(name)?.size ?? 0
  }

  const durations = results.map((result) => result.durationMs).filter((value) => Number.isFinite(value))
  const completion = buildCompletion({ results, planned, repeats, threshold })
  const cost =
    typeof pricePerThousandTokens === 'number'
      ? (totalTokens / 1000) * pricePerThousandTokens
      : undefined

  return {
    runId,
    mode,
    sp,
    slug,
    candidate,
    startedAt,
    finishedAt,
    repeats,
    totals: { ...totals, uniqueTasks: taskIds.size },
    groups,
    categories,
    failureClasses,
    budgetFailures,
    completion,
    latency: {
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      samples: durations.length
    },
    tokens: totalTokens,
    cost,
    untested: untested ?? UNTESTED_CAPABILITIES,
    tasks: results.map(redactTaskForDisk)
  }
}

/** 报告措辞自检：出现被禁表述即抛错，避免把禁用措辞写进交付物。 */
export function assertReportWording(markdown) {
  for (const phrase of FORBIDDEN_REPORT_PHRASES) {
    if (markdown.includes(phrase)) {
      throw new Error('报告出现禁用措辞：' + phrase)
    }
  }
  return markdown
}

function percent(value) {
  return (value * 100).toFixed(1) + '%'
}

/** markdown 报告。 */
export function renderMarkdown(summary) {
  const lines = []
  const title = summary.sp
    ? '# ' + summary.sp + ' ' + (summary.slug ?? '') + ' 中期结果报告'
    : '# SP007 Agent 质量评估报告'
  lines.push(title)
  lines.push('')
  if (summary.sp) {
    lines.push('> 本报告为**中期结果**，只反映本轮自有测量与题集覆盖度，不构成对其他实现的替代性结论。')
    lines.push('')
  }
  lines.push('- 运行 ID：' + summary.runId)
  lines.push('- 模式：' + summary.mode)
  if (summary.candidate) lines.push('- 候选：' + summary.candidate)
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
      '，未验证 ' +
      summary.totals.unverified +
      '（盲测 ' +
      summary.totals.blind +
      '）'
  )
  lines.push('')
  lines.push('## 任务等权完成率')
  lines.push('')
  const completion = summary.completion
  if (completion) {
    lines.push(
      '- 独立任务数：' +
        completion.independentTasks +
        '；任务等权完成率：' +
        percent(completion.weightedRate)
    )
    lines.push(
      '- 95% 区间（Hoeffding）：' +
        percent(completion.interval.low) +
        ' – ' +
        percent(completion.interval.high)
    )
    lines.push(
      '- 证据充分性：' +
        (completion.evidenceSufficient ? '充分' : '证据不足') +
        (completion.reasons.length ? '（' + completion.reasons.join('；') + '）' : '')
    )
    if (completion.threshold !== undefined) {
      lines.push('- 适用门槛：' + percent(completion.threshold))
    }
  }
  lines.push('')
  lines.push('## 分组结果')
  lines.push('')
  lines.push('| 分组 | 任务数 | 通过 | 失败 | 错误 | 未验证 |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const [group, value] of Object.entries(summary.groups)) {
    lines.push(
      '| ' +
        group +
        ' | ' +
        value.total +
        ' | ' +
        value.passed +
        ' | ' +
        value.failed +
        ' | ' +
        value.error +
        ' | ' +
        (value.unverified ?? 0) +
        ' |'
    )
  }
  lines.push('')
  lines.push('## 类别结果')
  lines.push('')
  lines.push('| 类别 | 独立任务 | 运行数 | 通过 | 失败 | 错误 | 未验证 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const [name, value] of Object.entries(summary.categories ?? {})) {
    lines.push(
      '| ' +
        name +
        ' | ' +
        value.independentTasks +
        ' | ' +
        value.total +
        ' | ' +
        value.passed +
        ' | ' +
        value.failed +
        ' | ' +
        value.error +
        ' | ' +
        (value.unverified ?? 0) +
        ' |'
    )
  }
  lines.push('')
  lines.push('## 延迟与用量')
  lines.push('')
  lines.push('- 延迟 p50：' + formatDuration(summary.latency?.p50 ?? 0))
  lines.push('- 延迟 p95：' + formatDuration(summary.latency?.p95 ?? 0))
  lines.push('- token 合计：' + formatTokens(summary.tokens ?? 0))
  lines.push(
    '- 费用估算：' +
      (typeof summary.cost === 'number' ? '$' + summary.cost.toFixed(4) + '（估算口径）' : '未配置计价口径')
  )
  lines.push('- 预算终止次数：' + (summary.budgetFailures ?? 0))
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
  return assertReportWording(lines.join('\n'))
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
