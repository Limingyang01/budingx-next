// SP006 端到端回归：真实 CLI 子进程 + 真实用户数据目录 + 真实 HTTP provider。
// 场景：进程 A 用 --session 写入一轮对话；进程 B 用同一 --session 恢复并续写。
// 断言：续写请求带上恢复出的历史；续写落回被恢复会话的 transcript.jsonl。
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { sessionDirectory } from '../dist/storage/private-file.js'
import { TRANSCRIPT_FILE } from '../dist/storage/session-transcript.js'

const CLI_PATH = fileURLToPath(new URL('../dist/tui/cli.js', import.meta.url))

/** 跑一次真实 CLI 子进程，收集退出码与输出。 */
function runCli(env, cwd, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], { env, cwd })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

test('SP006：真实 CLI 进程恢复会话后带历史续写并写回同一会话', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-resume-e2e-'))
  const workspace = join(home, 'workspace')
  mkdirSync(workspace, { recursive: true })
  t.after(() => rmSync(home, { recursive: true, force: true }))

  const requests = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(
      'data: {"choices":[{"delta":{"content":"已收到"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
    )
  })
  server.listen(0, '127.0.0.1')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`

  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: '',
    HOMEPATH: '',
    BUDINGX_BASE_URL: baseUrl,
    BUDINGX_MODEL: 'fixture',
    BUDINGX_API_KEY: 'fixture-key',
    NO_COLOR: '1',
    TERM: 'dumb'
  }

  const first = await runCli(env, workspace, ['--prompt', '第一次提问', '--session', 'e2e-session'])
  assert.equal(first.code, 0, `首个进程应成功退出：${first.stderr}`)
  assert.match(first.stdout, /已收到/, '首个进程应拿到模型回答')
  const transcriptPath = join(sessionDirectory('e2e-session', home), TRANSCRIPT_FILE)
  assert.ok(existsSync(transcriptPath), '首个进程必须写出会话转录')
  assert.match(readFileSync(transcriptPath, 'utf8'), /第一次提问/, '转录必须含首轮提问')

  const second = await runCli(env, workspace, ['--prompt', '继续提问', '--session', 'e2e-session'])
  assert.equal(second.code, 0, `恢复进程应成功退出：${second.stderr}`)
  assert.equal(requests.length, 2, '恢复进程应发出一次新的模型请求')
  const secondRequest = JSON.stringify(requests[1].messages)
  assert.match(secondRequest, /第一次提问/, '恢复后的请求必须带上历史提问')
  assert.match(secondRequest, /继续提问/, '恢复后的请求必须带上新的提问')
  const transcript = readFileSync(transcriptPath, 'utf8')
  assert.match(transcript, /继续提问/, '续写必须写进被恢复会话的转录')
  assert.match(transcript, /第一次提问/, '被恢复会话的转录必须保留原有历史')
})