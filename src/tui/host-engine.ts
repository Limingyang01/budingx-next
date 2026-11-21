// SP008 T9：把进程内 AgentRuntime 适配成宿主端口。
// 角色与归属由 HostServer 决定，本文件只做会话能力映射与审批桥。
import type { ApprovalDecision, ApprovalGateway, ApprovalRequest } from '../core/tools.js'
import type { Message, SessionEvent } from '../core/events.js'
import type { PermissionMode } from '../core/permissions.js'
import type { HostEngine, HostEngineDescription, HostHistory } from '../host/engine.js'
import type { AgentRuntime } from './runtime.js'
import { workspacePromptOptions } from './runtime.js'

export const HOST_APPROVAL_TIMEOUT_MS = 120_000

/**
 * 把审批请求转给宿主客户端；超时按策略拒绝，避免所有权丢失后回合永久挂起。
 * 决策一次生效：重复回答返回 false。
 */
export class HostApprovalGateway implements ApprovalGateway {
  private readonly pending = new Map<
    string,
    { resolve: (decision: ApprovalDecision) => void; timer: NodeJS.Timeout }
  >()

  constructor(private readonly timeoutMs: number = HOST_APPROVAL_TIMEOUT_MS) {}

  request(request: ApprovalRequest): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(request.requestId)) {
          resolve({ outcome: 'deny', via: 'policy' })
        }
      }, this.timeoutMs)
      timer.unref?.()
      this.pending.set(request.requestId, { resolve, timer })
    })
  }

  resolve(requestId: string, outcome: 'allow' | 'allow_session' | 'deny'): boolean {
    const entry = this.pending.get(requestId)
    if (!entry) return false
    this.pending.delete(requestId)
    clearTimeout(entry.timer)
    entry.resolve({ outcome, via: 'user' })
    return true
  }

  get pendingCount(): number {
    return this.pending.size
  }

  cancelAll(): void {
    for (const [requestId, entry] of this.pending) {
      this.pending.delete(requestId)
      clearTimeout(entry.timer)
      entry.resolve({ outcome: 'cancelled', via: 'policy' })
    }
  }
}

export type CreateHostEngineOptions = {
  runtime: AgentRuntime
  workspaceId: string
  gateway: HostApprovalGateway
  title?: string
}

export function createHostEngine(options: CreateHostEngineOptions): HostEngine {
  const { runtime, workspaceId, gateway, title } = options
  const session = runtime.session

  return {
    describe(): HostEngineDescription {
      return {
        sessionId: session.id,
        workspaceId,
        ...(title === undefined ? {} : { title }),
        state: session.currentState,
        planMode: session.planMode.active,
        permissionMode: runtime.policy.getMode()
      }
    },
    history(limit?: number): HostHistory {
      const all: Message[] = [...session.history]
      if (limit === undefined) return { messages: all, truncated: false }
      const messages = all.slice(Math.max(0, all.length - limit))
      return { messages, truncated: messages.length < all.length }
    },
    submit(text: string): void {
      session.submit(text, workspacePromptOptions(text, runtime.workspace, runtime.policy))
    },
    interrupt(): boolean {
      session.interrupt('user')
      return true
    },
    approve(requestId: string, outcome: 'allow' | 'deny'): boolean {
      return gateway.resolve(requestId, outcome === 'allow' ? 'allow' : 'deny')
    },
    setPermissionMode(mode: PermissionMode): boolean {
      return runtime.setPermissionMode(mode)
    },
    onEvent(listener: (event: SessionEvent) => void): () => void {
      return session.on(listener)
    },
    async dispose(): Promise<void> {
      gateway.cancelAll()
      session.dispose()
      await runtime.shutdownTracing?.()
    }
  }
}
