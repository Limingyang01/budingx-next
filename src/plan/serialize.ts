// SP004 T22 · 计划持久化（design §6.1/§6.3，AC TP-04/TP-10）。
// 计划保存为会话隔离目录下的 `.md`：YAML frontmatter 承载结构化元信息，正文供用户阅读与编辑。
// 只写 `~/.budingx/plans/<sessionId>/<planId>.md`，不写用户项目目录。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  PLAN_APPROVAL_STATES,
  PLAN_STEP_STATUSES,
  isPlanTargetPaths,
  type Plan,
  type PlanStep
} from '../core/plan.js'
import { dataRoot } from '../storage/paths.js'

/** 会话隔离的计划文件绝对路径：~/.budingx/plans/<sessionId>/<planId>.md。 */
export function planFilePath(sessionId: string, planId: string, home: string = homedir()): string {
  return join(dataRoot(home), 'plans', sessionId, `${planId}.md`)
}

function scalar(value: string | number): string {
  return JSON.stringify(value)
}

function stepLines(step: PlanStep): string[] {
  const lines = [
    `  - id: ${scalar(step.id)}`,
    `    title: ${scalar(step.title)}`,
    `    status: ${scalar(step.status)}`
  ]
  if (step.blockedBy !== undefined) lines.push(`    blockedBy: ${JSON.stringify(step.blockedBy)}`)
  if (step.note !== undefined) lines.push(`    note: ${scalar(step.note)}`)
  return lines
}

/** 序列化为 Markdown 正文 + YAML frontmatter；字段顺序稳定，便于逐行比较与用户编辑。 */
export function serializePlan(plan: Plan): string {
  const lines = [
    '---',
    `id: ${scalar(plan.id)}`,
    `goal: ${scalar(plan.goal)}`,
    `approval: ${scalar(plan.approval)}`,
    `createdAt: ${plan.createdAt}`,
    `updatedAt: ${plan.updatedAt}`
  ]
  if (plan.fingerprint !== undefined) lines.push(`fingerprint: ${scalar(plan.fingerprint)}`)
  if (plan.draftText !== undefined) lines.push(`draftText: ${scalar(plan.draftText)}`)
  if (plan.targetPaths !== undefined) lines.push(`targetPaths: ${JSON.stringify(plan.targetPaths)}`)
  if (plan.approvedText !== undefined) lines.push(`approvedText: ${scalar(plan.approvedText)}`)
  lines.push('steps:')
  for (const step of plan.steps) lines.push(...stepLines(step))
  lines.push('---', '', `# ${plan.goal}`, '')
  plan.steps.forEach((step, index) => lines.push(`${index + 1}. ${step.title}`))
  lines.push('')
  return lines.join('\n')
}

function parseScalar(raw: string): string | number | unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function splitPair(line: string): { key: string; raw: string } | undefined {
  const index = line.indexOf(':')
  if (index === -1) return undefined
  const key = line.slice(0, index).trim()
  if (key.length === 0) return undefined
  return { key, raw: line.slice(index + 1).trim() }
}

/** 解析 serializePlan 的输出；结构或字段不合法时抛错，不静默丢弃计划。 */
export function parsePlan(text: string): Plan {
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0] !== '---') throw new Error('计划文件缺少 YAML frontmatter（必须以 --- 开头）')
  const closing = lines.indexOf('---', 1)
  if (closing === -1) throw new Error('计划文件缺少 YAML frontmatter 结束分隔线（---）')

  const meta: Record<string, unknown> = {}
  const steps: Record<string, unknown>[] = []
  let step: Record<string, unknown> | undefined

  for (const line of lines.slice(1, closing)) {
    if (line.trim().length === 0) continue
    if (line.startsWith('  - ')) {
      step = {}
      steps.push(step)
      const pair = splitPair(line.slice(4))
      if (pair) step[pair.key] = parseScalar(pair.raw)
      continue
    }
    if (line.startsWith('    ') && step) {
      const pair = splitPair(line.slice(4))
      if (pair) step[pair.key] = parseScalar(pair.raw)
      continue
    }
    const pair = splitPair(line)
    if (!pair) continue
    if (pair.key === 'steps' && pair.raw.length === 0) continue
    meta[pair.key] = parseScalar(pair.raw)
  }

  const id = meta.id
  if (typeof id !== 'string' || id.length === 0) throw new Error('计划文件缺少 id')
  const goal = meta.goal
  if (typeof goal !== 'string' || goal.trim().length === 0) throw new Error('计划文件缺少 goal（目标）')
  const approval = meta.approval
  if (typeof approval !== 'string' || !(PLAN_APPROVAL_STATES as readonly string[]).includes(approval)) {
    throw new Error(`计划文件 approval 不合法：${String(approval)}`)
  }
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('计划文件缺少 steps（步骤）')
  const createdAt = meta.createdAt
  const updatedAt = meta.updatedAt
  if (typeof createdAt !== 'number' || typeof updatedAt !== 'number') {
    throw new Error('计划文件缺少数值型 createdAt/updatedAt')
  }

  const planSteps: PlanStep[] = steps.map((raw, index) => {
    const stepId = raw.id
    if (typeof stepId !== 'string' || stepId.length === 0) {
      throw new Error(`计划文件第 ${index + 1} 步缺少 id`)
    }
    const title = raw.title
    if (typeof title !== 'string' || title.trim().length === 0) {
      throw new Error(`计划文件第 ${index + 1} 步缺少 title`)
    }
    const status = raw.status
    if (typeof status !== 'string' || !(PLAN_STEP_STATUSES as readonly string[]).includes(status)) {
      throw new Error(`计划文件步骤 ${stepId} 的 status 不合法：${String(status)}`)
    }
    const parsed: PlanStep = { id: stepId, title, status: status as PlanStep['status'] }
    if (raw.blockedBy !== undefined) {
      if (!Array.isArray(raw.blockedBy)) throw new Error(`计划文件步骤 ${stepId} 的 blockedBy 必须是数组`)
      parsed.blockedBy = raw.blockedBy.map((entry) => String(entry))
    }
    if (raw.note !== undefined) {
      if (typeof raw.note !== 'string') throw new Error(`计划文件步骤 ${stepId} 的 note 必须是字符串`)
      parsed.note = raw.note
    }
    return parsed
  })

  const plan: Plan = {
    id,
    goal,
    steps: planSteps,
    approval: approval as Plan['approval'],
    createdAt,
    updatedAt
  }
  if (typeof meta.fingerprint === 'string') plan.fingerprint = meta.fingerprint
  if (typeof meta.draftText === 'string') plan.draftText = meta.draftText
  if (meta.targetPaths !== undefined) {
    if (!isPlanTargetPaths(meta.targetPaths)) throw new Error('计划文件 targetPaths 不合法')
    plan.targetPaths = meta.targetPaths
  }
  if (typeof meta.approvedText === 'string') plan.approvedText = meta.approvedText
  return plan
}

/** 写入计划文件（自动创建目录）。 */
export function savePlanFile(path: string, plan: Plan): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, serializePlan(plan), 'utf8')
}

/** 读取计划文件；文件不存在返回 undefined（会话恢复时视为无计划），其余错误照常抛出。 */
export function loadPlanFile(path: string): Plan | undefined {
  try {
    return parsePlan(readFileSync(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
