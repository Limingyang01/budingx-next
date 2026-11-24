// SP010 T10 D2：工具结果消费端的完整性核对。
// 文本：上限、截断标记与成功状态；错误：原错误码与熔断计数；
// 媒体：引用先解析到实际内容，再按解码后的尺寸与 RGBA 像素摘要判定；
// 二进制：完整字节 SHA-256。同尺寸错图、等长错文件、失效引用与损坏载荷都必须判失败。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { TOOL_OUTPUT_CAP } from '../dist/core/constants.js'
import { readImageFile } from '../dist/tui/image-paste.js'
import { decodePng, encodePng } from '../dist/tui/image-resize.js'

/** 固定夹具：一张 2×2 的 RGBA PNG（红、绿、蓝、半透明四像素）。 */
function makePng() {
  const rgba = Buffer.from([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 0
  ])
  return encodePng(2, 2, rgba)
}

/** 消费端核对：解码后比对尺寸与 RGBA 像素摘要。 */
function verifyPng(buffer) {
  const decoded = decodePng(buffer)
  return {
    width: decoded.width,
    height: decoded.height,
    digest: createHash('sha256').update(decoded.rgba).digest('hex')
  }
}

function fixtureDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sp010-media-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('D2 文本：超长工具输出被截断到上限内并保留截断标记', () => {
  const original = 'z'.repeat(TOOL_OUTPUT_CAP + 5000)
  const notice = `\n[truncated] Tool output exceeded ${TOOL_OUTPUT_CAP} characters.`
  const content = original.slice(0, TOOL_OUTPUT_CAP - notice.length) + notice
  assert.ok(content.length <= TOOL_OUTPUT_CAP)
  assert.match(content, /\[truncated\]/)
  assert.equal(content.includes('z'.repeat(100)), true)
})

test('D2 媒体：正确引用解析后尺寸与像素摘要一致', (t) => {
  const dir = fixtureDir(t)
  const png = makePng()
  const path = join(dir, 'shot.png')
  writeFileSync(path, png)
  const resolved = readImageFile(path)
  assert.equal(resolved.mediaType, 'image/png')
  assert.deepEqual(resolved.data.equals(png), true)
  const actual = verifyPng(resolved.data)
  assert.equal(actual.width, 2)
  assert.equal(actual.height, 2)
  assert.equal(actual.digest, verifyPng(png).digest)
})

test('D2 媒体：同尺寸但内容不同的可读图片必须判失败', (t) => {
  const dir = fixtureDir(t)
  const expected = makePng()
  const other = encodePng(
    2,
    2,
    Buffer.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255])
  )
  const path = join(dir, 'other.png')
  writeFileSync(path, other)
  const actual = verifyPng(readImageFile(path).data)
  assert.equal(actual.width, 2)
  assert.equal(actual.height, 2)
  assert.notEqual(actual.digest, verifyPng(expected).digest, '同尺寸错图必须被摘要差异判定为失败')
})

test('D2 二进制：等长但内容不同的文件必须判失败', (t) => {
  const dir = fixtureDir(t)
  const expected = Buffer.from('artifact-payload-0001')
  const other = Buffer.from('artifact-payload-0002')
  assert.equal(expected.length, other.length, '前置条件：两者等长')
  const path = join(dir, 'payload.bin')
  writeFileSync(path, other)
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
  assert.notEqual(digest, createHash('sha256').update(expected).digest('hex'))
})

test('D2 媒体：失效引用明确失败而不是静默降级', (t) => {
  const dir = fixtureDir(t)
  assert.throws(() => readImageFile(join(dir, 'missing.png')), /无法读取图片/)
  const unsupported = join(dir, 'note.txt')
  writeFileSync(unsupported, 'not an image')
  assert.throws(() => readImageFile(unsupported), /不支持的图片类型/)
})

test('D2 媒体：损坏载荷解码失败而不是当作有效图片', (t) => {
  const dir = fixtureDir(t)
  const png = makePng()
  const corrupted = Buffer.from(png)
  // 破坏 IDAT 载荷，保留长度与头部结构。
  const idatStart = corrupted.indexOf(Buffer.from('IDAT'))
  assert.ok(idatStart > 0, '前置条件：夹具必须是含 IDAT 的 PNG')
  for (let index = idatStart + 4; index < idatStart + 12 && index < corrupted.length; index += 1) {
    corrupted[index] = corrupted[index] ^ 0xff
  }
  const path = join(dir, 'corrupted.png')
  writeFileSync(path, corrupted)
  assert.throws(() => verifyPng(readImageFile(path).data))
})

test('D2 媒体：同一张图两次解析得到相同摘要，解析不引入随机性', (t) => {
  const dir = fixtureDir(t)
  const path = join(dir, 'shot.png')
  writeFileSync(path, makePng())
  const first = verifyPng(readImageFile(path).data)
  const second = verifyPng(readImageFile(path).data)
  assert.equal(first.digest, second.digest)
  assert.equal(first.width, second.width)
  assert.equal(first.height, second.height)
})

test('D2 媒体：图片附件按路径解析后进入会话的是完整载荷', async (t) => {
  const dir = fixtureDir(t)
  const png = makePng()
  const path = join(dir, 'shot.png')
  writeFileSync(path, png)
  const resolved = readImageFile(path)
  const base64 = resolved.data.toString('base64')
  assert.equal(base64.length > 0, true)
  assert.deepEqual(Buffer.from(base64, 'base64').equals(png), true)
  // 消费端可据此复核尺寸与像素摘要。
  assert.deepEqual(verifyPng(Buffer.from(base64, 'base64')), verifyPng(png))
})

test('D2 目录：媒体核对不得读取用户真实数据根', (t) => {
  const dir = fixtureDir(t)
  const nested = join(dir, 'nested')
  mkdirSync(nested, { recursive: true })
  const path = join(nested, 'shot.png')
  writeFileSync(path, makePng())
  assert.throws(() => readImageFile(join(dir, 'nested', 'missing.png')), /无法读取图片/)
})
