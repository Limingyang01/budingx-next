// SP007 T8 — PNG 纯 JS 缩放 / 剪贴板路径识别 / image-cache / 键位平台分支。
// RED→GREEN：先证明模块缺口，再实现。fixture 用独立 PNG 构造器（不依赖被测 encode）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { mkdtempSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  decodePng, encodePng, resizeRgba, prepareImage, isPng, imageDimensions,
  IMAGE_MAX_BASE64_BYTES, IMAGE_TARGET_RAW_BYTES, IMAGE_MAX_DIMENSION
} from '../../tui/dist/tui/image-resize.js'
import { createImageCache } from '../../tui/dist/storage/image-cache.js'
import { extractImagePaths, stripImageTokens } from '../../tui/dist/tui/image-paste.js'
import { DEFAULT_BINDINGS, NON_REBINDABLE, IMAGE_PASTE_KEY } from '../../tui/dist/tui/keybindings/defaults.js'

// ---- 独立 PNG fixture 构造器 ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}
function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}
// 构造一个 PNG：rgba 为原始 RGBA8 像素；filter 为每行滤波类型（0-4）。
function makePng({ width, height, colorType = 6, bitDepth = 8, interlace = 0, filter = 0, rgba }) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = bitDepth; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = interlace
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1
  const bpp = channels * (bitDepth / 8)
  const stride = width * bpp
  // 源像素行（按 colorType 从 rgba 取样）
  const rows = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(stride)
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4
      if (colorType === 6) { row[x * 4] = rgba[si]; row[x * 4 + 1] = rgba[si + 1]; row[x * 4 + 2] = rgba[si + 2]; row[x * 4 + 3] = rgba[si + 3] }
      else if (colorType === 2) { row[x * 3] = rgba[si]; row[x * 3 + 1] = rgba[si + 1]; row[x * 3 + 2] = rgba[si + 2] }
      else { row[x] = rgba[si] }
    }
    rows.push(row)
  }
  const filtered = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = filter
    const cur = rows[y], prev = y > 0 ? rows[y - 1] : null
    for (let i = 0; i < stride; i++) {
      const x = cur[i]
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= bpp ? prev[i - bpp] : 0
      let v
      if (filter === 0) v = x
      else if (filter === 1) v = x - a
      else if (filter === 2) v = x - b
      else if (filter === 3) v = x - Math.floor((a + b) / 2)
      else v = x - paeth(a, b, c)
      filtered[y * (stride + 1) + 1 + i] = v & 0xff
    }
  }
  const idat = deflateSync(filtered)
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}
function solidRgba(w, h, r, g, b, a = 255) {
  const buf = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) { buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = a }
  return buf
}
function gradientRgba(w, h) {
  const buf = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    buf[i] = (x * 255 / Math.max(1, w - 1)) | 0
    buf[i + 1] = (y * 255 / Math.max(1, h - 1)) | 0
    buf[i + 2] = ((x + y) * 255 / Math.max(1, w + h - 2)) | 0
    buf[i + 3] = 255
  }
  return buf
}

test('MM-04：decodePng 还原 RGBA8（filter 0-4 往返）', () => {
  const w = 6, h = 5
  const rgba = gradientRgba(w, h)
  for (const filter of [0, 1, 2, 3, 4]) {
    const png = makePng({ width: w, height: h, filter, rgba })
    const dec = decodePng(png)
    assert.equal(dec.width, w)
    assert.equal(dec.height, h)
    assert.deepEqual(dec.rgba, rgba, 'filter ' + filter)
  }
})

test('MM-04：decodePng 支持 RGB(colorType2) 扩为 RGBA', () => {
  const w = 4, h = 3
  const rgba = solidRgba(w, h, 10, 20, 30, 255)
  const png = makePng({ width: w, height: h, colorType: 2, rgba })
  const dec = decodePng(png)
  assert.deepEqual(dec.rgba, rgba)
})

test('MM-04：调色板/16-bit/隔行/灰度 → 明确拒绝', () => {
  const rgba = solidRgba(2, 2, 1, 2, 3)
  assert.throws(() => decodePng(makePng({ width: 2, height: 2, colorType: 3, rgba })), /调色板|palette|不支持/)
  assert.throws(() => decodePng(makePng({ width: 2, height: 2, bitDepth: 16, rgba })), /16|位深|不支持/)
  assert.throws(() => decodePng(makePng({ width: 2, height: 2, interlace: 1, rgba })), /隔行|interlace|不支持/)
  assert.throws(() => decodePng(makePng({ width: 2, height: 2, colorType: 0, rgba })), /灰度|grayscale|不支持/)
})

test('MM-04：encodePng→decodePng 往返一致', () => {
  const w = 9, h = 7
  const rgba = gradientRgba(w, h)
  const enc = encodePng(w, h, rgba)
  assert.ok(isPng(enc))
  const dec = decodePng(enc)
  assert.equal(dec.width, w); assert.equal(dec.height, h)
  assert.deepEqual(dec.rgba, rgba)
})

test('MM-04：resizeRgba 双线性降采样尺寸正确', () => {
  const rgba = gradientRgba(100, 80)
  const out = resizeRgba(rgba, 100, 80, 25, 20)
  assert.equal(out.length, 25 * 20 * 4)
  // 角落像素近似保持
  assert.ok(Math.abs(out[0] - rgba[0]) <= 8)
})

test('MM-04：小 PNG 原样通过（不缩放）', () => {
  const rgba = solidRgba(40, 30, 200, 100, 50)
  const png = makePng({ width: 40, height: 30, rgba })
  const prep = prepareImage(png, 'image/png')
  assert.equal(prep.resized, false)
  assert.equal(prep.width, 40); assert.equal(prep.height, 30)
  assert.equal(prep.mediaType, 'image/png')
  assert.equal(prep.data, png.toString('base64'))
})

test('MM-04：超 8000px PNG 触发级联缩放，结果≤上限', () => {
  // 9000x2 细长图：原始 base64 可能不大但尺寸超限 → 必须缩到≤8000
  const w = 9000, h = 2
  const rgba = gradientRgba(w, h)
  const png = makePng({ width: w, height: h, rgba })
  const prep = prepareImage(png, 'image/png')
  assert.equal(prep.resized, true)
  assert.ok(prep.width <= IMAGE_MAX_DIMENSION, 'width ' + prep.width)
  assert.ok(prep.data.length <= IMAGE_MAX_BASE64_BYTES)
  const dec = decodePng(Buffer.from(prep.data, 'base64'))
  assert.equal(dec.width, prep.width)
})

test('MM-04：大噪声 PNG（base64>5MB）级联缩到≤5MB', () => {
  // 构造高熵图使 deflate 后仍较大：2048x2048 随机像素
  const w = 2048, h = 2048
  const rgba = Buffer.alloc(w * h * 4)
  let seed = 12345
  for (let i = 0; i < rgba.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; rgba[i] = seed & 0xff }
  const png = makePng({ width: w, height: h, rgba })
  if (png.toString('base64').length <= IMAGE_MAX_BASE64_BYTES) {
    // 若压缩后仍小，则跳过该断言场景（环境压缩率高）
    return
  }
  const prep = prepareImage(png, 'image/png')
  assert.equal(prep.resized, true)
  assert.ok(prep.data.length <= IMAGE_MAX_BASE64_BYTES, 'base64 ' + prep.data.length)
  assert.ok(Buffer.from(prep.data, 'base64').length <= IMAGE_TARGET_RAW_BYTES)
})

// BUG：MM-04 曾对任何 PNG 无条件 decodePng，导致调色板/灰度/16-bit/隔行等
// 「无法缩放但完全合法」的小 PNG 被拒绝附件。未超限时必须原样附件。
test('MM-04/MM-10：调色板/灰度/16-bit/隔行 PNG 未超限时原样附件（不因无法缩放而拒绝）', () => {
  const variants = [
    { colorType: 3 },
    { colorType: 0 },
    { colorType: 2, bitDepth: 16 },
    { colorType: 6, interlace: 1 }
  ]
  for (const variant of variants) {
    const png = makePng({ width: 8, height: 6, rgba: solidRgba(8, 6, 9, 8, 7), ...variant })
    const prep = prepareImage(png, 'image/png')
    assert.equal(prep.resized, false, JSON.stringify(variant))
    assert.equal(prep.mediaType, 'image/png')
    assert.equal(prep.data, png.toString('base64'), JSON.stringify(variant))
    assert.equal(prep.width, 8)
    assert.equal(prep.height, 6)
  }
})

test('MM-04/MM-10：无法自动缩放的 PNG 变体超限 → 明确拒绝并提示转换', () => {
  // 9000px 宽调色板 PNG：尺寸超限且无法缩放，必须明确拒绝（不是静默失败）
  const png = makePng({ width: 9000, height: 1, colorType: 3, rgba: solidRgba(9000, 1, 1, 2, 3) })
  assert.throws(() => prepareImage(png, 'image/png'), /调色板|palette|转换/)
})

test('MM-04：损坏 PNG（无 IHDR）→ 明确拒绝而不是静默直通', () => {
  const broken = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(24, 0)])
  assert.throws(() => prepareImage(broken, 'image/png'), /PNG|IHDR|有效/)
})

test('MM-04/MM-10：非 PNG 超 5MB → 明确拒绝；非 PNG 小图原样', () => {
  const big = Buffer.alloc(6 * 1024 * 1024, 7)
  assert.throws(() => prepareImage(big, 'image/jpeg'), /PNG|缩小|5MB|上限/)
  const small = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
  const prep = prepareImage(small, 'image/jpeg')
  assert.equal(prep.resized, false)
  assert.equal(prep.mediaType, 'image/jpeg')
  assert.equal(prep.data, small.toString('base64'))
})

test('MM-04：isPng / imageDimensions', () => {
  const png = makePng({ width: 12, height: 8, rgba: solidRgba(12, 8, 0, 0, 0) })
  assert.equal(isPng(png), true)
  assert.equal(isPng(Buffer.from([0xff, 0xd8])), false)
  assert.deepEqual(imageDimensions(png), { width: 12, height: 8 })
  assert.equal(imageDimensions(Buffer.from([0xff, 0xd8])), undefined)
})

test('MM-03：extractImagePaths 识别引号/反斜杠转义路径', () => {
  const found = extractImagePaths('看 "C:\\shots\\a.png" 和 D:/pics/b.JPG 还有 c.webp 以及 note.txt')
  const paths = found.map((f) => f.path)
  assert.ok(paths.includes('C:\\shots\\a.png'), JSON.stringify(paths))
  assert.ok(paths.includes('D:/pics/b.JPG'))
  // 裸文件名且磁盘不存在 → 当普通文本，不阻塞发送（真实文件由下一条用例覆盖）。
  assert.ok(!paths.includes('c.webp'))
  assert.ok(!paths.some((p) => p.endsWith('.txt')))
})

test('MM-03：中文紧贴图片路径可识别，说明文字不被吞掉', () => {
  const dir = mkdtempSync(join(tmpdir(), 'budingx-imgpath-'))
  const real = join(dir, 'redblue.png')
  writeFileSync(real, makePng({ width: 2, height: 2, rgba: solidRgba(2, 2, 255, 0, 0) }))
  // 1) 中文冒号直接接路径（无空格）——SP007 实测缺陷：旧实现把整句当路径→ENOENT 阻塞发送。
  const glued = '请读取并描述这张图片：' + real + ' 它左右两半分别是什么颜色？'
  const found = extractImagePaths(glued)
  assert.equal(found.length, 1, JSON.stringify(found))
  assert.equal(found[0].path, real)
  const stripped = glued.replace(found[0].token, '[Image #1]')
  assert.ok(stripped.startsWith('请读取并描述这张图片：[Image #1]'), stripped)
  // 2) 前后都有中文紧贴
  const wrapped = '前面中文' + real + '后面中文'
  const inner = extractImagePaths(wrapped)
  assert.equal(inner.length, 1, JSON.stringify(inner))
  assert.equal(inner[0].path, real)
  assert.equal(wrapped.replace(inner[0].token, '[Image #1]'), '前面中文[Image #1]后面中文')
  // 3) 引号包裹的中文说明 + 路径
  const quoted = '看这个图："' + real + '"'
  const q = extractImagePaths(quoted)
  assert.equal(q.length, 1, JSON.stringify(q))
  assert.equal(q[0].path, real)
  // 4) URL 结尾 .png 不当作本地附件
  assert.deepEqual(extractImagePaths('见 https://example.com/a.png 说明'), [])
  // 5) 多个图片按出现顺序
  const second = join(dir, 'two.webp')
  writeFileSync(second, Buffer.from([1, 2, 3]))
  const many = extractImagePaths('第一张 ' + real + ' 第二张 ' + second)
  assert.deepEqual(many.map((m) => m.path), [real, second])
})

test('MM-03：stripImageTokens 从文本移除已附件 token', () => {
  const text = '分析 "C:\\a.png" 这张图'
  const out = stripImageTokens(text, ['C:\\a.png'])
  assert.ok(!out.includes('a.png'))
  assert.ok(out.includes('分析'))
})

test('MM-06：image-cache 落盘＋file:// url＋200 淘汰＋私有目录', () => {
  const home = mkdtempSync(join(tmpdir(), 'budingx-imgcache-'))
  const cache = createImageCache({ sessionId: 'sess-1', home, maxEntries: 200 })
  const data = Buffer.from([1, 2, 3, 4])
  const entry = cache.put(1, 'image/png', data)
  assert.ok(existsSync(entry.path))
  assert.deepEqual(readFileSync(entry.path), data)
  assert.ok(entry.url.startsWith('file://'))
  assert.ok(entry.path.endsWith('1.png'))
  // 私有目录权限（POSIX 0o700；Windows ACL 尽力而为）
  if (process.platform !== 'win32') {
    const mode = statSync(cache.directory).mode & 0o777
    assert.equal(mode, 0o700)
  }
  // 淘汰：插入 201 个 → size 恒≤200，最旧 id 1 被逐出内存
  for (let i = 2; i <= 201; i++) cache.put(i, 'image/png', data)
  assert.ok(cache.size <= 200)
  assert.equal(cache.get(1), undefined)
  assert.ok(cache.get(201))
})

test('MM-01：键位平台分支 chat:imagePaste＋保留键校验＋ctrl+b agent.background', () => {
  const expected = process.platform === 'win32' ? 'alt+v' : 'ctrl+v'
  assert.equal(IMAGE_PASTE_KEY, expected)
  const paste = DEFAULT_BINDINGS.find((b) => b.action === 'chat:imagePaste')
  assert.ok(paste, 'imagePaste binding exists')
  assert.equal(paste.context, 'chat')
  assert.equal(paste.key, expected)
  assert.ok(!NON_REBINDABLE.includes(paste.key))
  const bg = DEFAULT_BINDINGS.find((b) => b.action === 'agent.background')
  assert.ok(bg, 'agent.background binding exists')
  assert.equal(bg.key, 'ctrl+b')
  assert.equal(bg.context, 'chat')
})
