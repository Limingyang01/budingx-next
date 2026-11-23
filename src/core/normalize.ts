// Message normalization for the provider boundary (SP002 design §3.3).
import type { ApiContentPart, ApiMessage } from './provider.js'
import type { Message, MessageBlock } from './events.js'

const SYNTHETIC_TOOL_RESULT = '[tool call did not complete]'

function textOf(blocks: MessageBlock[]): string {
  return blocks
    .filter((block): block is Extract<MessageBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

export function normalizeForApi(
  messages: Message[],
  preserveToolReasoning?: (message: Message) => boolean
): ApiMessage[] {
  const usedCallIds = new Set<string>()
  const seenCallIds = new Set<string>()
  const result: ApiMessage[] = []
  const awaitingResult = new Set<string>()

  for (const message of messages) {
    if (message.role === 'user') {
      // Context references (SP003 AC FC-04) are wrapped separately so file
      // content never blurs into the user's own words.
      const contextBlocks = message.blocks.filter(
        (block): block is Extract<MessageBlock, { type: 'context' }> =>
          block.type === 'context'
      )
      const text = textOf(message.blocks)
      // Skills arrive as context blocks so the body reaches the model without
      // being rendered as something the user typed (SP009 skill display).
      const prefix = contextBlocks
        .map((block) =>
          block.source.startsWith('skill:')
            ? `<skill name="${block.source.slice('skill:'.length)}">\n${block.content}\n</skill>`
            : `<file_context source="${block.source}">\n${block.content}\n</file_context>`
        )
        .join('\n\n')
      const combined = prefix ? `${prefix}\n\n${text}` : text
      // SP007 MM-07: user images become OpenAI-shaped content parts
      // (text first, images after). The pure-text path stays byte-identical.
      const images = message.blocks.filter(
        (block): block is Extract<MessageBlock, { type: 'image' }> => block.type === 'image'
      )
      if (images.length === 0) {
        result.push({ role: 'user', content: combined })
      } else {
        const parts: ApiContentPart[] = []
        if (combined) parts.push({ type: 'text', text: combined })
        for (const image of images) {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${image.mediaType};base64,${image.data}` }
          })
        }
        result.push({ role: 'user', content: parts })
      }
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
      const reasoning = preserveToolReasoning?.(message)
        ? message.blocks
            .filter((block): block is Extract<MessageBlock, { type: 'thinking' }> => block.type === 'thinking')
            .map((block) => block.text)
            .join('')
        : ''
      result.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolCalls,
        ...(reasoning ? { reasoning_content: reasoning } : {})
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
