// Message normalization for the provider boundary (SP002 design §3.3).
import type { ApiMessage } from './provider.js'
import type { Message, MessageBlock } from './events.js'

const SYNTHETIC_TOOL_RESULT = '[tool call did not complete]'

function textOf(blocks: MessageBlock[]): string {
  return blocks
    .filter((block): block is Extract<MessageBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

export function normalizeForApi(messages: Message[]): ApiMessage[] {
  const usedCallIds = new Set<string>()
  const seenCallIds = new Set<string>()
  const result: ApiMessage[] = []
  const awaitingResult = new Set<string>()

  for (const message of messages) {
    if (message.role === 'user') {
      result.push({ role: 'user', content: textOf(message.blocks) })
      continue
    }
    if (message.role === 'tool') {
      for (const block of message.blocks) {
        if (block.type !== 'tool_result') continue
        // Orphan tool results (no matching tool call) never reach the model.
        if (!usedCallIds.has(block.callId)) continue
        result.push({ role: 'tool', tool_call_id: block.callId, content: block.content })
        awaitingResult.delete(block.callId)
      }
      continue
    }
    // assistant
    const toolCalls: { id: string; type: 'function'; function: { name: string; arguments: string } }[] = []
    for (const block of message.blocks) {
      if (block.type !== 'tool_use') continue
      if (seenCallIds.has(block.id)) continue
      seenCallIds.add(block.id)
      usedCallIds.add(block.id)
      awaitingResult.add(block.id)
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {})
        }
      })
    }
    const text = textOf(message.blocks)
    if (toolCalls.length > 0) {
      result.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolCalls
      })
    } else if (text) {
      result.push({ role: 'assistant', content: text })
    }
  }

  // Tool calls without a result get a synthetic error result so the model
  // never sees a dangling tool_use.
  for (const callId of awaitingResult) {
    result.push({ role: 'tool', tool_call_id: callId, content: SYNTHETIC_TOOL_RESULT })
  }
  return result
}
