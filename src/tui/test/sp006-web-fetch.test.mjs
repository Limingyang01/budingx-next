// SP006 §10 网页抓取（WR-01 … WR-05）。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { TOOL_OUTPUT_CAP } from '../dist/core/constants.js'
import { Session } from '../dist/core/session.js'
import {
  createWebFetchTool,
  extractReadableText,
  fetchWebPage,
  isPrivateHost
} from '../dist/provider/web-fetch.js'

function context(approved = true) {
  return {
    signal: new AbortController().signal,
    changes() {},
    turnId: 'turn-1',
    callId: 'call-1',
    emit() {},
    approved
  }
}

async function withServer(handler, run) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    return await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

const HTML = `<!doctype html><html><head><title>T</title><style>body{color:red}</style></head>
<body><nav>导航噪声</nav><script>alert('x')</script>
<main><h1>标题</h1><p>第一段 &amp; 内容</p><p>第二段&nbsp;文本</p></main>
<footer>页脚</footer></body></html>`

test('WR-01 文本提取与内网判定是纯函数', () => {
  const text = extractReadableText(HTML)
  assert.match(text, /标题/)
  assert.match(text, /第一段 & 内容/)
  assert.match(text, /第二段 文本/)
  assert.doesNotMatch(text, /导航噪声|alert|color:red|页脚/)

  for (const host of ['127.0.0.1', '10.0.0.5', '172.16.8.9', '192.168.1.1', '169.254.1.1', 'localhost', '[::1]', '::1', 'fd00::1', 'fe80::1']) {
    assert.equal(isPrivateHost(host), true, host + ' 应判定为内网')
  }
  for (const host of ['example.com', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) {
    assert.equal(isPrivateHost(host), false, host + ' 不应判定为内网')
  }
})

test('WR-02 默认拒绝内网，显式允许后才抓取', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ALLOWED')
  }, async (base) => {
    await assert.rejects(
      () => fetchWebPage(base + '/page', context()),
      (error) => error.code === 'BUDINGX_WEB_PRIVATE_HOST' && /内网/.test(error.message)
    )
    const result = await fetchWebPage(base + '/page', context(), { allowPrivateHosts: true })
    assert.equal(result.text, 'ALLOWED')
    assert.equal(result.status, 200)
  })
})

test('WR-01/WR-04 抓取 HTML 去噪并按上限截断', async () => {
  await withServer((req, res) => {
    if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('x'.repeat(4096))
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(HTML)
  }, async (base) => {
    const result = await fetchWebPage(base + '/page', context(), { allowPrivateHosts: true })
    assert.match(result.text, /第一段 & 内容/)
    assert.equal(result.contentType, 'text/html')
    assert.equal(result.truncated, false)

    const tool = createWebFetchTool({ allowPrivateHosts: true, maxBytes: 1024 })
    const output = await tool.execute({ url: base + '/big' }, context())
    assert.match(output, /HTTP 200/)
    assert.match(output, /\[truncated\] 响应超过 1024 字节/)
    assert.equal(output.includes('x'.repeat(1100)), false)

    const fetched = await fetchWebPage(base + '/big', context(), { allowPrivateHosts: true, maxBytes: 1024 })
    assert.equal(fetched.truncated, true)
    assert.equal(fetched.bytes, 1024)
  })
})

test('WR-03 未获审批时不发起请求', async () => {
  let requests = 0
  await withServer((req, res) => {
    requests++
    res.writeHead(200)
    res.end('secret')
  }, async (base) => {
    const tool = createWebFetchTool({ allowPrivateHosts: true })
    await assert.rejects(
      () => tool.execute({ url: base + '/page' }, context(false)),
      (error) => error.code === 'BUDINGX_WEB_APPROVAL_REQUIRED'
    )
    assert.equal(requests, 0, '审批拒绝必须发生在请求之前')
    const preview = tool.prepareApproval({ url: base + '/page' })
    assert.deepEqual(preview.preview, [base + '/page'])
  })
})

test('AC-SUBAGENT-01 WebFetch 将长正文与截断提示限制在 Core 输出预算内', async () => {
  await withServer((req, res) => {
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.end(req.url === '/long' ? '🌏'.repeat(TOOL_OUTPUT_CAP) : '短页面')
  }, async (base) => {
    const tool = createWebFetchTool({ allowPrivateHosts: true })
    const long = await tool.execute({ url: base + '/long' }, context())
    assert.ok(long.length <= TOOL_OUTPUT_CAP, 'WebFetch 输出超过 Core 上限')
    assert.match(long, /\[truncated\].*32768/)
    assert.match(long, /🌏/)
    assert.doesNotMatch(long, /[\uD800-\uDFFF]/u, '截断不能留下不完整的 Unicode 字符')
    const short = await tool.execute({ url: base + '/short' }, context())
    assert.match(short, /短页面/)
    assert.doesNotMatch(short, /\[truncated\]/)
    assert.match(short, /32768/)
  })
})

test('AC-SUBAGENT-01 WebFetch 区分正文读取超时与网络连接失败', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.write('headers and an incomplete body')
  }, async (base) => {
    await assert.rejects(
      () => fetchWebPage(base, context(), { allowPrivateHosts: true, timeoutMs: 120 }),
      (error) => error.code === 'BUDINGX_WEB_TIMEOUT'
    )
  })
  await withServer((req) => { req.socket.destroy() }, async (base) => {
    await assert.rejects(
      () => fetchWebPage(base, context(), { allowPrivateHosts: true }),
      (error) => error.code === 'BUDINGX_WEB_NETWORK' && /网络/.test(error.message)
    )
  })
})

test('AC-SUBAGENT-01 六次长页面抓取通过生产工具派发并正常结束回合', async () => {
  await withServer((_req, res) => {
    res.setHeader('content-type', 'text/plain')
    res.end('page content '.repeat(4000))
  }, async (base) => {
    let calls = 0
    const session = new Session({
      provider: {
        async *stream() {
          if (++calls > 6) {
            yield { type: 'text_delta', text: 'obtained partial results' }
            yield { type: 'message_completed', finishReason: 'stop' }
            return
          }
          yield {
            type: 'tool_call_delta', index: 0, callId: 'web-' + calls, nameDelta: 'WebFetch',
            argsDelta: JSON.stringify({ url: base + '/page-' + calls })
          }
          yield { type: 'message_completed', finishReason: 'tool_calls' }
        }
      },
      tools: [createWebFetchTool({ allowPrivateHosts: true })],
      approval: { request: async () => ({ outcome: 'allow', via: 'user' }) },
      resolveSnapshot: () => ({ modelId: 'fixture', model: 'fixture', baseUrlHost: 'fixture', capabilities: { tools: true } })
    })
    try {
      const results = []
      const finalized = new Promise((resolve) => session.on((event) => {
        if (event.type === 'tool_result') results.push(event)
        if (event.type === 'turn_finalized') resolve(event)
      }))
      session.submit('Read the fixture pages')
      assert.equal((await finalized).outcome, 'completed')
      assert.equal(results.length, 6)
      for (const result of results) {
        assert.equal(result.isError, false)
        assert.match(result.content, /\[truncated\]/)
        assert.doesNotMatch(result.content, /BUDINGX_CORE_003/)
      }
    } finally {
      session.dispose()
    }
  })
})

test('WR-05 非 2xx、无效 URL、超时都返回稳定错误码', async () => {
  await withServer((req, res) => {
    if (req.url === '/slow') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      setTimeout(() => res.end('late'), 500)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('missing')
  }, async (base) => {
    await assert.rejects(
      () => fetchWebPage(base + '/nope', context(), { allowPrivateHosts: true }),
      (error) => error.code === 'BUDINGX_WEB_HTTP_ERROR' && /HTTP 404/.test(error.message)
    )
    await assert.rejects(
      () => fetchWebPage('ftp://example.com/x', context()),
      (error) => error.code === 'BUDINGX_WEB_INVALID_URL'
    )
    await assert.rejects(
      () => fetchWebPage('not a url', context()),
      (error) => error.code === 'BUDINGX_WEB_INVALID_URL'
    )
    await assert.rejects(
      () => fetchWebPage(base + '/slow', context(), { allowPrivateHosts: true, timeoutMs: 120 }),
      (error) => error.code === 'BUDINGX_WEB_TIMEOUT'
    )
  })
})

test('WR-02 重定向最多 3 次且每次重查内网', async () => {
  await withServer((req, res) => {
    if (req.url === '/r1') {
      res.writeHead(302, { location: '/r2' })
      res.end()
      return
    }
    if (req.url === '/r2') {
      res.writeHead(301, { location: '/final' })
      res.end()
      return
    }
    if (req.url === '/loop') {
      res.writeHead(302, { location: '/loop' })
      res.end()
      return
    }
    if (req.url === '/to-private') {
      res.writeHead(302, { location: 'http://10.0.0.1/' })
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('FINAL')
  }, async (base) => {
    const result = await fetchWebPage(base + '/r1', context(), { allowPrivateHosts: true })
    assert.equal(result.finalUrl, base + '/final')
    assert.equal(result.text, 'FINAL')

    await assert.rejects(
      () => fetchWebPage(base + '/loop', context(), { allowPrivateHosts: true }),
      (error) => error.code === 'BUDINGX_WEB_REDIRECT_LIMIT'
    )
    await assert.rejects(
      () => fetchWebPage(base + '/to-private', context(), { allowPrivateHosts: false }),
      (error) => error.code === 'BUDINGX_WEB_PRIVATE_HOST'
    )
    // 重定向目标的检查发生在跟随之前，不允许借重定向绕过内网限制。

  })
})

test('WR-01 工具在独立进程中可完成真实抓取', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html><body><p>SUBPROCESS-OK</p></body></html>')
  }, async (base) => {
    const script = `
import { createWebFetchTool } from './src/tui/dist/provider/web-fetch.js'
const tool = createWebFetchTool({ allowPrivateHosts: true })
const context = { signal: new AbortController().signal, changes() {}, turnId: 't', callId: 'c', emit() {}, approved: true }
const out = await tool.execute({ url: process.argv[1] }, context)
process.stdout.write(out)
`
    const output = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script, base + '/page'], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
      child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve(stdout)
        else reject(new Error('exit ' + code + ': ' + stderr))
      })
    })
    assert.match(output, /SUBPROCESS-OK/)
    assert.match(output, /HTTP 200/)
  })
})
