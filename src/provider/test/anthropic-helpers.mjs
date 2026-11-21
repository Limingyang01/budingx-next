// fake fetch helpers shared by SP007 anthropic tests
export function sseResponse(frames, { status = 200, headers = {} } = {}) {
  const text = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'text/event-stream', ...headers }
  })
}

export function fakeFetch(handler) {
  const calls = []
  const impl = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined
    calls.push({ url: String(url), init, body })
    return handler(String(url), init, calls.length, body)
  }
  impl.calls = calls
  return impl
}

export async function collect(provider, request) {
  const events = []
  for await (const event of provider.stream(request)) events.push(event)
  return events
}

export const startFrame = (inputTokens = 25) => ({
  type: 'message_start',
  message: { id: 'msg_1', usage: { input_tokens: inputTokens, output_tokens: 1 } }
})
export const textBlock = (index, text) => [
  { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index, delta: { type: 'text_delta', text } },
  { type: 'content_block_stop', index }
]
export const toolBlock = (index, id, name, jsonParts) => [
  { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name } },
  ...jsonParts.map((p) => ({
    type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: p }
  })),
  { type: 'content_block_stop', index }
]
export const deltaFrame = (stopReason, outputTokens) => ({
  type: 'message_delta',
  delta: { stop_reason: stopReason },
  usage: { output_tokens: outputTokens }
})
export const stopFrame = { type: 'message_stop' }
