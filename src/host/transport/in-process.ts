import type { HostConnection, HostServer } from '../server.js'
import type { HostTransport } from './transport.js'

/**
 * 进程内传输：与宿主服务同进程、不经套接字，但仍走 NDJSON 帧与异步投递，
 * 保证测试与真实传输看到相同的顺序和错误行为。
 */
export function connectInProcess(server: HostServer): HostTransport {
  let lineHandler: (line: string) => void = () => {}
  let serverCloseHandler: (() => void) | undefined
  const lineListeners = new Set<(line: string) => void>()
  const closeListeners = new Set<(reason?: string) => void>()
  let closed = false

  const notifyClose = (reason?: string) => {
    for (const listener of closeListeners) listener(reason)
    closeListeners.clear()
  }

  const connection: HostConnection = {
    send(text: string) {
      if (closed) return
      const lines = text.split('\n').filter((line) => line.length > 0)
      queueMicrotask(() => {
        if (closed) return
        for (const line of lines) {
          for (const listener of lineListeners) listener(line)
        }
      })
    },
    close(_code?: number, reason?: string) {
      if (closed) return
      closed = true
      notifyClose(reason)
    },
    onLine(handler: (line: string) => void) {
      lineHandler = handler
    },
    onClose(handler: () => void) {
      serverCloseHandler = handler
    }
  }

  server.attach(connection)

  return {
    write(text: string) {
      if (closed) return
      queueMicrotask(() => {
        if (closed) return
        lineHandler(text)
      })
    },
    onLine(listener: (line: string) => void) {
      lineListeners.add(listener)
      return () => {
        lineListeners.delete(listener)
      }
    },
    onClose(listener: (reason?: string) => void) {
      closeListeners.add(listener)
      return () => {
        closeListeners.delete(listener)
      }
    },
    close(reason?: string) {
      if (closed) return
      closed = true
      serverCloseHandler?.()
      notifyClose(reason)
    }
  }
}
