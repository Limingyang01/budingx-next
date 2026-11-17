// File reading (SP003 design §3.5, AC WT-01 … WT-03).
// Text is returned with line numbers. Binary content, unsupported encodings
// and oversized files are reported explicitly instead of being silently
// mangled. CRLF is normalised for display only; the file on disk is never
// rewritten by a read.
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { ERROR_CODES } from '../core/constants.js'
import { MAX_FILE_BYTES, MAX_READ_LINES } from './constants.js'
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
  image?: ImageInfo
}

export type ReadOptions = {
  path: string
  offset?: number
  limit?: number
  maxBytes?: number
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
  const maxBytes = options.maxBytes ?? MAX_FILE_BYTES
  const extension = resolved.relative.slice(resolved.relative.lastIndexOf('.')).toLowerCase()

  let buffer: Buffer
  let oversized = false
  if (stats.size > maxBytes && !IMAGE_TYPES[extension]) {
    // Read only the head; counting lines of the whole file would defeat
    // the limit we are enforcing.
    const fd = openSync(resolved.real, 'r')
    try {
      buffer = Buffer.alloc(maxBytes)
      readSync(fd, buffer, 0, maxBytes, 0)
    } finally {
      closeSync(fd)
    }
    oversized = true
  } else {
    buffer = readFileSync(resolved.real)
  }
  const bytes = stats.size

  if (IMAGE_TYPES[extension]) {
    return {
      kind: 'image',
      text: '',
      totalLines: 0,
      returnedLines: 0,
      truncated: false,
      bytes,
      image: imageInfo(extension, buffer)
    }
  }

  if (detectUtf16(buffer)) {
    throw new WorkspaceError(
      ERROR_CODES.workspaceEncodingUnsupported,
      `Unsupported encoding (UTF-16): ${resolved.relative}`
    )
  }
  if (looksBinary(buffer)) {
    throw new WorkspaceError(
      ERROR_CODES.workspaceEncodingUnsupported,
      `Binary file cannot be read as text: ${resolved.relative}`
    )
  }

  const decoded = buffer.toString('utf8')
  if (decoded.includes('�') && !oversized) {
    throw new WorkspaceError(
      ERROR_CODES.workspaceEncodingUnsupported,
      `Unsupported encoding (invalid UTF-8): ${resolved.relative}`
    )
  }

  const normalized = decoded.replace(/\r\n/g, '\n')
  const allLines = normalized.split('\n')
  const totalLines = allLines.length

  const offset = Math.max(1, options.offset ?? 1)
  if (!oversized && offset > totalLines && totalLines > 0) {
    throw new WorkspaceError(
      ERROR_CODES.workspaceNotFound,
      `Line range out of bounds: offset ${offset} exceeds ${totalLines} lines`
    )
  }
  const limit = Math.max(1, options.limit ?? MAX_READ_LINES)
  const end = Math.min(totalLines, offset - 1 + limit)
  const selected = allLines.slice(offset - 1, end)
  const truncated = oversized || end < totalLines
  const truncatedReason: 'size' | 'lines' | undefined = oversized
    ? 'size'
    : end < totalLines
      ? 'lines'
      : undefined

  const width = String(end).length
  const numbered = selected.map(
    (line, index) => `${String(offset + index).padStart(width, ' ')}→${line}`
  )
  const notice = truncated
    ? oversized
      ? `\n[truncated: file is ${bytes} bytes, showing the first ${maxBytes} bytes]`
      : `\n[truncated: showing lines ${offset}-${end} of ${totalLines}]`
    : ''

  return {
    kind: 'text',
    text: numbered.join('\n') + notice,
    totalLines,
    returnedLines: selected.length,
    truncated,
    ...(truncatedReason ? { truncatedReason } : {}),
    bytes
  }
}
