#!/usr/bin/env node
// SP007 MM 端到端（opt-in，不进 npm test）：真实模型识图。
// 用法：node scripts/eval/live-image.mjs [--mode path|clipboard|ctrlv] [--image <文件>]
// 需要 .env.e2e.local 配置 BUDINGX_API_KEY / BUDINGX_BASE_URL / BUDINGX_MODEL。
// 流程：真实 Ink App + 真实 OpenAI 兼容 provider；输入区附件图片（路径或剪贴板）→
// provider 收到 image_url data URI → 模型回答颜色；断言回答命中红/蓝。
import { readFileSync, existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { deflateSync } from 'node:zlib'

const ROOT = join(import.meta.dirname, '..', '..')

function parseEnv(filePath) {
  const env = {}
  if (!existsSync(filePath)) return env
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

const CRC_TABLE = (() => {
  const table = new Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  let crc = 0xffffffff
  for (const b of body) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)
  const c = Buffer.alloc(4)
  c.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([len, body, c])
}

/** 128x128：左半纯红、右半纯蓝，便于模型仅凭像素回答颜色。 */
function buildTestPng() {
  const W = 128
  const H = 128
  const raw = Buffer.alloc(H * (1 + W * 3))
  for (let y = 0; y < H; y += 1) {
    const rowStart = y * (1 + W * 3)
    raw[rowStart] = 0
    for (let x = 0; x < W; x += 1) {
      const p = rowStart + 1 + x * 3
      if (x < W / 2) {
        raw[p] = 220
        raw[p + 1] = 20
        raw[p + 2] = 20
      } else {
        raw[p] = 20
        raw[p + 1] = 40
        raw[p + 2] = 220
      }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

const pause = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const argv = process.argv.slice(2)
  const modeIndex = argv.indexOf('--mode')
  const mode = modeIndex >= 0 ? (argv[modeIndex + 1] ?? 'path') : 'path'
  const imageOverrides = argv.flatMap((value, index) =>
    value === '--image' && argv[index + 1] ? [resolve(argv[index + 1])] : []
  )
  if (mode !== 'path' && mode !== 'clipboard' && mode !== 'ctrlv') {
    console.error('--mode 只支持 path | clipboard | ctrlv')
    process.exitCode = 1
    return
  }

  const env = parseEnv(join(ROOT, '.env.e2e.local'))
  const apiKey = env.BUDINGX_API_KEY
  const baseUrl = env.BUDINGX_BASE_URL ?? 'https://api.openai.com/v1'
  const model = env.BUDINGX_MODEL ?? 'gpt-4o-mini'
  if (!apiKey) {
    console.error('缺少 BUDINGX_API_KEY（.env.e2e.local）。live-image.mjs 是 opt-in 端到端，不进 npm test。')
    process.exitCode = 1
    return
  }

  process.env.FORCE_COLOR = '3'
  const { Session } = await import('../../src/tui/dist/core/session.js')
  const { createOpenAiProvider } = await import('../../src/tui/dist/provider/openai.js')
  const { ConfigStore } = await import('../../src/tui/dist/storage/config-store.js')
  const { CredentialStore } = await import('../../src/tui/dist/storage/credentials.js')
  const { InkApprovalGateway } = await import('../../src/tui/dist/tui/approval.js')
  const { render } = await import('ink')
  const { createElement } = await import('react')
  const { App } = await import('../../src/tui/dist/tui/app.js')

  const tmpRoot = mkdtempSync(join(tmpdir(), 'budingx-live-image-'))
  const imagePaths = imageOverrides.length > 0 ? imageOverrides : [join(tmpRoot, 'redblue.png')]
  if (imageOverrides.length === 0) writeFileSync(imagePaths[0], buildTestPng())
  for (const path of imagePaths) {
    if (!existsSync(path)) throw new Error('--image 指向的文件不存在：' + path)
  }

  const provider = createOpenAiProvider({ baseUrl, apiKey })
  const gateway = new InkApprovalGateway()
  const configStore = new ConfigStore(join(tmpRoot, 'config.json'))
  const credentialStore = new CredentialStore(join(tmpRoot, 'credentials.json'))
  let config = { baseUrl, model, apiKey, timeoutMs: 120000, source: 'env' }
  const session = new Session({
    provider,
    tools: [],
    approval: gateway,
    resolveSnapshot: () => ({
      modelId: 'live-image',
      model,
      baseUrlHost: new URL(baseUrl).host,
      capabilities: { tools: false }
    })
  })

  const stdin = new PassThrough()
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  const stdout = new PassThrough()
  stdout.columns = 120
  stdout.rows = 40
  stdout.isTTY = true

  let raw = ''
  const frames = []
  stdout.on('data', (chunk) => {
    raw += chunk
    const clean = stripVTControlCharacters(chunk.toString())
    if (clean.trim()) frames.push(clean)
  })

  const app = render(
    createElement(App, {
      session,
      gateway,
      version: '0.1.1',
      cwd: tmpRoot,
      fullScreen: false,
      commandContext: {
        configStore,
        credentialStore,
        getConfig: () => config,
        setConfig: (next) => {
          config = next
        },
        exit: () => {}
      },
      onExit: () => {}
    }),
    {
      stdin,
      stdout,
      stderr: stdout,
      interactive: true,
      alternateScreen: false,
      exitOnCtrlC: false,
      patchConsole: false
    }
  )
  const cleanup = () => {
    app.unmount()
    session.dispose()
    stdin.destroy()
    stdout.destroy()
    try {
      rmSync(tmpRoot, { recursive: true, force: true })
    } catch {}
  }

  try {
    await pause()
    await app.waitUntilRenderFlush()

    const prompt =
      mode === 'path'
        ? `请读取并描述这些图片：${imagePaths.join(' ')}  每张图左右两半分别是什么颜色？只回答颜色。`
        : '这张图片左右两半分别是什么颜色？只回答颜色。'
    if (mode !== 'path') {
      // clipboard = Windows 主键位 alt+v（MM-01，终端把 Alt+<key> 编码为 ESC 前缀）；
      // ctrlv = ctrl+v 无文本时的图片回退（多数用户的本能键位）。
      stdin.write(mode === 'clipboard' ? '\x1bv' : '\x16')
      await pause(200)
      await app.waitUntilRenderFlush()
      const attached = /\[Image #\d+\]/.test(stripVTControlCharacters(raw))
      console.log('剪贴板图片是否附件成功（[Image #N] 占位）:', attached ? '是' : '否')
      if (!attached) {
        console.log(stripVTControlCharacters(raw).slice(-1500))
        process.exitCode = 1
        return
      }
    }
    // 按终端分片写入，避免 Enter 与正文合并在同一次 keypress parse 中丢失。
    for (const piece of prompt.match(/[\x00-\x1f]|[^\x00-\x1f]+/g) ?? [prompt]) {
      stdin.write(piece)
      await pause(10)
    }
    stdin.write('\r')
    await pause(50)
    await app.waitUntilRenderFlush()

    const deadline = Date.now() + 150000
    let answer = ''
    while (Date.now() < deadline) {
      await app.waitUntilRenderFlush()
      const frame = stripVTControlCharacters(raw)
      if (frame.includes('红色') || frame.includes('红') || frame.includes('蓝色')) {
        answer = frame
        break
      }
      if (frame.includes('Request failed') || frame.includes('Error')) {
        answer = frame
        break
      }
      await pause(100)
    }
    await app.waitUntilRenderFlush()
    const finalFrame = stripVTControlCharacters(raw)

    console.log('===== 最终帧（尾部 4000 字符）=====')
    console.log(finalFrame.slice(-4000))
    console.log('===== 断言 =====')
    const sawRed = /红/.test(finalFrame)
    const sawBlue = /蓝/.test(finalFrame)
    console.log('模型回答包含「红」:', sawRed)
    console.log('模型回答包含「蓝」:', sawBlue)
    if (!sawRed || !sawBlue) {
      console.log('图片附件是否被输入区识别：', /\[Image #\d+\]/.test(finalFrame) ? '是' : '否')
      process.exitCode = 1
    } else {
      console.log('E2E PASS：TUI 输入区附件图片 → provider → 真实模型识别内容')
    }
  } finally {
    cleanup()
  }
}

main().catch((error) => {
  console.error('live-image 失败：', error)
  process.exitCode = 1
})