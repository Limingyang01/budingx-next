import type { McpElicitationAction, McpElicitationRequest } from './types.js'

export function createMcpElicitation() {
  const listeners = new Set<() => void>()
  let pending: McpElicitationRequest | undefined
  let finish: ((answer: McpElicitationAction) => void) | undefined
  let ready = false
  const notify = () => { for (const listener of listeners) listener() }
  return {
    snapshot: () => pending,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    attach() {
      ready = true
      return () => { ready = false; finish?.('cancel') }
    },
    answer(choice: McpElicitationAction) { finish?.(choice) },
    request(request: McpElicitationRequest): Promise<McpElicitationAction> {
      if (!ready || pending || request.signal.aborted) return Promise.resolve('decline')
      return new Promise((resolve) => {
        const abort = () => finish?.('cancel')
        pending = request
        finish = (answer) => {
          request.signal.removeEventListener('abort', abort)
          finish = undefined
          pending = undefined
          notify()
          resolve(answer)
        }
        request.signal.addEventListener('abort', abort, { once: true })
        notify()
      })
    }
  }
}

export type McpElicitationPort = ReturnType<typeof createMcpElicitation>
