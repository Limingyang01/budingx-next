// SP004 T3 · 命令输出收集与截断（design §4.3）。
// stdout/stderr 分别按上限截断（保留首尾），合并文本再截断到同一上限；
// 截断标注固定为 `\n… [输出已截断：显示 N 字节 / 共 M 字节]`。

/** 在固定缓冲中保留首尾且计数所有字节。原始块直接交给输出文件。 */
export class OutputCollector {
  private readonly head: Buffer
  private readonly tail: Buffer
  private headBytes = 0
  private tailBytes = 0
  private total = 0

  constructor(private readonly retainCap: number) {
    this.head = Buffer.alloc(retainCap)
    this.tail = Buffer.alloc(retainCap)
  }

  push(chunk: Buffer): void {
    this.total += chunk.length
    const headSize = Math.min(this.retainCap - this.headBytes, chunk.length)
    if (headSize > 0) {
      chunk.copy(this.head, this.headBytes, 0, headSize)
      this.headBytes += headSize
    }
    const start = Math.max(0, chunk.length - this.retainCap)
    const tailSize = chunk.length - start
    const discard = Math.max(0, this.tailBytes + tailSize - this.retainCap)
    if (discard > 0) this.tail.copyWithin(0, discard, this.tailBytes)
    this.tailBytes -= discard
    chunk.copy(this.tail, this.tailBytes, start)
    this.tailBytes += tailSize
  }

  get bytes(): number {
    return this.total
  }

  /** 返回保留文本（未加截断标注）、是否截断与原始总字节数。 */
  snapshot(cap: number): { text: string; truncated: boolean; bytes: number } {
    const limit = Math.min(cap, this.retainCap)
    if (this.total <= limit) {
      return { text: this.head.toString('utf8', 0, this.headBytes), truncated: false, bytes: this.total }
    }
    const half = Math.floor(limit / 2)
    const head = this.head.toString('utf8', 0, half)
    const tail = this.tail.toString('utf8', this.tailBytes - (limit - half), this.tailBytes)
    return { text: head + tail, truncated: true, bytes: this.total }
  }
}

/** 截断标注（design §4.3 固定文案）。 */
export function truncationNotice(shownBytes: number, totalBytes: number): string {
  return `\n… [输出已截断：显示 ${shownBytes} 字节 / 共 ${totalBytes} 字节]`
}

/** 对已合并的原始文本按字节上限截断（保留首尾）并追加标注。 */
export function capMergedText(raw: string, totalBytes: number, cap: number): string {
  if (totalBytes <= cap) return raw
  const buf = Buffer.from(raw, 'utf8')
  const half = Math.floor(cap / 2)
  const shown = Buffer.concat([buf.subarray(0, half), buf.subarray(Math.max(0, buf.length - half))])
  return shown.toString('utf8') + truncationNotice(shown.length, totalBytes)
}

/** 单流快照 → 最终文本（截断时追加标注）。 */
export function formatStream(snapshot: { text: string; truncated: boolean; bytes: number }): string {
  if (!snapshot.truncated) return snapshot.text
  return snapshot.text + truncationNotice(Buffer.byteLength(snapshot.text, 'utf8'), snapshot.bytes)
}
