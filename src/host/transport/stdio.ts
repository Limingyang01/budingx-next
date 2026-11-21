// SP008 T8：stdio 宿主传输。stdout 只承载协议帧，日志一律走 stderr。
import { createInterface } from 'node:readline'
import type { HostConnection, HostServer } from '../server.js'
import type { HostTransport } from './transport.js'

export type StdioHandle = {
  transport: HostTransport
  /** Resolves when stdin reaches EOF (the client closed the pipe). */
  eof: Promise<void>
  close(): void
}

export type StdioOptions = {
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
}

export function connectStdio(server: HostServer, options: StdioOptions = {}): StdioHandle {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const reader = createInterface({ input, crlfDelay: Infinity })
  const lineListeners = new Set<(line: string) => void>()
  const closeListeners = new Set<(reason?: string) => void>()
  let closed = false
  let resolveEof: () => void = () => {}
  const eof = new Promise<void>((resolve) => {
    resolveEof = resolve
  })

  const notifyClose = (reason?: string) => {
    for (const listener of closeListeners) listener(reason)
    closeListeners.clear()
  }

  reader.on('line', (line) => {
    if (closed) return
    for (const listener of lineListeners) listener(line)
  })
  reader.on('close', () => resolveEof())
  input.on('end', () => resolveEof())

  const connection: HostConnection = {
    send(text: string) {
      if (closed) return
      output.write(text)
    },
    close(_code?: number, reason?: string) {
      if (closed) return
      closed = true
      reader.close()
      notifyClose(reason)
    },
    onLine(handler: (line: string) => void) {
      lineListeners.add(handler)
    },
    onClose(handler: () => void) {
      closeListeners.add(handler)
    }
  }

  server.attach(connection)

  return {
    transport: {
      write(text: string) {
        if (closed) return
        for (const line of text.split('\n')) {
          if (line.length > 0) queueMicrotask(() => {
            if (!closed) for (const listener of lineListeners) listener(line)
          })
        }
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
        reader.close()
        notifyClose(reason)
      }
    },
    eof,
    close() {
      if (closed) return
      closed = true
      reader.close()
      notifyClose()
    }
  }
}
