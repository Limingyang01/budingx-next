export interface FrameBuffer {
  width: number
  height: number
  lines: string[]
  version: number
}

export interface FrameDiff {
  lines: string[]
  indexes: number[]
  reflow: boolean
}

export function createFrameBuffer(width: number, height: number, lines: string[] = []): FrameBuffer {
  const safeWidth = Math.max(0, Math.floor(width))
  const safeHeight = Math.max(0, Math.floor(height))
  const normalized = lines.slice(0, safeHeight).map((line) => String(line ?? ''))
  while (normalized.length < safeHeight) normalized.push('')
  return { width: safeWidth, height: safeHeight, lines: normalized, version: 1 }
}

export function resizeFrameBuffer(
  buffer: FrameBuffer,
  width: number,
  height: number,
  lines: string[] = buffer.lines,
): FrameBuffer {
  const next = createFrameBuffer(width, height, lines)
  return { ...next, version: buffer.version + 1 }
}

/** 行级差分：宽度变化 = 全量重写（reflow），否则只返回变化行。 */
export function diffFrameLines(prev: FrameBuffer | null, next: FrameBuffer): FrameDiff {
  if (!prev) {
    return { lines: [...next.lines], indexes: next.lines.map((_, index) => index), reflow: true }
  }
  const reflow = prev.width !== next.width || prev.height !== next.height
  if (reflow) {
    return { lines: [...next.lines], indexes: next.lines.map((_, index) => index), reflow: true }
  }
  const indexes: number[] = []
  const lines: string[] = []
  const length = Math.max(prev.lines.length, next.lines.length)
  for (let index = 0; index < length; index += 1) {
    const before = prev.lines[index] ?? ''
    const after = next.lines[index] ?? ''
    if (before !== after) {
      indexes.push(index)
      lines.push(after)
    }
  }
  return { lines, indexes, reflow: false }
}

export function diffFrames(prev: FrameBuffer | null, next: FrameBuffer): string[] {
  return diffFrameLines(prev, next).lines
}
