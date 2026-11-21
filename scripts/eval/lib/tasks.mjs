// SP007 §4.5：任务清单加载与校验。
// 任务 schema 取 SP001 §2 的 11 字段超集，并补充评估运行所需的执行信息。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from './util.mjs'

/** SP001 任务 schema 的必备字段。 */
export const REQUIRED_FIELDS = [
  'id',
  'version',
  'group',
  'category',
  'language',
  'repo_size',
  'snapshot',
  'instruction',
  'assertions',
  'scope',
  'deps',
  'budget',
  'failure_class',
  'blind',
  'checks'
]

/** SP001 §2 断言方向代号。 */
export const ASSERTION_CODES = ['T', 'D', 'X', 'A', 'E']

/** SP007 失败分类（ER-01）。 */
export const FAILURE_CLASSES = [
  'provider_error',
  'tool_error',
  'permission',
  'budget',
  'assertion',
  'timeout',
  'cancelled',
  // SP001 §6 failure classes (used by coding_regression subset)
  'LOC_ERR',
  'MOD_ERR',
  'AUTH_ERR',
  'LOOP',
  'BUDGET',
  'HALLUC'
]

/** 预算档（SP001 §7 的 B/A/P，落到可执行的请求数与 token 上限）。 */
export const BUDGET_PROFILES = {
  B: { maxRequests: 8, maxTokens: 20000, timeoutMs: 60000 },
  A: { maxRequests: 12, maxTokens: 40000, timeoutMs: 120000 },
  P: { maxRequests: 5, maxTokens: 10000, timeoutMs: 30000 }
}

/** 必须覆盖的能力分组（ER-02 覆盖度自检）。 */
export const REQUIRED_GROUPS = [
  'provider_recovery',
  'tool_error',
  'image_downgrade',
  'subagent_permission',
  'subagent_cancel',
  'subagent_conflict',
  'mcp_failure',
  'diagnostics',
  'tool_search'
]

/** 盲测任务下限（ER-02）。 */
export const MIN_BLANK_TASKS = 3

/** 新增评估任务下限（ER-02）。 */
export const MIN_SP007_TASKS = 12

/** tasks.json 路径。 */
export function tasksPath(root = repoRoot()) {
  return join(root, 'scripts', 'eval', 'tasks.json')
}

/** 读取并解析 tasks.json。 */
export function loadTasks(root = repoRoot()) {
  const raw = readFileSync(tasksPath(root), 'utf8')
  const parsed = JSON.parse(raw)
  return parsed
}

/**
 * 校验任务清单，返回错误列表与统计摘要。
 * 校验失败不抛异常：调用方决定是终止还是标记 UNVERIFIED。
 */
export function validateTasks(tasks) {
  const errors = []
  if (!Array.isArray(tasks)) {
    return { errors: ['tasks.json 顶层必须是数组'], summary: emptySummary() }
  }
  const seen = new Set()
  for (const task of tasks) {
    const label = task && task.id ? task.id : '<无 id>'
    if (!task || typeof task !== 'object') {
      errors.push('任务项不是对象：' + label)
      continue
    }
    for (const field of REQUIRED_FIELDS) {
      if (task[field] === undefined || task[field] === null) {
        errors.push(label + ' 缺少字段 ' + field)
      }
    }
    if (seen.has(task.id)) errors.push(label + ' 任务 id 重复')
    seen.add(task.id)
    if (task.assertions && typeof task.assertions === 'string') {
      for (const code of task.assertions.split('+')) {
        if (!ASSERTION_CODES.includes(code.trim())) {
          errors.push(label + ' 断言代号非法：' + code)
        }
      }
    }
    if (task.failure_class && !FAILURE_CLASSES.includes(task.failure_class)) {
      errors.push(label + ' 失败分类非法：' + task.failure_class)
    }
    if (task.budget && typeof task.budget === 'string' && !BUDGET_PROFILES[task.budget]) {
      errors.push(label + ' 预算档非法：' + task.budget)
    }
    if (!Array.isArray(task.checks) || task.checks.length === 0) {
      errors.push(label + ' 至少需要一条 checks')
    }
    if (task.scope && !Array.isArray(task.scope.allow)) {
      errors.push(label + ' scope.allow 必须是数组')
    }
    if (typeof task.blind !== 'boolean') {
      errors.push(label + ' blind 必须是布尔值')
    }
  }
  const groups = {}
  let blind = 0
  let sp007 = 0
  for (const task of tasks) {
    if (!task || typeof task !== 'object') continue
    groups[task.group] = (groups[task.group] ?? 0) + 1
    if (task.blind) blind += 1
    if (String(task.id).startsWith('SP007-EVAL-')) sp007 += 1
  }
  for (const group of REQUIRED_GROUPS) {
    if (!groups[group]) errors.push('缺少能力分组覆盖：' + group)
  }
  if (blind < MIN_BLANK_TASKS) {
    errors.push('盲测任务不足 ' + MIN_BLANK_TASKS + ' 条（当前 ' + blind + '）')
  }
  if (sp007 < MIN_SP007_TASKS) {
    errors.push('SP007 新增任务不足 ' + MIN_SP007_TASKS + ' 条（当前 ' + sp007 + '）')
  }
  return { errors, summary: { total: tasks.length, blind, sp007, groups } }
}

function emptySummary() {
  return { total: 0, blind: 0, sp007: 0, groups: {} }
}
