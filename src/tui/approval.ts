// Approval interaction (SP002 design §3.6, AC TC-05).
// Claim-once: the first decision wins, later decisions are ignored.
import type { ApprovalDecision, ApprovalGateway, ApprovalRequest } from '../core/tools.js'

export class InkApprovalGateway implements ApprovalGateway {
  private readonly pending = new Map<
    string,
    { request: ApprovalRequest; resolve: (decision: ApprovalDecision) => void }
  >()

  get pendingRequests(): ApprovalRequest[] {
    return [...this.pending.values()].map((entry) => entry.request)
  }

  request(request: ApprovalRequest): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(request.requestId, { request, resolve })
    })
  }

  /** Resolve a pending request. Returns false when it was already resolved. */
  resolve(
    requestId: string,
    outcome: 'allow' | 'deny',
    via: 'user' | 'policy' = 'user'
  ): boolean {
    const entry = this.pending.get(requestId)
    if (!entry) return false
    this.pending.delete(requestId)
    entry.resolve({ outcome, via })
    return true
  }

  cancelAll(): void {
    for (const [, entry] of this.pending) {
      entry.resolve({ outcome: 'cancelled', via: 'policy' })
    }
    this.pending.clear()
  }
}
