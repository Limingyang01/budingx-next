// Local fake provider for manual testing (SP002 human smoke).
// Never talks to a real service and never stores a key.
// Usage: node scripts/dev/fake-provider.mjs [port]
// Then: BUDINGX_BASE_URL=http://127.0.0.1:<port>/v1 BUDINGX_MODEL=fake npm start
import { createServer } from 'node:http'
import { once } from 'node:events'

const port = Number(process.argv[2] ?? 8787)
const tokenDelayMs = Number(process.env.FAKE_TOKEN_DELAY_MS ?? 120)

function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

const server = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk

  if (!req.url?.endsWith('/chat/completions')) {
    res.writeHead(404).end('not found')
    return
  }

  const request = JSON.parse(body)
  const lastUser = [...(request.messages ?? [])]
    .reverse()
    .find((message) => message.role === 'user')
  const text = String(lastUser?.content ?? '')

  res.writeHead(200, { 'Content-Type': 'text/event-stream' })

  if (text.includes('TOOL')) {
    sse(res, {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'echo', arguments: '{"text":"hi"}' }
              }
            ]
          }
        }
      ]
    })
    sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }] })
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }

  const tokens = text.includes('LONG')
    ? Array.from({ length: 40 }, (_, index) => `token-${index} `)
    : ['你好', '，', 'fake', ' ', 'provider', ' ', 'ok']
  for (const token of tokens) {
    await new Promise((resolve) => setTimeout(resolve, tokenDelayMs))
    sse(res, { choices: [{ delta: { content: token } }] })
  }
  sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }] })
  res.write('data: [DONE]\n\n')
  res.end()
})

server.listen(port, '127.0.0.1')
await once(server, 'listening')
console.log(`fake provider listening on http://127.0.0.1:${server.address().port}/v1`)
console.log('send a prompt containing TOOL to trigger a tool call, LONG for a slow stream')
