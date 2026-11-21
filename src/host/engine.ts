// Host engine port (SP008 design §3, AC TB-02/03, SO-01/02).
//
// The host layer never builds a session itself. The TUI (or another entry)
// implements this port over the existing Session and injects it, so core and
// the host keep a one-way dependency: tui → host → core.
import type { Message, SessionEvent } from '../core/events.js'
import type { PermissionMode } from '../core/permissions.js'

/** A tool step whose outcome is unknown after a crash; never replayed. */
export type NeedsReviewStep = { name: string; callId: string; detail?: string }

export type HostEngineDescription = {
  sessionId: string
  workspaceId: string
  title?: string
  state: string
  planMode: boolean
  permissionMode: PermissionMode
  /** Unknown-outcome tool steps restored from the transcript (SH-05). */
  needsReview: NeedsReviewStep[]
  /** Non-fatal restore problems worth showing to the client. */
  warnings: string[]
}

export type HostHistory = {
  messages: Message[]
  /** True when older messages were dropped to satisfy the limit. */
  truncated: boolean
  needsReview: NeedsReviewStep[]
  warnings: string[]
}

export type HostEngine = {
  describe(): HostEngineDescription
  history(limit?: number): HostHistory
  submit(text: string): void
  interrupt(): boolean
  approve(requestId: string, outcome: 'allow' | 'deny'): boolean
  setPermissionMode(mode: PermissionMode): boolean
  onEvent(listener: (event: SessionEvent) => void): () => void
  dispose(): Promise<void>
}
