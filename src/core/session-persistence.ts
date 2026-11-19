// Session persistence and context-budget wiring helpers (SP005 design §4/§5).
//
// Core stays free of IO: the session loop talks to a transcript port and a
// budget manager, both declared in core and injected by the host.
import type { Message } from './events.js'
import type {
  CompactionResult,
  ContextBudgetManager,
  PreservedItem
} from './context-budget.js'
import type { TranscriptRecord } from './transcript.js'

/**
 * Append one record to the transcript without ever breaking the turn.
 * A persistence failure must not swallow the business result (FR-07): the
 * caller receives the error and reports it separately.
 */
export function appendTranscript(
  transcript: { append(record: TranscriptRecord): void } | undefined,
  record: TranscriptRecord
): { ok: true } | { ok: false; code: string; message: string } {
  if (!transcript) return { ok: true }
  try {
    transcript.append(record)
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      code: 'BUDINGX_STORAGE_005',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Turn a compaction result into the messages that must be sent to the model.
 * The result already carries the preserved facts and the carried tool
 * placeholders, so nothing is dropped here.
 */
export function compactedMessages(result: CompactionResult): Message[] {
  return result.messages
}

/**
 * The plan is preserved as structured state, not as a model-authored summary.
 * The host supplies the current plan text; without a host there is nothing
 * to preserve.
 */
export function planPreservedItem(planText: string | undefined): PreservedItem | undefined {
  if (!planText || !planText.trim()) return undefined
  return {
    kind: 'plan',
    id: 'plan',
    text: planText.trim(),
    reason: 'approved plan must survive context compaction'
  }
}
