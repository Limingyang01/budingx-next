// SP007 MM-01 补：/image 命令与「同一张图不重复上传」回归。
// 背景（用户 2026-11-21 实测）：VS Code 集成终端把 alt+v 当 chord 前缀吞掉，
// 按键进不了程序；剪贴板只有图片时 ctrl+v 也不会发出任何内容。命令不依赖键位。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDefaultRegistry } from '../dist/tui/commands/index.js'
import { encodePng } from '../dist/tui/image-resize.js'
import { mountTty } from './helpers/mount-tty.mjs'

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
  const dir = mkdtempSync(join(tmpdir(), 'budingx-image-command-'))
  const path = join(dir, name)
  writeFileSync(path, encodePng(8, 6, solidRgba(8, 6, 220, 20, 20)))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { path, dir }
}

function context(overrides = {}) {
  return {
    interactive: true,
    lang: 'zh',
    getConfig: () => ({ model: 'fixture-model' }),
    ...overrides
  }
}

const image = getDefaultRegistry().get('image')

test('MM-01：/image <路径> 返回准备好的附件，不打印笼统错误', async (t) => {
  const { path } = fixtureImage(t)
  const result = await image.run(path, context())
  assert.equal(result.kind, 'text')
  assert.match(result.value, /图片已附件/)
  const attach = result.outcome?.attachImage
  assert.ok(attach, 'outcome.attachImage missing')
  assert.equal(attach.mediaType, 'image/png')
  const bytes = Buffer.from(attach.data, 'base64')
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(attach.width, 8)
  assert.equal(attach.height, 6)
})

test('MM-01：剪贴板没有图片时 /image 给出可操作提示而不是静默', async () => {
  const result = await image.run('', context({ imageSource: { clipboard: () => undefined, file: () => { throw new Error('unused') } } }))
  assert.equal(result.outcome?.attachImage, undefined)
  assert.match(result.value, /剪贴板里没有图片/)
  assert.match(result.value, /\/image <路径>/)
})

test('MM-10：路径读不到时 /image 明确报错', async () => {
  const missing = join(tmpdir(), 'budingx-missing-image-' + Date.now(), 'nope.png')
  const result = await image.run(missing, context())
  assert.equal(result.outcome?.attachImage, undefined)
  assert.match(result.value, /无法读取图片/)
})

test('MM-01：headless 不假装附件成功', async () => {
  const result = await image.run('', context({ interactive: false }))
  assert.equal(result.outcome?.attachImage, undefined)
  assert.match(result.value, /交互式终端/)
})

test('MM-01：粘贴键连按两次同一张图不重复上传', async (t) => {
  const { path } = fixtureImage(t)
  const png = { data: readFileSync(path), mediaType: 'image/png' }
  const requests = []
  const ui = await mountTty(t, {
    config: { model: 'fixture-model', apiKey: 'fixture-key' },
    provider: { async *stream(request) { requests.push(request); yield done } },
    commandOverrides: { imageSource: { clipboard: () => png, file: () => png } }
  })
  // 平台真实键位：Windows alt+v，其他平台 ctrl+v（与 keybindings/defaults.ts 一致）。
  const pasteKey = process.platform === 'win32' ? '\x1bv' : '\x16'
  await ui.send(pasteKey)
  await ui.waitFor((frame) => /\[Image #1\]/.test(frame))
  await ui.send(pasteKey)
  await ui.waitFor((frame) => /该图片已在附件中/.test(frame))
  const composer = ui.last().split('\n').filter((line) => /^\s*>\s/.test(line))
  const placeholders = composer.join('').match(/\[Image #\d+\]/g) ?? []
  assert.equal(placeholders.length, 1, 'duplicate press must not add a second placeholder: ' + composer.join(''))

  await ui.send('\r')
  await ui.waitFor(() => requests.length === 1)
  const urls = []
  for (const message of requests[0].messages ?? []) {
    if (message.role !== 'user' || !Array.isArray(message.content)) continue
    for (const part of message.content) if (part.type === 'image_url') urls.push(part.image_url.url)
  }
  assert.equal(urls.length, 1, 'same image is uploaded once')
})

test('MM-05：同一文件的不同写法只上传一张', async (t) => {
  const { path, dir } = fixtureImage(t)
  const requests = []
  const ui = await mountTty(t, {
    config: { model: 'fixture-model', apiKey: 'fixture-key' },
    provider: { async *stream(request) { requests.push(request); yield done } }
  })
  const alias = join(dir, '.', 'redblue.png')
  await ui.send('对比 ' + path + ' 和 ' + alias + '\r')
  await ui.waitFor(() => requests.length === 1)
  const urls = []
  for (const message of requests[0].messages ?? []) {
    if (message.role !== 'user' || !Array.isArray(message.content)) continue
    for (const part of message.content) if (part.type === 'image_url') urls.push(part.image_url.url)
  }
  assert.equal(urls.length, 1, 'same file twice must attach once')
})
