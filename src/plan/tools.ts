// SP004 T15 · 计划模式工具表面（设计 §6.2）：模型用空对象进入调研，
// 用 ExitPlanMode 读取会话计划文件并触发审批；模型不携带计划正文。
import type { Session } from '../core/session.js'
import { ERROR_CODES } from '../core/constants.js'
import type { ToolHandler } from '../core/tools.js'
import type { Plan, TodoItem } from '../core/plan.js'
import { createTodoStore } from './store.js'

const ENTER_PARAMETERS = {
  type: 'object',
  properties: {},
  additionalProperties: false
} as const

const EXIT_PARAMETERS = {
  type: 'object',
  properties: {
    allowedPrompts: {
      type: 'array',
      description: '权限意图说明，仅用于展示和审查，不直接创建权限规则。',
      items: { type: 'string' }
    }
  },
  additionalProperties: false
} as const

function failure(message: string): Error {
  const error = new Error(message)
  ;(error as Error & { code?: string }).code = ERROR_CODES.coreToolFailed
  return error
}

/** EnterPlanMode/ExitPlanMode：计划模式是权限档位切换，不产生工作区副作用。 */
export function createPlanModeTools(
  session: Session,
  writePlanText?: (text: string, goal: string, steps: string[]) => Plan
): ToolHandler[] {
  const todos = createTodoStore()
  session.on((event) => {
    if (event.type === 'conversation_cleared') todos.set([])
  })
  return [
    {
      name: 'EnterPlanMode',
      parameters: ENTER_PARAMETERS,
      summary: '进入计划模式：只调研并写计划，非只读操作需一次性批准',
      describe: () => '进入计划模式（调研阶段）',
      capability: () => 'read',
      target: () => ({ kind: 'none' }),
      execute: async () => {
        const result = session.enterPlanMode()
        if (!result.ok) throw failure(result.reason ?? '无法进入计划模式')
        return '已进入计划模式：先调研，用 WritePlan 写入计划，再调用 ExitPlanMode 请求批准。'
      }
    },
    {
      name: 'ExitPlanMode',
      parameters: EXIT_PARAMETERS,
      summary: '退出计划模式并请求批准当前会话计划文件',
      describe: () => '读取会话计划文件并请求批准',
      capability: () => 'read',
      target: () => ({ kind: 'none' }),
      execute: async (input, context) => {
        const values = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
        if ('allowedPrompts' in values && values.allowedPrompts !== undefined &&
          (!Array.isArray(values.allowedPrompts) || values.allowedPrompts.some((entry) => typeof entry !== 'string'))) {
          throw failure('allowedPrompts 必须是字符串数组')
        }
        const result = await session.exitPlanMode(context)
        if (result.ok) {
          return `计划已批准（${result.planId}），已恢复原权限档位。`
        }
        throw failure(result.message)
      }
    },
    ...(writePlanText === undefined ? [] : [<ToolHandler>{
      name: 'WritePlan',
      summary: 'Update the current session plan draft during plan research',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', minLength: 1, maxLength: 32000 },
          goal: { type: 'string', minLength: 1 },
          steps: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: 50 }
        },
        required: ['text', 'goal', 'steps'],
        additionalProperties: false
      },
      describe: () => '更新当前会话的计划草稿',
      capability: () => 'read',
      async execute(input, context) {
        if (session.planMode.phase !== 'research') throw failure('仅可在计划调研阶段更新草稿')
        const { text, goal, steps } = (input ?? {}) as { text?: unknown; goal?: unknown; steps?: unknown }
        if (typeof text !== 'string' || !text.trim() || text.length > 32000) {
          throw failure('计划正文须为非空文本，且最多 32000 字符')
        }
        if (typeof goal !== 'string' || !goal.trim() || !Array.isArray(steps) ||
          steps.length < 1 || steps.length > 50 || !steps.every((step) => typeof step === 'string' && step.trim())) {
          throw failure('计划需要非空目标及 1–50 个步骤')
        }
        const plan = writePlanText(text.trim(), goal, steps)
        context.emit?.({ type: 'plan_updated', plan })
        return '会话计划已更新，可调用 ExitPlanMode 请求批准。'
      }
    }]),
    {
      name: 'TodoWrite',
      summary: 'Replace the current session todo list; this does not change the plan',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            maxItems: 50,
            items: {
              type: 'object',
              properties: {
                content: { type: 'string' },
                status: { enum: ['pending', 'in_progress', 'completed'] },
                activeForm: { type: 'string' }
              },
              required: ['content', 'status', 'activeForm'],
              additionalProperties: false
            }
          }
        },
        required: ['todos'],
        additionalProperties: false
      },
      describe: () => '更新会话待办',
      capability: () => 'read',
      async execute(input, context) {
        const entries = (input as { todos?: unknown } | null)?.todos
        if (!Array.isArray(entries) || entries.length > 50 || entries.some((item) =>
          !item || typeof item !== 'object' || Object.keys(item).some((key) =>
            key !== 'content' && key !== 'status' && key !== 'activeForm'))) {
          throw failure('待办须为最多 50 项的数组，每项仅含 content、status 和 activeForm')
        }
        const items = todos.set(entries as TodoItem[])
        context.emit?.({ type: 'todos_updated', items, updatedAt: Date.now() })
        return JSON.stringify(todos.progress())
      }
    }
  ]
}
