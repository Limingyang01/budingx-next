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
 *
 * SP006 波次 F：同一条消息里的连续文本块合并成一条记录。老会话按流式增量
 * 逐块落盘（每个增量一个 text 块），逐块渲染会让恢复后的历史碎成一列窄字；
 * 合并后与原始运行时的整段回答一致，无需迁移已写盘的转录。
 */
export function restoredTranscriptEntries(messages: readonly Message[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  const toolsByCallId = new Map<string, ToolTranscriptEntry>()

  for (const message of messages) {
    if (message.role === 'user') {
      let text = ''
      const flush = (): void => {
        if (text.trim().length > 0) entries.push({ kind: 'user', text })
        text = ''
      }
      for (const block of message.blocks) {
        if (block.type === 'text') {
          text += block.text
          continue
        }
        flush()
        if (block.type === 'context') {
          entries.push({ kind: 'meta', text: `上下文 · ${block.source}` })
        }
      }
      flush()
      continue
    }

    if (message.role === 'assistant') {
      let text = ''
      const flush = (): void => {
        if (text.trim().length > 0) entries.push({ kind: 'assistant', text })
        text = ''
      }
      for (const block of message.blocks) {
        if (block.type === 'text') {
          text += block.text
          continue
        }
        // 思考块不进入可见转录，也不打断文本合并。
        if (block.type === 'thinking') continue
        flush()
        if (block.type === 'tool_use') {
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
      flush()
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
