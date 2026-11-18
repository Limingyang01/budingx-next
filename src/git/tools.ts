// SP004 T25 · worktree 工具表面（设计 §7.3）：`EnterWorktree {name?}` 与
// `ExitWorktree {action, discard_changes?}`。模型参数只表达意图，删除授权由
// 宿主审批通道单次给出（`ToolContext.approved`），模型自报参数无授权效力。
import { ERROR_CODES } from '../core/constants.js'
import type { ToolContext, ToolHandler } from '../core/tools.js'
import {
  exitWorktree,
  enterWorktree,
  type WorktreeSession
} from './worktree.js'

export type WorktreeToolOptions = {
  /** 会话原始工作目录；进入前的仓库根。 */
  cwd: string
  /** worktree 根目录；缺省 ~/.budingx/worktrees（§10 OPEN-01）。 */
  root?: string
  /** 测试注入的数据根 home。 */
  home?: string
}

export type WorktreeToolset = {
  tools: ToolHandler[]
  /** 当前会话的 worktree 状态；未进入时为 undefined。 */
  session(): WorktreeSession | undefined
}

const ENTER_PARAMETERS = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: '隔离工作树名称，小写字母/数字/连字符/下划线，≤41 字符；缺省为 session。'
    }
  },
  additionalProperties: false
} as const

const EXIT_PARAMETERS = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['keep', 'remove'],
      description: 'keep 保留 worktree 与分支（默认）；remove 删除两者。'
    },
    discard_changes: {
      type: 'boolean',
      description: 'action=remove 且存在未提交文件或未合并提交时，必须显式置为 true。'
    }
  },
  additionalProperties: false
} as const

function failure(message: string): Error {
  const error = new Error(message)
  ;(error as Error & { code?: string }).code = ERROR_CODES.coreToolFailed
  return error
}

function readObject(input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {}
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw failure('参数必须是对象')
  }
  return input as Record<string, unknown>
}

function readEnter(input: unknown): { name: string } {
  const values = readObject(input)
  for (const key of Object.keys(values)) {
    if (key !== 'name') {
      throw failure(`未知参数：${key}；仅支持 name（目录与环境由宿主决定）`)
    }
  }
  const name = values.name
  if (name === undefined) return { name: 'session' }
  if (typeof name !== 'string' || name.trim() === '') {
    throw failure('name 必须是非空字符串')
  }
  return { name: name.trim() }
}

function readExit(input: unknown): { action: 'keep' | 'remove'; discardChanges: boolean } {
  const values = readObject(input)
  for (const key of Object.keys(values)) {
    if (key !== 'action' && key !== 'discard_changes') {
      throw failure(`未知参数：${key}；仅支持 action 与 discard_changes`)
    }
  }
  const action = values.action ?? 'keep'
  if (action !== 'keep' && action !== 'remove') {
    throw failure('action 只能是 keep 或 remove')
  }
  const discard = values.discard_changes
  if (discard !== undefined && typeof discard !== 'boolean') {
    throw failure('discard_changes 必须是布尔值')
  }
  return { action, discardChanges: discard === true }
}

/**
 * EnterWorktree/ExitWorktree 工具。worktree 是会话级资源：进入后由工具集
 * 记录已验证的目录/分支/基准，退出时按记录执行并清空。
 */
export function createWorktreeTools(options: WorktreeToolOptions): WorktreeToolset {
  let current: WorktreeSession | undefined

  const enter: ToolHandler = {
    name: 'EnterWorktree',
    parameters: ENTER_PARAMETERS,
    summary: '进入隔离工作树（独立目录与专用分支，不改主工作区）',
    describe: (input) => `进入隔离工作树 name=${readEnter(input).name}`,
    capability: () => 'execute',
    target: () => ({ kind: 'none' }),
    prepareApproval: (input) => {
      const target = readEnter(input)
      return {
        preview: [
          `操作：创建隔离工作树`,
          `名称：${target.name}`,
          `仓库：${options.cwd}`,
          `目录：${options.root ?? '~/.budingx/worktrees'}/<repo-slug>/${target.name}`,
          '分支：<当前分支>-budingx/<flattened-slug>',
          '主工作区的暂存/未暂存/未跟踪改动不会被移动或丢弃。'
        ],
        execute: async (context) => enter.execute(input, context)
      }
    },
    execute: async (input) => {
      if (current !== undefined) {
        throw failure(`已在隔离工作树中：${current.path}（分支 ${current.branch}）`)
      }
      const target = readEnter(input)
      const entered = await enterWorktree({
        cwd: options.cwd,
        name: target.name,
        ...(options.root !== undefined ? { root: options.root } : {}),
        ...(options.home !== undefined ? { home: options.home } : {})
      })
      current = {
        path: entered.path,
        branch: entered.branch,
        baseBranch: entered.baseBranch,
        originalCwd: options.cwd
      }
      return [
        '已进入隔离工作树：',
        `- 目录：${entered.path}`,
        `- 分支：${entered.branch}`,
        `- 基准分支：${entered.baseBranch}`,
        `- 原工作目录：${options.cwd}`,
        '退出时默认保留（keep）；删除需要宿主单次授权。'
      ].join('\n')
    }
  }

  const exit: ToolHandler = {
    name: 'ExitWorktree',
    parameters: EXIT_PARAMETERS,
    summary: '退出隔离工作树：默认保留，remove 删除需宿主单次授权',
    describe: (input) => {
      const target = readExit(input)
      return `退出隔离工作树 action=${target.action}`
    },
    capability: (input) => (readExit(input).action === 'remove' ? 'write' : 'read'),
    target: () => ({ kind: 'none' }),
    // 删除一律要求宿主单次授权，即使当前是「完全权限」档位（设计 §7.3）。
    mandatoryApproval: (input) => readExit(input).action === 'remove',
    prepareApproval: (input) => {
      const target = readExit(input)
      const worktree = current
      return {
        preview: [
          `操作：删除隔离工作树`,
          `目录：${worktree?.path ?? '(未进入)'}`,
          `分支：${worktree?.branch ?? '(未进入)'}`,
          `丢弃未提交改动与未合并提交：${target.discardChanges ? '是' : '否'}`,
          '删除会移除该 worktree 目录与专用分支；主工作区文件不受影响。'
        ],
        execute: async (context) => exit.execute(input, context)
      }
    },
    execute: async (input, context: ToolContext) => {
      const target = readExit(input)
      const worktree = current
      if (worktree === undefined) {
        throw failure('当前没有进入隔离工作树，无需退出')
      }
      if (target.action === 'remove' && context.approved !== true) {
        throw failure(
          '删除 worktree 需要宿主单次授权：本次调用未获得审批（未经授权不会删除任何文件）'
        )
      }
      const result = await exitWorktree({
        ...worktree,
        action: target.action,
        ...(target.action === 'remove'
          ? {
              discard_changes: target.discardChanges,
              authorization: {
                id: context.callId ?? 'host-authorization',
                worktree: worktree.path,
                branch: worktree.branch,
                discardChanges: target.discardChanges
              }
            }
          : {})
      })
      current = undefined
      if (result.action === 'keep') {
        return [
          '已退出隔离工作树（保留）：',
          `- 目录：${result.path}`,
          `- 工作目录：${result.cwd}`
        ].join('\n')
      }
      return [
        '已退出并删除隔离工作树：',
        `- 目录：${result.path}`,
        `- 工作目录：${result.cwd}`,
        `- 丢弃未提交文件：${result.discardedFiles ?? 0} 个`,
        `- 丢弃未合并提交：${result.discardedCommits ?? 0} 个`
      ].join('\n')
    }
  }

  return { tools: [enter, exit], session: () => current }
}