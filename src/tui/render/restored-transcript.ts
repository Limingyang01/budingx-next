// Restored conversation rendering (SP006).
//
// /resume loads a previous session into the model context. The host also has
// to show it: this module turns the restored messages into the same
// transcript entries the live reducer produces, so a resumed session looks
// exactly like the original run.
//
// Pure function, no I/O: the input array is walked once and every message
// contributes at most a handful of entries, so a long session stays cheap.
import type { Message } from '../../core/events.js'
import type { TranscriptEntry, ToolTranscriptEntry } from './types.js'
import { toolArgument } from './tool-summary.js'

/**
 * Build the visible transcript for a restored session.
 *
 * - user text becomes a user entry, attached context becomes a dim meta line.
 * - assistant text becomes an assistant entry, every tool_use becomes a tool
 *   entry in the same one-line form the live reducer uses.
 * - a matching tool_result fills in status and result of its tool entry.
 * - a tool_use without a result is marked as interrupted: a restored session
 *   must never look like a tool is still running.
 */
export function restoredTranscriptEntries(messages: readonly Message[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  const toolsByCallId = new Map<string, ToolTranscriptEntry>()

  for (const message of messages) {
    if (message.role === 'user') {
      for (const block of message.blocks) {
        if (block.type === 'text') {
          if (block.text.trim().length > 0) entries.push({ kind: 'user', text: block.text })
        } else if (block.type === 'context') {
          entries.push({ kind: 'meta', text: `上下文 · ${block.source}` })
        }
      }
      continue
    }

    if (message.role === 'assistant') {
      for (const block of message.blocks) {
        if (block.type === 'text') {
          if (block.text.trim().length > 0) entries.push({ kind: 'assistant', text: block.text })
        } else if (block.type === 'tool_use') {
          const entry: ToolTranscriptEntry = {
            kind: 'tool',
            text: `${block.name}(${toolArgument(block.input)})`,
            turnId: `restored-${message.id}`,
            callId: block.id,
            status: 'pending'
          }
          toolsByCallId.set(block.id, entry)
          entries.push(entry)
        } else if (block.type === 'interrupt_mark') {
          entries.push({ kind: 'meta', text: '已中断' })
        }
      }
      continue
    }

    for (const block of message.blocks) {
      if (block.type !== 'tool_result') continue
      const pending = toolsByCallId.get(block.callId)
      if (pending) {
        pending.status = block.isError ? 'error' : 'success'
        pending.result = block.content
        continue
      }
      entries.push({
        kind: 'tool',
        text: '工具结果',
        turnId: 'restored-unknown',
        callId: block.callId,
        status: block.isError ? 'error' : 'success',
        result: block.content
      })
    }
  }

  for (const entry of toolsByCallId.values()) {
    if (entry.status === 'pending') entry.status = 'interrupted'
  }

  return entries
}
