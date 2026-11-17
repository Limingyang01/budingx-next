// Tool and approval ports owned by Core (SP002 design §3.3).

export type ToolContext = {
  signal: AbortSignal
  onUpdate?(text: string): void
}

export type ToolHandler = {
  name: string
  /** Short static description used for the provider tool specification. */
  summary?: string
  describe(input: unknown): string
  requiresApproval?(input: unknown): boolean
  execute(input: unknown, context: ToolContext): Promise<string>
}

export type ApprovalRequest = {
  requestId: string
  turnId: string
  callId: string
  name: string
  summary: string
}

export type ApprovalDecision = {
  outcome: 'allow' | 'deny' | 'cancelled'
  via: 'user' | 'policy'
}

export interface ApprovalGateway {
  cancelAll?(): void
  request(request: ApprovalRequest): Promise<ApprovalDecision>
}
