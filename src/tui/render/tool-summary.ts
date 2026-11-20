// Tool argument summaries (SP006).
// Shared by the live reducer and the restored transcript so a resumed
// session shows the same one-line tool summary as the original run.

/** Summarize a tool input into a single short line. */
export function toolArgument(input: unknown): string {
  if (input && typeof input === 'object') {
    const values = input as Record<string, unknown>
    const target = [values.path, values.pattern, values.query, values.url].find(
      (value): value is string => typeof value === 'string' && value.length > 0
    )
    return summarizeInput(target ?? (Object.keys(values).length ? input : undefined))
  }
  return summarizeInput(input)
}

/** Render an arbitrary value as text, truncated to a readable length. */
export function summarizeInput(input: unknown): string {
  if (input === undefined || input === null) return ''
  const text = typeof input === 'string' ? input : JSON.stringify(input)
  if (!text) return ''
  return text.length > 60 ? text.slice(0, 59) + '…' : text
}
