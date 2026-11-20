// SP004 T15 · 计划模式工具表面（设计 §6.2）：模型用空对象进入调研，
// 用 ExitPlanMode 读取会话计划文件并触发审批；模型不携带计划正文。
import type { Session } from '../core/session.js'
import { ERROR_CODES } from '../core/constants.js'
import type { ToolHandler } from '../core/tools.js'
import { dirname, isAbsolute, relative } from 'node:path'
import { ensurePrivateDirectory } from '../storage/private-file.js'
import { createWorkspaceTools } from '../workspace/tools.js'
import type { Workspace } from '../workspace/paths.js'

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
      items: {
        anyOf: [
          {
            type: 'object',
            properties: {
              tool: { type: 'string', enum: ['Bash'] },
              prompt: { type: 'string' }
            },
            required: ['tool', 'prompt'],
            additionalProperties: false
          },
          { type: 'string' }
        ]
      }
    }
  },
  additionalProperties: false
} as const

function failure(message: string): Error {
  const error = new Error(message)
  ;(error as Error & { code?: string }).code = ERROR_CODES.coreToolFailed
  return error
}

function fields(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw failure('计划模式工具参数必须是对象')
  }
  return input as Record<string, unknown>
}

function permissionIntents(input: unknown): string[] {
  const values = fields(input)
  if (Object.keys(values).some((key) => key !== 'allowedPrompts')) {
    throw failure('ExitPlanMode 仅接受 allowedPrompts，计划正文从会话计划文件读取')
  }
  if (values.allowedPrompts === undefined) return []
  if (!Array.isArray(values.allowedPrompts)) throw failure('allowedPrompts 必须是数组')
  return values.allowedPrompts.map((value) => {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (value && typeof value === 'object' && !Array.isArray(value) &&
        Object.keys(value).length === 2 && value.tool === 'Bash' &&
        typeof value.prompt === 'string' && value.prompt.trim()) {
      return `${value.tool} · ${value.prompt.trim()}`
    }
    throw failure('allowedPrompts 的每项必须是权限说明或包含 Bash 和 prompt 的对象')
  })
}

/** EnterPlanMode/ExitPlanMode：计划模式是权限档位切换，不产生工作区副作用。 */
export function createPlanModeTools(session: Session, draftPath?: string): ToolHandler[] {
  return [
    {
      name: 'EnterPlanMode',
      parameters: ENTER_PARAMETERS,
      summary: '进入计划模式：只调研并写计划，非只读操作需一次性批准',
      describe: () => '进入计划模式（调研阶段）',
      capability: () => 'read',
      target: () => ({ kind: 'none' }),
      execute: async (input) => {
        if (Object.keys(fields(input)).length !== 0) throw failure('EnterPlanMode 只接受空对象')
        const result = session.enterPlanMode()
        if (!result.ok) throw failure(result.reason ?? '无法进入计划模式')
        const instructions = '已进入计划模式。先调研现有代码和实施方案，必要时通过 AskUserQuestion 澄清需求。写完计划后调用 ExitPlanMode 请求批准。'
        return draftPath ? `${instructions}\n计划文件：${draftPath}\n可以使用 Write、Read 和 Edit 更新这个会话草稿。` : instructions
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
        const result = await session.exitPlanMode({
          turnId: context.turnId,
          callId: context.callId,
          permissionIntents: permissionIntents(input)
        })
        if (result.ok) {
          const path = draftPath ? `\n计划文件：${draftPath}` : ''
          const title = result.edited ? '用户编辑后批准的计划' : '批准的计划'
          return `计划已批准（${result.planId}），已恢复原权限档位，可以开始实施。${path}\n\n## ${title}\n${result.text}`
        }
        throw failure(result.message)
      }
    }
  ]
}

/** Route only the active session's exact draft through the normal file tools. */
export function routePlanDraftTools(
  tools: ToolHandler[],
  session: Session,
  draftPath: string,
  draftWorkspace: Workspace
): void {
  const draftTools = createWorkspaceTools(draftWorkspace).tools
  for (const draftTool of draftTools) {
    if (!['Read', 'Write', 'Edit'].includes(draftTool.name)) continue
    const index = tools.findIndex((tool) => tool.name === draftTool.name)
    if (index === -1) continue
    const workspaceTool = tools[index]
    const read = draftTool.name === 'Read'
    const allowed = () => read ? session.canReadPlanDraft : session.planMode.phase === 'research'
    const isDraft = (path?: string) =>
      path !== undefined && isAbsolute(path) && relative(draftPath, path) === ''
    tools[index] = {
      ...workspaceTool,
      target(input) {
        const target = workspaceTool.target?.(input)
        return isDraft(target?.path) ? { kind: 'plan-draft', path: draftPath } : target ?? { kind: 'none' }
      },
      async execute(input, context) {
        if (!isDraft(workspaceTool.target?.(input)?.path)) return workspaceTool.execute(input, context)
        if (!allowed()) throw failure('当前状态不允许操作会话计划草稿')
        if (!read) ensurePrivateDirectory(dirname(draftWorkspace.resolve(draftPath).real))
        return draftTool.execute(input, { ...context, changes: undefined })
      }
    }
  }
}
