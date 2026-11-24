// SP010 T5：批次运行的身份清单与续跑校验。
// 每个 run 在首项前冻结身份：候选 Git SHA、评估器版本、题集版本与快照摘要、
// Provider 与模型标识及运行参数、预算档版本与上限、计划重复次数。
// 续跑只跳过身份一致的已完成条目；任一字段变化即拒绝续跑。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 参与身份比对的字段（顺序固定，便于人工核对）。 */
export const IDENTITY_FIELDS = [
  'candidateSha',
  'evaluatorVersion',
  'taskSetVersion',
  'snapshotDigest',
  'providerId',
  'modelId',
  'runParams',
  'budgetVersion',
  'budgetLimits',
  'plannedRepeats'
]

/** 构造身份清单。缺项用空串占位，但比对时按原值比较。 */
export function buildRunIdentity(input = {}) {
  const identity = {}
  for (const field of IDENTITY_FIELDS) {
    identity[field] = input[field] ?? ''
  }
  return identity
}

/** 身份的稳定摘要：字段顺序固定后再取 SHA-256。 */
export function identityDigest(identity) {
  const canonical = JSON.stringify(
    IDENTITY_FIELDS.map((field) => [field, identity?.[field] ?? ''])
  )
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * 比较已保存身份与当前身份。
 * 返回 { resumable, changed }：changed 列出发生变化的字段名。
 */
export function compareIdentity(saved, current) {
  if (!saved) return { resumable: false, changed: ['identity'] }
  const changed = []
  for (const field of IDENTITY_FIELDS) {
    const before = JSON.stringify(saved[field] ?? '')
    const after = JSON.stringify(current[field] ?? '')
    if (before !== after) changed.push(field)
  }
  return { resumable: changed.length === 0, changed }
}

/** 写出身份清单。 */
export function writeIdentity(dir, identity) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'identity.json')
  const payload = { ...identity, digest: identityDigest(identity) }
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  return path
}

/** 读取身份清单；不存在或损坏时返回 undefined。 */
export function readIdentity(dir) {
  const path = join(dir, 'identity.json')
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return undefined
    return parsed
  } catch {
    return undefined
  }
}

/** 单次运行的落盘结果文件：盲测条目只保留状态、分类与计数。 */
export function resultFileName(result) {
  const repeat = result.repeat ?? 1
  return result.id + '-' + repeat + '.json'
}

/**
 * 落盘一次运行结果。盲测条目的失败细节不写盘（SP001 §8）。
 */
export function writeRunResult(dir, result, redact) {
  mkdirSync(dir, { recursive: true })
  const payload = result.blind === true ? redact(result) : result
  const path = join(dir, resultFileName(result))
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  return path
}

/** 读取已落盘的运行结果，按任务 ID 汇总已完成条目。 */
export function readRunResults(dir) {
  const resultsDir = join(dir, 'results')
  if (!existsSync(resultsDir)) return []
  const out = []
  for (const name of readdirSync(resultsDir)) {
    if (!name.endsWith('.json')) continue
    try {
      out.push(JSON.parse(readFileSync(join(resultsDir, name), 'utf8')))
    } catch {
      // 损坏的结果文件按缺失处理，不参与续跑跳过。
    }
  }
  return out
}
