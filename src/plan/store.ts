// SP004 T10 计划状态机与待办存储（设计 §6.1）；T22 增加可选文件持久化。
// Core 持有类型；这里提供可注入的实现：状态机本身纯逻辑，持久化只在提供 filePath 时发生。
import { randomUUID } from 'node:crypto'
import {
  PLAN_MAX_STEPS,
  PLAN_STEP_STATUSES,
  TODO_STATUSES,
  nextPlanStepId,
  planProgress,
  type Plan,
  type PlanStep,
  type PlanStore,
  type TodoItem,
  type TodoStore
} from '../core/plan.js'
import { loadPlanFile, savePlanFile } from './serialize.js'

/** 工作区快照：指纹只绑定这些可观测事实（设计 §6.3）。 */
export type PlanSnapshot = {
  /** 工作区根的真实路径（跨平台统一分隔符后比较）。 */
  root: string
  /** Git HEAD；非 Git 工作区或缺省时不参与绑定。 */
  head?: string
  /** 送审草稿的正文指纹，仅在独立草稿存在时绑定。 */
  draft?: string
  /** 目标文件前像：仓库相对路径 → 内容指纹。 */
  files: Record<string, string>
}

/** 计划证据：计划版本来自 Plan.updatedAt，不是外部快照。 */
export type PlanEvidence = {
  root: string
  head: string | null
  draft?: string
  version: number
  files: Record<string, string>
}

/** 生成稳定排序的证据对象（键顺序固定，便于指纹比较）。 */
export function planEvidenceOf(plan: Pick<Plan, 'updatedAt'>, snapshot: PlanSnapshot): PlanEvidence {
  const files: Record<string, string> = {}
  for (const path of Object.keys(snapshot.files).sort()) files[path] = snapshot.files[path]
  return {
    root: snapshot.root,
    head: snapshot.head ?? null,
    ...(snapshot.draft === undefined ? {} : { draft: snapshot.draft }),
    version: plan.updatedAt,
    files
  }
}

/** 批准时写入 Plan.fingerprint 的字符串（结构化证据的稳定 JSON）。 */
export function planFingerprintOf(plan: Pick<Plan, 'updatedAt'>, snapshot: PlanSnapshot): string {
  return JSON.stringify(planEvidenceOf(plan, snapshot))
}

export type PlanStoreOptions = {
  /** 批准时读取当前工作区快照；缺省为无工作区绑定（仅内存测试）。 */
  snapshot?: () => PlanSnapshot
  now?: () => number
  id?: () => string
  /** 提供时计划持久化为该 `.md` 文件：创建即落盘，重开同一路径可读回（TP-10）。 */
  filePath?: string
}

function emptyProgress(): ReturnType<typeof planProgress> {
  return { total: 0, completed: 0, inProgress: 0, blocked: 0, pending: 0 }
}

/** 计划状态机：create → update → requestApproval → approve/reject。 */
export function createPlanStore(options: PlanStoreOptions = {}): PlanStore {
  const now = options.now ?? (() => Date.now())
  const newId = options.id ?? (() => `plan-${randomUUID()}`)
  const snapshot = options.snapshot ?? (() => ({ root: '', files: {} }))
  let plan: Plan | undefined = options.filePath ? loadPlanFile(options.filePath) : undefined

  /** 有 filePath 时把当前计划写回磁盘；状态机不因持久化失败而静默丢弃计划。 */
  function persist(): void {
    if (options.filePath && plan) savePlanFile(options.filePath, plan)
  }

  function requirePlan(): Plan {
    if (!plan) throw new Error('当前没有计划，请先创建计划')
    return plan
  }

  function assertStepTitle(title: unknown): string {
    if (typeof title !== 'string' || title.trim().length === 0) {
      throw new Error('步骤标题不能为空')
    }
    return title.trim()
  }

  const store: PlanStore = {
    current: () => plan,

    create(goal, steps) {
      if (typeof goal !== 'string' || goal.trim().length === 0) {
        throw new Error('计划目标不能为空')
      }
      if (!Array.isArray(steps) || steps.length === 0) {
        throw new Error('计划至少需要一个步骤')
      }
      if (steps.length > PLAN_MAX_STEPS) {
        throw new Error(`计划步骤不能超过 ${PLAN_MAX_STEPS} 步，请拆分为多个计划`)
      }
      const list: PlanStep[] = []
      for (const step of steps) {
        list.push({ id: nextPlanStepId(list), title: assertStepTitle(step?.title), status: 'pending' })
      }
      const timestamp = now()
      plan = {
        id: newId(),
        goal: goal.trim(),
        steps: list,
        approval: 'none',
        createdAt: timestamp,
        updatedAt: timestamp
      }
      persist()
      return plan
    },

    update(stepId, patch) {
      const current = requirePlan()
      const index = current.steps.findIndex((step) => step.id === stepId)
      if (index === -1) throw new Error(`步骤不存在：${stepId}`)
      const step = current.steps[index]
      const next: PlanStep = { ...step }
      if (patch.title !== undefined) next.title = assertStepTitle(patch.title)
      if (patch.status !== undefined) {
        if (!(PLAN_STEP_STATUSES as readonly string[]).includes(patch.status)) {
          throw new Error(`非法步骤状态：${String(patch.status)}`)
        }
        next.status = patch.status
      }
      if (patch.blockedBy !== undefined) {
        const blockedBy = patch.blockedBy
        if (!Array.isArray(blockedBy)) throw new Error('blockedBy 必须是步骤 id 数组')
        const seen = new Set<string>()
        for (const dependency of blockedBy) {
          if (typeof dependency !== 'string' || dependency.length === 0) {
            throw new Error('blockedBy 包含非法步骤 id')
          }
          if (seen.has(dependency)) throw new Error(`blockedBy 不能重复引用：${dependency}`)
          seen.add(dependency)
          if (dependency === stepId) throw new Error('blockedBy 不能引用自身')
          if (!current.steps.some((candidate) => candidate.id === dependency)) {
            throw new Error(`blockedBy 引用的步骤不存在：${dependency}`)
          }
        }
        next.blockedBy = [...blockedBy]
      }
      if (patch.note !== undefined) {
        if (typeof patch.note !== 'string') throw new Error('note 必须是字符串')
        next.note = patch.note
      }
      current.steps[index] = next
      current.updatedAt = now()
      persist()
      return current
    },

    requestApproval(planText) {
      const current = requirePlan()
      if (current.approval !== 'none' && current.approval !== 'rejected') {
        throw new Error('计划当前不在可请求批准状态（已待批或已批准）')
      }
      if (typeof planText !== 'string' || planText.trim().length === 0) {
        throw new Error('请求批准的展示文本不能为空')
      }
      current.approval = 'pending'
      current.updatedAt = now()
      persist()
      return current
    },

    approve(approvedText) {
      const current = requirePlan()
      if (current.approval !== 'pending') {
        throw new Error('计划未处于待批状态，不能批准')
      }
      const timestamp = now()
      current.updatedAt = timestamp
      current.approval = 'approved'
      current.fingerprint = planFingerprintOf({ updatedAt: timestamp }, snapshot())
      if (approvedText !== undefined) {
        if (typeof approvedText !== 'string') throw new Error('approvedText 必须是字符串')
        current.approvedText = approvedText
      }
      persist()
      return current
    },

    reject(reason) {
      const current = requirePlan()
      if (current.approval !== 'pending') {
        throw new Error('计划未处于待批状态，不能拒绝')
      }
      current.approval = 'rejected'
      current.updatedAt = now()
      // Plan 类型没有独立拒绝字段（设计 §6.1）；反馈经 approvedText 回传展示。
      if (reason !== undefined) {
        if (typeof reason !== 'string') throw new Error('拒绝原因必须是字符串')
        current.approvedText = `拒绝原因：${reason}`
      }
      persist()
      return current
    },

    progress() {
      return plan ? planProgress(plan.steps) : emptyProgress()
    }
  }

  return store
}

/** 待办存储：整表替换语义，校验三字段三状态（设计 §6.1）。 */
export function createTodoStore(): TodoStore {
  let items: TodoItem[] = []

  return {
    list: () => items.map((item) => ({ ...item })),

    set(next) {
      if (!Array.isArray(next)) throw new Error('待办列表必须是数组')
      const validated: TodoItem[] = next.map((item) => {
        if (!item || typeof item.content !== 'string' || item.content.trim().length === 0) {
          throw new Error('待办内容 content 不能为空')
        }
        if (!(TODO_STATUSES as readonly string[]).includes(item.status)) {
          throw new Error(`非法待办状态：${String(item.status)}`)
        }
        if (typeof item.activeForm !== 'string' || item.activeForm.trim().length === 0) {
          throw new Error('待办 activeForm 不能为空')
        }
        const copy: TodoItem = {
          content: item.content.trim(),
          status: item.status,
          activeForm: item.activeForm.trim()
        }
        if (typeof item.id === 'string' && item.id.length > 0) copy.id = item.id
        return copy
      })
      items = validated
      return items.map((item) => ({ ...item }))
    },

    progress() {
      const completed = items.filter((item) => item.status === 'completed').length
      return { completed, total: items.length }
    }
  }
}
