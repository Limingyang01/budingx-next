// SP004 T3 · 命令输出收集与截断（design §4.3）。
// stdout/stderr 分别按上限截断（保留首尾），合并文本再截断到同一上限；
// 截断标注固定为 `\n… [输出已截断：显示 N 字节 / 共 M 字节]`。

/** 按字节保留首尾的输出收集器：内存占用与上限同阶，总字节数始终精确。 */
export class OutputCollector {
  private head: Buffer[] = []
  private headBytes = 0
  private tail: Buffer = Buffer.alloc(0)
  private total = 0

  constructor(private readonly retainCap: number) {}

  push(chunk: Buffer): void {
    this.total += chunk.length
    if (this.headBytes < this.retainCap) {
      const room = this.retainCap - this.headBytes
      if (chunk.length <= room) {
        this.head.push(chunk)
        this.headBytes += chunk.length
      } else {
        this.head.push(chunk.subarray(0, room))
        this.headBytes = this.retainCap
      }
    }
    const merged = Buffer.concat([this.tail, chunk])
    this.tail = merged.length > this.retainCap ? merged.subarray(merged.length - this.retainCap) : merged
  }

  get bytes(): number {
    return this.total
  }

  /** 返回保留文本（未加截断标注）、是否截断与原始总字节数。 */
  snapshot(cap: number): { text: string; truncated: boolean; bytes: number } {
    if (this.total <= cap) {
      return { text: Buffer.concat(this.head).toString('utf8'), truncated: false, bytes: this.total }
    }
    const half = Math.floor(cap / 2)
    const headPart = Buffer.concat(this.head).subarray(0, half)
    const tailPart = this.tail.subarray(Math.max(0, this.tail.length - half))
    return { text: headPart.toString('utf8') + tailPart.toString('utf8'), truncated: true, bytes: this.total }
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