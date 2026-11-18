// Permission ports owned by Core (SP003 design §3.3/§4.1).
// Core defines the decision contract only; the implementation (modes,
// rules, floor rules) lives in src/workspace and is injected into the
// Session. Hosts never see more than the verdict.

export type PermissionMode = 'read_only' | 'workspace_edit' | 'full_access'

export type ToolCapability = 'read' | 'write' | 'execute'

export type PermissionAction = 'allow' | 'ask' | 'deny'

export type PermissionRequest = {
  tool: string
  capability: ToolCapability
  /** Workspace-relative path when the call targets one. */
  path?: string
}

export type PermissionVerdict = {
  action: PermissionAction
  /** Human readable and stable wording; shown in denials and toasts. */
  reason: string
  /** Rule id when a persisted rule produced the verdict. */
  ruleId?: string
}

export interface PermissionPolicy {
  decide(request: PermissionRequest): PermissionVerdict
  /** Called when the user picks "allow for this session". */
  remember(request: PermissionRequest): void
  canRemember?(request: PermissionRequest): boolean
  getMode(): PermissionMode
  setMode(mode: PermissionMode): void
  /** Lets the Session emit permission_changed when the mode moves. */
  onModeChanged?(listener: (mode: PermissionMode) => void): void
}
