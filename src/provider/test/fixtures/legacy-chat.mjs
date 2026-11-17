// Frozen baseline of the 0.1.1 preview provider implementation.
// It exists only as regression evidence: the new provider must stay
// behaviourally equivalent (SP002 AC PS-01). Not part of the product.
export function normalizeBaseUrl(input) {
  let url
  try {
    url = new URL(input)
  } catch {
    throw new Error('Invalid base URL')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Base URL must not contain credentials, query or fragment')
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new Error(
      'Use HTTPS (HTTP is allowed only for explicit loopback endpoints)'
    )
  return url.toString().replace(/\/+$/, '')
}

export async function* streamChat(config, messages, signal) {
  const baseUrl = normalizeBaseUrl(config.baseUrl)
  if (!config.model.trim())
    throw new Error('Set BUDINGX_MODEL or use /model <name>')
  if (
    !config.apiKey &&
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname)
  )
    throw new Error('Set BUDINGX_API_KEY before starting budingx')
  if (messages.some((message) => message.content.length > 32768))
    throw new Error('Message exceeds 32768 characters')
  const combined = AbortSignal.any([
    AbortSignal.timeout(config.timeoutMs),
    ...(signal ? [signal] : [])
  ])
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    redirect: 'error',
    signal: combined,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
    },
    body: JSON.stringify({ model: config.model, messages, stream: true })
  }).catch(() => {
    if (combined.aborted) throw combined.reason
    throw new Error('Connection failed; check endpoint and network')
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(
      `Provider HTTP ${response.status}; check credentials, model and endpoint`
    )
  }
  if (
    !response.body ||
    !response.headers.get('content-type')?.includes('text/event-stream')
  ) {
    await response.body?.cancel()
    throw new Error('Provider did not return an SSE stream')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let total = 0
  let receivedText = false
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) throw new Error('Provider stream incomplete or truncated')
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '')
      if (buffer.length > 1048576)
        throw new Error('Provider event exceeds size limit')
      let end
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const data = event
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (!data) continue
        if (data.trim() === '[DONE]') {
          if (!receivedText) throw new Error('Provider returned no text')
          return
        }
        let payload
        try {
          payload = JSON.parse(data)
        } catch {
          throw new Error('Malformed or invalid provider event')
        }
        if (!payload || payload.error)
          throw new Error('Provider reported an error')
        const choice = payload.choices?.[0]
        const delta = choice?.delta
        if (delta?.tool_calls || delta?.function_call)
          throw new Error(
            'Tool calls are not supported in this chat-only preview'
          )
        if (choice?.finish_reason && choice.finish_reason !== 'stop')
          throw new Error(
            'Provider did not complete the answer (limit/filter/tool request)'
          )
        if (typeof delta?.content === 'string' && delta.content) {
          total += delta.content.length
          if (total > 32768)
            throw new Error(
              'Answer exceeds 32768 characters; use /clear or a shorter request'
            )
          receivedText = true
          yield delta.content
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
