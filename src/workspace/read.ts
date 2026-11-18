// File reading (SP003 design §3.5, AC WT-01 … WT-03).
// Text is returned with line numbers. Binary content, unsupported encodings
// and oversized files are reported explicitly instead of being silently
// mangled. CRLF is normalised for display only; the file on disk is never
// rewritten by a read.
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { ERROR_CODES } from '../core/constants.js'
import { MAX_FILE_BYTES, MAX_READ_RANGE_BYTES, MAX_READ_LINES } from './constants.js'
import { WorkspaceError, type Workspace } from './paths.js'

export type ReadKind = 'text' | 'binary' | 'image'

export type ImageInfo = {
  mime: string
  width?: number
  height?: number
}

export type ReadResult = {
  kind: ReadKind
  /** Numbered content, one entry per returned line. */
  text: string
  totalLines: number
  returnedLines: number
  truncated: boolean
  truncatedReason?: 'size' | 'lines'
  bytes: number
  fingerprint?: string
  image?: ImageInfo
}

export type ReadOptions = {
  path: string
  offset?: number
  limit?: number
  maxBytes?: number
}

/** Only the leading bytes are needed to identify image format and size. */
function readHeader(file: string): Buffer {
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(64 * 1024)
    const read = readSync(fd, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, read)
  } finally {
    closeSync(fd)
  }
}

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
}

function looksBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 8000)
  for (let index = 0; index < limit; index++) {
    if (buffer[index] === 0) return true
  }
  return false
}

function detectUtf16(buffer: Buffer): boolean {
  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return true
    if (buffer[0] === 0xfe && buffer[1] === 0xff) return true
  }
  return false
}

function readPngSize(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.length < 24) return undefined
  if (buffer.readUInt32BE(0) !== 0x89504e47) return undefined
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function readGifSize(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.length < 10) return undefined
  if (buffer.toString('ascii', 0, 3) !== 'GIF') return undefined
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
}

function readJpegSize(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.length < 4) return undefined
  if (buffer.readUInt16BE(0) !== 0xffd8) return undefined
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++
      continue
    }
    const marker = buffer[offset + 1]
    const length = buffer.readUInt16BE(offset + 2)
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
    }
    offset += 2 + length
  }
  return undefined
}

function imageInfo(extension: string, buffer: Buffer): ImageInfo | undefined {
  const mime = IMAGE_TYPES[extension]
  if (!mime) return undefined
  const size =
    mime === 'image/png'
      ? readPngSize(buffer)
      : mime === 'image/gif'
        ? readGifSize(buffer)
        : mime === 'image/jpeg'
          ? readJpegSize(buffer)
          : undefined
  return size ? { mime, width: size.width, height: size.height } : { mime }
}

export function readWorkspaceFile(
  workspace: Workspace,
  options: ReadOptions
): ReadResult {
  const resolved = workspace.resolve(options.path)
  if (resolved.existed && resolved.isDirectory) {
    throw new WorkspaceError(
      ERROR_CODES.workspaceNotAFile,
      `Path is a directory: ${resolved.relative}`
    )
  }
  if (!resolved.existed) {
    throw new WorkspaceError(
      ERROR_CODES.workspaceNotFound,
      `File not found: ${resolved.relative}`
    )
  }
  const stats = statSync(resolved.real)
  const wholeFile = options.offset === undefined && options.limit === undefined
  const limitBytes = wholeFile
    ? (options.maxBytes ?? MAX_FILE_BYTES)
    : (options.maxBytes ?? MAX_READ_RANGE_BYTES)
  const extension = resolved.relative.slice(resolved.relative.lastIndexOf('.')).toLowerCase()

  if (IMAGE_TYPES[extension]) {
    return {
      kind: 'image',
      text: '',
      totalLines: 0,
      returnedLines: 0,
      truncated: false,
      bytes: stats.size,
      image: imageInfo(extension, readHeader(resolved.real))
    }
  }

  if (wholeFile && stats.size > limitBytes) {
    throw new WorkspaceError(
      ERROR_CODES.workspaceTooLarge,
      `File content (${stats.size} bytes) exceeds the maximum read size (${limitBytes} bytes). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.`
    )
  }

  const offset = Math.max(1, options.offset ?? 1)
  const limit = Math.max(1, options.limit ?? MAX_READ_LINES)
  const selected: string[] = []
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  const hash = createHash('sha256')
  const buffer = Buffer.alloc(64 * 1024)
  let totalLines = 1
  let bytes = 0
  let selectedBytes = 0
  let pendingLine = ''
  const isSelected = () => totalLines >= offset && totalLines - offset < limit
  const consume = (chunk: string): void => {
    const parts = chunk.split('\n')
    for (let index = 0; index < parts.length; index++) {
      const ended = index < parts.length - 1
      if (isSelected()) {
        selectedBytes += Buffer.byteLength(parts[index], 'utf8') + Number(ended)
        if (selectedBytes > limitBytes) {
          throw new WorkspaceError(
            ERROR_CODES.workspaceTooLarge,
            `Selected content exceeds the maximum read size (${limitBytes} bytes). Use a smaller range: ${resolved.relative}`
          )
        }
        pendingLine += parts[index]
        if (ended) {
          selected.push(pendingLine.replace(/\r$/, ''))
          pendingLine = ''
        }
      }
      if (ended) totalLines++
    }
  }
  const decode = (data: Uint8Array, stream: boolean): string => {
    try {
      return decoder.decode(data, { stream })
    } catch {
      throw new WorkspaceError(
        ERROR_CODES.workspaceEncodingUnsupported,
        `Unsupported encoding (invalid UTF-8): ${resolved.relative}`
      )
    }
  }

  const file = openSync(resolved.real, 'r')
  try {
    let length: number
    while ((length = readSync(file, buffer, 0, buffer.length, null)) > 0) {
      const data = buffer.subarray(0, length)
      if (bytes === 0 && detectUtf16(data)) {
        throw new WorkspaceError(
          ERROR_CODES.workspaceEncodingUnsupported,
          `Unsupported encoding (UTF-16): ${resolved.relative}`
        )
      }
      if (bytes === 0 && looksBinary(data)) {
        throw new WorkspaceError(
          ERROR_CODES.workspaceEncodingUnsupported,
          `Binary file cannot be read as text: ${resolved.relative}`
        )
      }
      bytes += length
      if (wholeFile && bytes > limitBytes) {
        throw new WorkspaceError(ERROR_CODES.workspaceTooLarge, 'File grew beyond the read limit; use offset and limit')
      }
      hash.update(data)
      consume(decode(data, true))
    }
    consume(decode(buffer.subarray(0, 0), false))
  } finally {
    closeSync(file)
  }

  if (offset > totalLines) {
    throw new WorkspaceError(
      ERROR_CODES.workspaceNotFound,
      `Line range out of bounds: offset ${offset} exceeds ${totalLines} lines`
    )
  }
  if (isSelected()) selected.push(pendingLine)
  const end = Math.min(totalLines, offset - 1 + limit)
  const truncated = end < totalLines
  const width = String(end).length
  const numbered = selected.map(
    (line, index) => `${String(offset + index).padStart(width, ' ')}→${line}`
  )
  const notice = truncated ? `\n[truncated: showing lines ${offset}-${end} of ${totalLines}]` : ''
  return {
    kind: 'text',
    text: numbered.join('\n') + notice,
    totalLines,
    returnedLines: selected.length,
    truncated,
    ...(truncated ? { truncatedReason: 'lines' } : {}),
    bytes,
    fingerprint: hash.digest('hex')
  }
}
