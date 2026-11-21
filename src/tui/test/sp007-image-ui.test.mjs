// SP007 MM-03/MM-05/MM-10 — TUI 图片附件真实交互回归（pseudo-TTY + 真实 Ink/App/Session）。
// 覆盖：路径附件→[Image #N]→请求 image_url data URI；读取失败不吞正文；同路径不重复附件。
// provider 用 async generator fixture（UI 流层）；真实模型识图见 scripts/eval/live-image.mjs。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountTty } from './helpers/mount-tty.mjs'
import { encodePng } from '../dist/tui/image-resize.js'

const done = { type: 'message_completed', finishReason: 'stop' }

function solidRgba(w, h, r, g, b, a = 255) {
  const buf = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i += 1) {
    buf[i * 4] = r
    buf[i * 4 + 1] = g
    buf[i * 4 + 2] = b
    buf[i * 4 + 3] = a
  }
  return buf
}

function fixtureImage(t, name = 'redblue.png') {
  const dir = mkdtempSync(join(tmpdir(), 'budingx-image-ui-'))
  const path = join(dir, name)
  writeFileSync(path, encodePng(8, 6, solidRgba(8, 6, 220, 20, 20)))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return path
}

function captureProvider(requests) {
  return {
    async *stream(request) {
      requests.push(request)
      yield done
    }
  }
}

/** 取出请求里第一条 user 消息的图片 data URI 列表。 */
function imageUrls(request) {
  const urls = []
  for (const message of request.messages ?? []) {
    if (message.role !== 'user' || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part.type === 'image_url') urls.push(part.image_url.url)
    }
  }
  return urls
}

test('MM-03/MM-05：输入图片路径→[Image #N] 占位→请求携带 image_url data URI', async (t) => {
  const imagePath = fixtureImage(t)
  const requests = []
  const ui = await mountTty(t, {
    config: { model: 'fixture-model', apiKey: 'fixture-key' },
    provider: captureProvider(requests)
  })
  await ui.send(`请描述这张图片：${imagePath}\r`)
  await ui.waitFor((frame) => /\[Image #1\]/.test(frame))
  assert.equal(requests.length, 1, 'one request per turn')
  const urls = imageUrls(requests[0])
  assert.equal(urls.length, 1, 'exactly one image part')
  assert.match(urls[0], /^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
})

test('MM-10：图片读不到时明确报错、不发起请求，且正文留在输入区', async (t) => {
  const requests = []
  const missing = join(tmpdir(), 'budingx-missing-image-' + Date.now(), 'nope.png')
  const text = `请描述这张图片：${missing}`
  const ui = await mountTty(t, {
    config: { model: 'fixture-model', apiKey: 'fixture-key' },
    provider: captureProvider(requests)
  })
  await ui.send(text + '\r')
  await ui.waitFor((frame) => /无法读取图片/.test(frame))
  assert.equal(requests.length, 0, 'no provider request when the image is unreadable')
  const frame = ui.last()
  // 输入区回显（行首 '>' 的编辑器行）必须仍带原文；提示气泡里的路径不算恢复。
  const composer = frame.split('\n').filter((line) => /^\s*>\s/.test(line))
  assert.ok(
    composer.some((line) => line.includes('nope.png')),
    'prompt text survives in the composer: ' + frame
  )
})

test('MM-05：同一路径写两次只附件一张图，两处占位都替换', async (t) => {
  const imagePath = fixtureImage(t)
  const requests = []
  const ui = await mountTty(t, {
    config: { model: 'fixture-model', apiKey: 'fixture-key' },
    provider: captureProvider(requests)
  })
  await ui.send(`对比 ${imagePath} 和 ${imagePath}\r`)
  await ui.waitFor((frame) => /\[Image #1\]/.test(frame))
  assert.equal(requests.length, 1)
  assert.equal(imageUrls(requests[0]).length, 1, 'same path attaches once')
  const userMessage = (requests[0].messages ?? []).find((m) => m.role === 'user')
  const texts = (userMessage.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
  assert.ok(!texts.includes('redblue.png'), 'no raw path leaks into the prompt: ' + texts)
})
