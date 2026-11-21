// SP007 T8 — PNG 纯 JS 解码/缩放/编码（design §4.4，AC MM-04）。
// 不引入 sharp/native 依赖（D2）：node:zlib inflate/deflate＋IHDR/IDAT 解析＋
// unfilter（None/Sub/Up/Average/Paeth）＋双线性降采样＋filter0 重编码。
// 仅支持 8-bit RGB(colorType2)/RGBA(colorType6) 非隔行；调色板/16-bit/隔行/灰度明确拒绝。
import { inflateSync, deflateSync } from 'node:zlib'

/** base64 上限 5MB（API_IMAGE_MAX_BASE64_SIZE 等价）。 */
export const IMAGE_MAX_BASE64_BYTES = 5 * 1024 * 1024
/** 编码后 PNG 文件字节目标 3.75MB（×4/3≈5MB base64）。 */
export const IMAGE_TARGET_RAW_BYTES = Math.floor(3.75 * 1024 * 1024)
/** 单边硬上限 8000px。 */
export const IMAGE_MAX_DIMENSION = 8000
/** 级联降采样阶梯：硬缩 8000 → 软缩 2048 → 可读 1568。 */
const CASCADE = [8000, 2048, 1568]

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)
}

type PngChunk = { type: string; data: Buffer }

function readChunks(buffer: Buffer): PngChunk[] {
  if (!isPng(buffer)) throw new Error('不是有效的 PNG 文件')
  const chunks: PngChunk[] = []
  let offset = 8
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    chunks.push({ type, data })
    offset += 12 + length
    if (type === 'IEND') break
  }
  return chunks
}

function readIhdr(buffer: Buffer): { width: number; height: number; bitDepth: number; colorType: number; interlace: number } {
  const chunks = readChunks(buffer)
  const ihdr = chunks.find((c) => c.type === 'IHDR')
  if (!ihdr || ihdr.data.length < 13) throw new Error('PNG 缺少 IHDR')
  return {
    width: ihdr.data.readUInt32BE(0),
    height: ihdr.data.readUInt32BE(4),
    bitDepth: ihdr.data[8],
    colorType: ihdr.data[9],
    interlace: ihdr.data[12]
  }
}

/** 仅读尺寸（PNG）；非 PNG 返回 undefined。 */
export function imageDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  if (!isPng(buffer)) return undefined
  try {
    const { width, height } = readIhdr(buffer)
    return { width, height }
  } catch {
    return undefined
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export type PngImage = { width: number; height: number; rgba: Buffer }

/** 解码 PNG 为 RGBA8。不支持的格式明确抛错（不静默降级）。 */
export function decodePng(buffer: Buffer): PngImage {
  const { width, height, bitDepth, colorType, interlace } = readIhdr(buffer)
  if (interlace !== 0) throw new Error('不支持隔行（interlaced）PNG，请另存为非隔行后重试')
  if (bitDepth !== 8) throw new Error('不支持 ' + bitDepth + '-bit 位深 PNG（仅 8-bit），请转换后重试')
  if (colorType === 3) throw new Error('不支持调色板（palette）PNG，请转换为 RGB/RGBA 后重试')
  if (colorType === 0 || colorType === 4) throw new Error('不支持灰度（grayscale）PNG，请转换为 RGB/RGBA 后重试')
  if (colorType !== 2 && colorType !== 6) throw new Error('不支持的 PNG colorType ' + colorType)
  if (width === 0 || height === 0) throw new Error('PNG 尺寸为零')
  const channels = colorType === 6 ? 4 : 3
  const bpp = channels
  const stride = width * bpp
  const chunks = readChunks(buffer)
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data))
  if (idat.length === 0) throw new Error('PNG 缺少 IDAT')
  const raw = inflateSync(idat)
  if (raw.length < (stride + 1) * height) throw new Error('PNG 像素数据不完整')
  // unfilter 逐行还原
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const rowStart = y * (stride + 1) + 1
    const outStart = y * stride
    for (let i = 0; i < stride; i++) {
      const x = raw[rowStart + i]
      const a = i >= bpp ? pixels[outStart + i - bpp] : 0
      const b = y > 0 ? pixels[outStart - stride + i] : 0
      const c = y > 0 && i >= bpp ? pixels[outStart - stride + i - bpp] : 0
      let v: number
      if (filter === 0) v = x
      else if (filter === 1) v = x + a
      else if (filter === 2) v = x + b
      else if (filter === 3) v = x + Math.floor((a + b) / 2)
      else if (filter === 4) v = x + paeth(a, b, c)
      else throw new Error('未知 PNG 滤波类型 ' + filter)
      pixels[outStart + i] = v & 0xff
    }
  }
  // 扩为 RGBA8
  if (colorType === 6) return { width, height, rgba: pixels }
  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = pixels[i * 3]
    rgba[i * 4 + 1] = pixels[i * 3 + 1]
    rgba[i * 4 + 2] = pixels[i * 3 + 2]
    rgba[i * 4 + 3] = 255
  }
  return { width, height, rgba }
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/** 编码 RGBA8 为 PNG（colorType6，filter0）。 */
export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const stride = width * 4
  const filtered = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0
    rgba.copy(filtered, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const idat = deflateSync(filtered, { level: 9 })
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

/** 双线性降采样 RGBA8。 */
export function resizeRgba(rgba: Buffer, sw: number, sh: number, dw: number, dh: number): Buffer {
  const out = Buffer.alloc(dw * dh * 4)
  const xRatio = sw / dw
  const yRatio = sh / dh
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, (y + 0.5) * yRatio - 0.5)
    const y0 = Math.max(0, Math.floor(sy))
    const y1 = Math.min(sh - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, (x + 0.5) * xRatio - 0.5)
      const x0 = Math.max(0, Math.floor(sx))
      const x1 = Math.min(sw - 1, x0 + 1)
      const fx = sx - x0
      const i00 = (y0 * sw + x0) * 4
      const i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4
      const oi = (y * dw + x) * 4
      for (let c = 0; c < 4; c++) {
        const top = rgba[i00 + c] * (1 - fx) + rgba[i10 + c] * fx
        const bottom = rgba[i01 + c] * (1 - fx) + rgba[i11 + c] * fx
        out[oi + c] = Math.round(top * (1 - fy) + bottom * fy)
      }
    }
  }
  return out
}

export type PreparedImage = {
  data: string
  mediaType: string
  width?: number
  height?: number
  resized: boolean
}

function scaledDims(width: number, height: number, limit: number): { width: number; height: number } {
  const max = Math.max(width, height)
  if (max <= limit) return { width, height }
  const scale = limit / max
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * 准备图片附件：PNG 超限时纯 JS 级联缩放；非 PNG 超限明确拒绝（D2）。
 * 小图原样通过。返回 base64 与尺寸。
 */
export function prepareImage(buffer: Buffer, mediaType: string): PreparedImage {
  const base64 = buffer.toString('base64')
  if (mediaType !== 'image/png') {
    if (base64.length > IMAGE_MAX_BASE64_BYTES) {
      throw new Error('非 PNG 图片超过 5MB 上限，请缩小后重试（本版本仅 PNG 支持自动缩放）')
    }
    return { data: base64, mediaType, resized: false }
  }
  const decoded = decodePng(buffer)
  const withinBase64 = base64.length <= IMAGE_MAX_BASE64_BYTES
  const withinRaw = buffer.length <= IMAGE_TARGET_RAW_BYTES
  const withinDim = decoded.width <= IMAGE_MAX_DIMENSION && decoded.height <= IMAGE_MAX_DIMENSION
  if (withinBase64 && withinRaw && withinDim) {
    return { data: base64, mediaType: 'image/png', width: decoded.width, height: decoded.height, resized: false }
  }
  let { width, height } = decoded
  let rgba = decoded.rgba
  for (const limit of CASCADE) {
    const target = scaledDims(width, height, limit)
    if (target.width !== width || target.height !== height) {
      rgba = resizeRgba(rgba, width, height, target.width, target.height)
      width = target.width
      height = target.height
    }
    const encoded = encodePng(width, height, rgba)
    if (encoded.length <= IMAGE_TARGET_RAW_BYTES && encoded.toString('base64').length <= IMAGE_MAX_BASE64_BYTES) {
      return { data: encoded.toString('base64'), mediaType: 'image/png', width, height, resized: true }
    }
  }
  throw new Error('PNG 图片过大，缩放后仍超过 5MB 上限，请裁剪后重试')
}
