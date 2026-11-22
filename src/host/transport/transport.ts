/** 宿主传输的公共形状：行帧、关闭通知与客户端主动关闭。 */
export interface HostTransport {
  write(text: string): void
  onLine(listener: (line: string) => void): () => void
  onClose(listener: (reason?: string) => void): () => void
  close(reason?: string): void
}
