// SP004 T12 · AskUserQuestion 工具（design §6.4，AC TP-06/TP-07/TP-08、CT-05/CT-06）。
// 追问是纯交互：能力归为 read，不写工作区、不需要审批；回合挂起与回答注入由 Session 负责。
import { ERROR_CODES } from './constants.js'
import { validateQuestions } from './plan.js'
import type { Session } from './session.js'
import type { ToolHandler } from './tools.js'

const QUESTION_PARAMETERS = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      description: '1–4 道结构化问题；每题 2–4 个互斥选项，header 为短标签',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '完整问题文本，以问号结尾，全局唯一' },
          header: { type: 'string', description: '展示为 chip 的短标签' },
          options: {
            type: 'array',
            minItems: 2,
            maxItems: 4,
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: '选项显示文本，题内唯一' },
                description: { type: 'string', description: '选项含义说明' },
                preview: { type: 'string', description: '聚焦时展示的预览内容' }
              },
              required: ['label', 'description'],
              additionalProperties: false
            }
          },
          multiSelect: { type: 'boolean', description: '是否允许多选，默认 false' }
        },
        required: ['question', 'header', 'options'],
        additionalProperties: false
      }
    }
  },
  required: ['questions'],
  additionalProperties: false
} as const

export function createAskUserQuestionTool(session: Session): ToolHandler {
  return {
    name: 'AskUserQuestion',
    summary:
      'Ask the user one to four structured questions and wait for their answers before continuing',
    parameters: QUESTION_PARAMETERS as unknown as Record<string, unknown>,
    describe(input) {
      const labels = Array.isArray((input as { questions?: unknown } | null)?.questions)
        ? ((input as { questions: { header?: unknown }[] }).questions ?? [])
            .map((item) => (typeof item?.header === 'string' ? item.header : '?'))
            .join('、')
        : ''
      return labels ? `追问用户：${labels}` : '追问用户'
    },
    // 追问不产生副作用：任何权限档位都可以发起，不需要单次批准。
    capability: () => 'read',
    target: () => ({ kind: 'none' as const }),
    async execute(input, context) {
      const validated = validateQuestions(input)
      if (!validated.ok) {
        const error = new Error(validated.reason) as Error & { code?: string }
        error.code = ERROR_CODES.coreToolFailed
        throw error
      }
      return session.askQuestion(validated.questions, {
        ...(context.turnId ? { turnId: context.turnId } : {}),
        ...(context.callId ? { callId: context.callId } : {})
      })
    }
  }
}