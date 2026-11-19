// SP004 T10 执行前漂移校验（设计 §6.3，AC TP-05）。
// 已批准计划在任何副作用之前重查工作区；漂移给出结构化原因，调用方据此把计划打回待审。
import type { Plan } from '../core/plan.js'
import { planEvidenceOf, type PlanEvidence, type PlanSnapshot } from './store.js'

/** 单条差异：item 是稳定键（root/head/version/files:<path>），用于回显给用户与测试断言。 */
export type PlanDrift = {
  item: string
  expected: string
  actual: string
}

export type PlanValidation = {
  ok: boolean
  drift: PlanDrift[]
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(空)'
  return String(value)
}

function isEvidence(value: unknown): value is PlanEvidence {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.root === 'string' &&
    (record.head === null || typeof record.head === 'string') &&
    typeof record.version === 'number' &&
    !!record.files &&
    typeof record.files === 'object'
  )
}

/**
 * 校验计划是否可执行。
 * 未批准、指纹缺失或与当前工作区不一致时返回 ok=false，并逐项列出差异。
 */
export function validateBeforeExecute(plan: Plan | undefined, snapshot: PlanSnapshot): PlanValidation {
  const drift: PlanDrift[] = []
  if (!plan) {
    return { ok: false, drift: [{ item: 'approval', expected: 'approved', actual: 'missing plan' }] }
  }
  if (plan.approval !== 'approved') {
    drift.push({ item: 'approval', expected: 'approved', actual: plan.approval })
    return { ok: false, drift }
  }
  if (!plan.fingerprint) {
    drift.push({ item: 'fingerprint', expected: '批准时指纹', actual: '缺失' })
    return { ok: false, drift }
  }

  let expected: PlanEvidence
  try {
    const parsed: unknown = JSON.parse(plan.fingerprint)
    if (!isEvidence(parsed)) throw new Error('形状不符')
    expected = parsed
  } catch {
    return { ok: false, drift: [{ item: 'fingerprint', expected: '结构化证据', actual: '无法解析' }] }
  }

  const actual = planEvidenceOf(plan, snapshot)
  if (expected.root !== actual.root) {
    drift.push({ item: 'root', expected: show(expected.root), actual: show(actual.root) })
  }
  if ((expected.head ?? null) !== (actual.head ?? null)) {
    drift.push({ item: 'head', expected: show(expected.head), actual: show(actual.head) })
  }
  if (expected.version !== actual.version) {
    drift.push({ item: 'version', expected: show(expected.version), actual: show(actual.version) })
  }
  const paths = new Set([...Object.keys(expected.files), ...Object.keys(actual.files)])
  for (const path of [...paths].sort()) {
    const before = Object.hasOwn(expected.files, path) ? expected.files[path] : undefined
    const now = Object.hasOwn(actual.files, path) ? actual.files[path] : undefined
    if (before === now) continue
    drift.push({
      item: `files:${path}`,
      expected: before === undefined ? '(不存在)' : before,
      actual: now === undefined ? '(不存在)' : now
    })
  }
  return { ok: drift.length === 0, drift }
}
