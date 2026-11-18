// SP004 T15 · 计划模式工具表面（设计 §6.2）：模型用空对象进入调研，
// 用 ExitPlanMode 读取会话计划文件并触发审批；模型不携带计划正文。
import type { Session } from '../core/session.js'
import { ERROR_CODES } from '../core/constants.js'
import type { ToolHandler } from '../core/tools.js'

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
export function createPlanModeTools(session: Session): ToolHandler[] {
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
        return '已进入计划模式：先调研并写入会话计划文件，然后调用 ExitPlanMode 请求批准。'
      }
    },
    {
      name: 'ExitPlanMode',
      parameters: EXIT_PARAMETERS,
      summary: '退出计划模式并请求批准当前会话计划文件',
      describe: () => '读取会话计划文件并请求批准',
      capability: () => 'read',
      target: () => ({ kind: 'none' }),
      execute: async (input) => {
        const values = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
        if ('allowedPrompts' in values && values.allowedPrompts !== undefined &&
          !Array.isArray(values.allowedPrompts)) {
          throw failure('allowedPrompts 必须是字符串数组')
        }
        const result = await session.exitPlanMode()
        if (result.ok) {
          return `计划已批准（${result.planId}），已恢复原权限档位。`
        }
        throw failure(result.message)
      }
    }
  ]
}