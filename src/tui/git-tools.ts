import { randomUUID } from 'node:crypto'
import type { ToolHandler } from '../core/tools.js'
import {
  commitFilesFromCheckpoints,
  commitWithAuthorization,
  createCommitAuthorization,
  enterWorktree,
  exitWorktree,
  prepareWorktreeRemoval,
  readGitStatus,
  type WorktreeSession
} from '../git/index.js'
import type { CheckpointStore } from '../workspace/checkpoint.js'

type GitToolHost = {
  cwd(): string
  switchWorkspace(path: string): void
  checkpoint(): CheckpointStore
  home?: string
}

function argumentsOf(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new Error('Invalid Git tool arguments')
  }
  return input as Record<string, unknown>
}

export function createGitTools(host: GitToolHost): ToolHandler[] {
  let active: WorktreeSession | undefined
  function requireWorktree(): WorktreeSession {
    if (!active || host.cwd() !== active.path) throw new Error('Enter a managed worktree first')
    return active
  }

  return [
    {
      name: 'GitStatus',
      summary: 'Read the Git status of the current workspace',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      describe: () => '查看工作区 Git 状态',
      capability: () => 'read',
      async execute(input) {
        argumentsOf(input, [])
        return JSON.stringify(await readGitStatus(host.cwd()))
      }
    },
    {
      name: 'EnterWorktree',
      summary: 'Create or resume a managed worktree and switch the current workspace',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        additionalProperties: false
      },
      describe: () => '进入专用 Git worktree',
      capability: () => 'write',
      requiresExplicitApproval: () => true,
      prepareApproval(input) {
        const { name } = argumentsOf(input, ['name'])
        if (name !== undefined && typeof name !== 'string') throw new Error('Invalid worktree name')
        if (active) throw new Error('Exit the current managed worktree first')
        const originalCwd = host.cwd()
        const worktreeName = name ?? randomUUID()
        return {
          preview: [`仓库：${originalCwd}`, `工作树：${worktreeName}`],
          async execute() {
            if (active || host.cwd() !== originalCwd) throw new Error('Workspace changed before approval')
            const entered = await enterWorktree({ cwd: originalCwd, name: worktreeName, home: host.home })
            host.switchWorkspace(entered.path)
            active = entered
            return JSON.stringify({ worktreePath: entered.path, worktreeBranch: entered.branch })
          }
        }
      },
      async execute() {
        throw new Error('Entering a worktree requires fresh user approval')
      }
    },
    {
      name: 'ExitWorktree',
      summary: 'Leave the active managed worktree; removal requires fresh user approval',
      parameters: {
        type: 'object',
        properties: { action: { enum: ['keep', 'remove'] }, discard_changes: { type: 'boolean' } },
        required: ['action'],
        additionalProperties: false
      },
      describe: () => '退出专用 Git worktree',
      capability: (input) => (input as { action?: unknown } | null)?.action === 'remove' ? 'write' : 'read',
      requiresExplicitApproval: (input) => (input as { action?: unknown } | null)?.action === 'remove',
      async prepareApproval(input) {
        const { action, discard_changes } = argumentsOf(input, ['action', 'discard_changes'])
        const worktree = requireWorktree()
        if (action === 'keep') {
          return {
            preview: [`保留工作树：${worktree.path}`],
            async execute() {
              if (requireWorktree() !== worktree) throw new Error('Active worktree changed')
              const result = await exitWorktree({ ...worktree, action })
              host.switchWorkspace(result.cwd)
              active = undefined
              return JSON.stringify(result)
            }
          }
        }
        if (action !== 'remove' || (discard_changes !== undefined && typeof discard_changes !== 'boolean')) {
          throw new Error('Invalid worktree exit action')
        }
        const { authorization, preview } = await prepareWorktreeRemoval(worktree, discard_changes === true)
        return {
          preview,
          async execute() {
            if (requireWorktree() !== worktree) throw new Error('Active worktree changed after approval')
            const result = await exitWorktree({ ...worktree, action, discard_changes, authorization })
            host.switchWorkspace(result.cwd)
            active = undefined
            return JSON.stringify(result)
          }
        }
      },
      async execute(input) {
        const { action } = argumentsOf(input, ['action', 'discard_changes'])
        if (action !== 'keep') throw new Error('Removing a worktree requires fresh user approval')
        const result = await exitWorktree({ ...requireWorktree(), action })
        host.switchWorkspace(result.cwd)
        active = undefined
        return JSON.stringify(result)
      }
    },
    {
      name: 'GitCommit',
      summary: 'Preview and commit only verified session changes in the active managed worktree',
      parameters: {
        type: 'object',
        properties: { message: { type: 'string', minLength: 1, maxLength: 4096 } },
        required: ['message'],
        additionalProperties: false
      },
      describe: () => '审批并提交本会话改动',
      capability: () => 'write',
      requiresExplicitApproval: () => true,
      async prepareApproval(input) {
        const { message } = argumentsOf(input, ['message'])
        if (typeof message !== 'string' || !message.trim() || message.length > 4096) {
          throw new Error('A non-empty commit message is required')
        }
        const worktree = requireWorktree()
        const checkpoint = host.checkpoint()
        const status = await readGitStatus(worktree.path)
        if (!status.head || status.branch !== worktree.branch) throw new Error('Managed worktree identity changed')
        const files = await commitFilesFromCheckpoints(worktree.path, status.head, checkpoint.open())
        const { authorization, preview } = await createCommitAuthorization({
          worktree: worktree.path,
          branch: worktree.branch,
          head: status.head,
          message: message.trim(),
          files
        })
        return {
          preview,
          async execute() {
            if (requireWorktree() !== worktree) throw new Error('Active worktree changed after approval')
            const result = await commitWithAuthorization(authorization, files)
            checkpoint.clear()
            return JSON.stringify(result)
          }
        }
      },
      async execute() {
        throw new Error('Git commit requires fresh user approval')
      }
    }
  ]
}
