// Model-based conversation summarization for context compaction.
// SP009 0.9.1 (loop-context-fidelity LC-06): aligns the compaction METHOD with
// the reference, which condenses the dropped history with a model call instead
// of silently discarding it. The prompt below is written independently for this
// repository (the reference's prompt text is not copied); only the mechanism —
// "summarize the old turns into a structured continuation brief, keep the recent
// tail" — is replicated.
import type { Message } from './events.js'
import { estimateText } from './context-budget.js'

/** Upper bound on the generated summary, in tokens (reference reserves ~20k). */
export const SUMMARY_TOKEN_CAP = 16_000

/**
 * Render the messages that are about to be compacted into a plain-text
 * transcript for the summarizer. Images are dropped (they are not needed to
 * summarize and could push the summarization request itself over the limit).
 */
export function renderMessagesForSummary(messages: readonly Message[]): string {
  const lines: string[] = []
  for (const message of messages) {
    const texts: string[] = []
    const tools: string[] = []
    for (const block of message.blocks) {
      if (block.type === 'text' && block.text.trim()) texts.push(block.text)
      else if (block.type === 'tool_use') tools.push(`call ${block.name}(${JSON.stringify(block.input ?? {})})`)
      else if (block.type === 'tool_result') tools.push(`result${block.isError ? ' (error)' : ''}: ${block.content}`)
      // image / thinking blocks are intentionally omitted from the summary input
    }
    const body = [...texts, ...tools].join('\n').trim()
    if (!body) continue
    lines.push(`[${message.role}]\n${body}`)
  }
  return lines.join('\n\n')
}

/**
 * Build the summarization request body. Original wording; asks for a thorough
 * continuation brief so development can resume without losing context.
 */
export function buildSummaryPrompt(transcript: string, instruction?: string): string {
  const extra = instruction && instruction.trim()
    ? `\nAdditional summarization instructions from the user (follow them):\n${instruction.trim()}\n`
    : ''
  return [
    'You are condensing a coding-agent conversation so work can continue without losing context.',
    'Produce a detailed summary of the conversation below. Capture the user\'s explicit requests,',
    'the actions taken, technical details, code patterns and decisions that matter for continuing.',
    '',
    'First think through the conversation inside <analysis> tags (chronological, note user corrections).',
    'Then output the final brief inside <summary> tags with these sections:',
    '1. Primary Request and Intent',
    '2. Key Technical Concepts',
    '3. Files and Code Sections (name files, include important snippets and why they matter)',
    '4. Errors and Fixes (what failed, how it was resolved, user feedback)',
    '5. Problem Solving (ongoing reasoning and troubleshooting)',
    '6. All User Messages (list the non-tool user messages)',
    '7. Pending Tasks (anything explicitly requested but not finished)',
    '8. Current Work (precisely what was being done right before this summary)',
    '9. Optional Next Step (only if directly in line with the most recent request)',
    extra,
    'Conversation to summarize:',
    '<conversation>',
    transcript,
    '</conversation>',
    '',
    'Respond with the <analysis> block followed by the <summary> block. Plain text only.'
  ].join('\n')
}

/**
 * Extract the usable summary from the model response: keep the <summary> block
 * when present, otherwise the whole text; drop the <analysis> scratchpad. Caps
 * the result so a runaway summary cannot itself overflow the budget.
 */
export function extractSummary(response: string): string {
  let text = response.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '').trim()
  const match = /<summary>([\s\S]*?)<\/summary>/i.exec(text)
  if (match) text = match[1].trim()
  text = text.replace(/<\/?summary>/gi, '').trim()
  if (!text) return ''
  if (estimateText(text) > SUMMARY_TOKEN_CAP) {
    // Trim from the front sections least likely to matter for continuation is
    // risky; instead keep the tail (current work / next step) which is most
    // valuable, bounded by the cap.
    const charsPerToken = 4
    const maxChars = SUMMARY_TOKEN_CAP * charsPerToken
    text = text.slice(text.length - maxChars)
  }
  return text
}
