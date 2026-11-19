// SP004 计划/待办/追问 core 端口（设计 §6.1 / §6.4）。
// Core 只持有契约与纯逻辑；持久化与状态机实现由 src/plan 注入。
import type { PermissionMode } from './permissions.js'

export const PLAN_STEP_STATUSES = ['pending', 'in_progress', 'completed', 'blocked'] as const

export type PlanStepStatus = (typeof PLAN_STEP_STATUSES)[number]

export type PlanStep = {
  /** 稳定序号 step-1…；blockedBy 引用同计划内步骤 id。 */
  id: string
  title: string
  status: PlanStepStatus
  /** 被哪些步骤阻塞（TP-02）。 */
  blockedBy?: string[]
  note?: string
}

export const PLAN_APPROVAL_STATES = ['none', 'pending', 'approved', 'rejected'] as const

export type PlanApproval = (typeof PLAN_APPROVAL_STATES)[number]

export type Plan = {
  id: string
  goal: string
  steps: PlanStep[]
  /** 计划是否已批准（建议≠批准，TP-04）。 */
  approval: PlanApproval
  /** 批准时的计划指纹，用于执行前校验（TP-05）。 */
  fingerprint?: string
  /** Draft Markdown written by the session's planning tool. */
  draftText?: string
  /** 批准时可携带用户编辑后的计划正文（对齐 F-13 的 planWasEdited）。 */
  approvedText?: string
  createdAt: number
  updatedAt: number
}

/** 单计划步骤上限（设计 §6.1，超出拒绝并要求拆分）。 */
export const PLAN_MAX_STEPS = 50

export interface PlanStore {
  current(): Plan | undefined
  create(goal: string, steps: { title: string }[], draftText?: string): Plan
  update(stepId: string, patch: Partial<PlanStep>): Plan
  /** 请求批准：进入 pending。 */
  requestApproval(planText: string): Plan
  approve(approvedText?: string): Plan
  reject(reason?: string): Plan
  /** 进度报告（TP-09）。 */
  progress(): { total: number; completed: number; inProgress: number; blocked: number; pending: number }
}

/** 指纹漂移项：item 为 root/head/version/fingerprint/approval 或 files:<path>（TP-05）。 */
export type PlanDriftItem = { item: string; expected: string; actual: string }

/** 计划模式可观察的工作区基线；由宿主按真实文件与 Git HEAD 提供（设计 §6.2）。 */
export type PlanModeSnapshot = {
  root: string
  head?: string
  files: Record<string, string>
}

export const PLAN_MODE_PHASES = ['research', 'pending'] as const

/** 调研期（research）允许底层已准许只读；待批期（pending）只读之外一律拒绝。 */
export type PlanModePhase = (typeof PLAN_MODE_PHASES)[number]

export type PlanModeState = {
  active: boolean
  phase?: PlanModePhase
  originalMode?: PermissionMode
}

/**
 * 宿主注入的计划模式集成（设计 §6.2/§6.3）：core 负责单一状态转换与审批接线，
 * 计划持久化、计划文件读取与基线采集由宿主实现。
 */
export type PlanModeHost = {
  store: PlanStore
  /** 读取当前会话计划文件正文；缺失或为空返回 undefined。 */
  readPlanText: () => Promise<string | undefined>
  snapshot: () => PlanModeSnapshot
  diff: (baseline: PlanModeSnapshot, current: PlanModeSnapshot) => PlanDriftItem[]
  validate: (plan: Plan) => { ok: boolean; drift: PlanDriftItem[] }
}

export type PlanModeExitResult =
  | { ok: true; message: string; planId: string; version: number; edited: boolean }
  | { ok: false; message: string; drift?: PlanDriftItem[]; cancelled?: boolean }

export const TODO_STATUSES = ['pending', 'in_progress', 'completed'] as const

export type TodoStatus = (typeof TODO_STATUSES)[number]

/** 待办项：三字段三状态；可选 id 便于跨轮引用，不引入 blockedBy（设计 §6.1）。 */
export type TodoItem = {
  id?: string
  /** 任务描述（参考 F-14 的 content）。 */
  content: string
  status: TodoStatus
  /** 进行中的动词短语，用于卡片展示（参考 F-14 的 activeForm）。 */
  activeForm: string
}

export interface TodoStore {
  list(): TodoItem[]
  set(items: TodoItem[]): TodoItem[]
  /** 进度：已完成 / 总数。 */
  progress(): { completed: number; total: number }
}

/** 追问选项（设计 §6.4，多题结构；Other 由宿主自动提供）。 */
export type QuestionOption = {
  /** 显示文本，1–5 词（参考 F-15 的 label）。 */
  label: string
  /** 选项含义说明（必填）。 */
  description: string
  /** 聚焦时渲染的预览内容（可选）。 */
  preview?: string
}

export type Question = {
  /** 完整问题文本，以问号结尾。 */
  question: string
  /** 短标签，作为 chip 展示（必填）。 */
  header: string
  /** 2–4 个互斥选项。 */
  options: QuestionOption[]
  /** 是否允许多选（默认 false）。 */
  multiSelect: boolean
}

export type PendingQuestion = {
  questionId: string
  callId: string
  questions: Question[]
  /** 允许用户自由文本作答（Other 选项自动存在）。 */
  allowFreeText: boolean
  createdAt: number
}

/** 答案按「题目文本 → 答案文本」关联；多选以逗号分隔（参考 F-15）。 */
export type QuestionAnswers = Record<string, string>

/** 用户对所选项的补充备注（参考 F-15 的 annotations）。 */
export type QuestionAnnotations = Record<string, { preview?: string; notes?: string }>

/** 按步骤状态计数（TP-09 进度报告的纯逻辑）。 */
export function planProgress(steps: readonly PlanStep[]): {
  total: number
  completed: number
  inProgress: number
  blocked: number
  pending: number
} {
  const progress = { total: steps.length, completed: 0, inProgress: 0, blocked: 0, pending: 0 }
  for (const step of steps) {
    if (step.status === 'completed') progress.completed += 1
    else if (step.status === 'in_progress') progress.inProgress += 1
    else if (step.status === 'blocked') progress.blocked += 1
    else progress.pending += 1
  }
  return progress
}

/** 生成下一个稳定步骤 id（不复用已有编号）。 */
export function nextPlanStepId(steps: readonly PlanStep[]): string {
  let max = 0
  for (const step of steps) {
    const match = /^step-(\d+)$/.exec(step.id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `step-${max + 1}`
}

export type QuestionValidation =
  | { ok: true; questions: Question[] }
  | { ok: false; reason: string }

/** 校验 AskUserQuestion 输入（设计 §6.4）：1–4 题、题目唯一、选项 2–4 且 label 题内唯一。 */
export function validateQuestions(input: unknown): QuestionValidation {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, reason: '追问输入必须是包含 questions 数组的对象' }
  }
  const raw = (input as Record<string, unknown>).questions
  if (!Array.isArray(raw)) {
    return { ok: false, reason: '追问输入必须包含 questions 数组' }
  }
  if (raw.length < 1 || raw.length > 4) {
    return { ok: false, reason: '题数必须在 1–4 之间' }
  }
  const seenQuestions = new Set<string>()
  const questions: Question[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      return { ok: false, reason: '每道题目必须是对象' }
    }
    const record = item as Record<string, unknown>
    const question = record.question
    if (typeof question !== 'string' || question.trim() === '') {
      return { ok: false, reason: '题目文本 question 必填' }
    }
    if (!/[?？]$/.test(question.trim())) {
      return { ok: false, reason: '题目文本必须以问号结尾' }
    }
    if (seenQuestions.has(question)) {
      return { ok: false, reason: '题目文本必须全局唯一' }
    }
    seenQuestions.add(question)
    const header = record.header
    if (typeof header !== 'string' || header.trim() === '') {
      return { ok: false, reason: '每题 header 必填' }
    }
    const rawOptions = record.options
    if (!Array.isArray(rawOptions) || rawOptions.length < 2 || rawOptions.length > 4) {
      return { ok: false, reason: '每题选项数必须在 2–4 之间' }
    }
    const seenLabels = new Set<string>()
    const options: QuestionOption[] = []
    for (const rawOption of rawOptions) {
      if (typeof rawOption !== 'object' || rawOption === null) {
        return { ok: false, reason: '每个选项必须是对象' }
      }
      const option = rawOption as Record<string, unknown>
      const label = option.label
      if (typeof label !== 'string' || label.trim() === '') {
        return { ok: false, reason: '选项 label 必填' }
      }
      if (seenLabels.has(label)) {
        return { ok: false, reason: '选项 label 必须题内唯一' }
      }
      seenLabels.add(label)
      const description = option.description
      if (typeof description !== 'string' || description.trim() === '') {
        return { ok: false, reason: '选项 description 必填' }
      }
      const preview = option.preview
      if (preview !== undefined && typeof preview !== 'string') {
        return { ok: false, reason: '选项 preview 必须是字符串' }
      }
      options.push({ label, description, ...(preview === undefined ? {} : { preview }) })
    }
    const multiSelect = record.multiSelect ?? false
    if (typeof multiSelect !== 'boolean') {
      return { ok: false, reason: 'multiSelect 必须是布尔值' }
    }
    questions.push({ question, header, options, multiSelect })
  }
  return { ok: true, questions }
}
