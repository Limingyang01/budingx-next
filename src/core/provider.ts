// Provider port owned by Core (SP002 design §3.1/§3.4).
// The provider module implements this contract; Core never imports provider.

import type { ErrorClass, Usage } from './events.js'

export type FinishReason =
  | 'stop'
  | 'tool_calls'
  | 'length'
  | 'content_filter'
  | 'unknown'

export type ProviderError = {
  class: ErrorClass
  code: string
  message: string
  retryable: boolean
  status?: number
}

export type ToolSpec = {
  name: string
  description: string
  parameters?: Record<string, unknown>
}

// Streaming tool call fragments, as emitted by OpenAI compatible gateways.
// `index` is optional: some gateways omit it on continuation fragments.
export type ToolFragment = {
  index?: number
  callId?: string
  nameDelta?: string
  argsDelta?: string
}

export type ToolCall = {
  index: number
  id: string
  name: string
  arguments: string
}

export type ToolCallError = {
  index: number
  code: string
  message: string
}

export type ApiToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ApiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ApiToolCall[]; reasoning_content?: string }
  | { role: 'tool'; tool_call_id: string; content: string }

export type ChatRequest = {
  model: string
  messages: ApiMessage[]
  tools?: ToolSpec[]
  stream?: boolean
  maxTokens?: number
  signal?: AbortSignal
}

export type ProviderEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | {
      type: 'tool_call_delta'
      /** Some gateways omit the index on continuation fragments. */
      index?: number
      callId?: string
      nameDelta?: string
      argsDelta?: string
    }
  | { type: 'message_completed'; finishReason: FinishReason; usage?: Usage }
  | {
      type: 'retry'
      attempt: number
      maxAttempts: number
      delayMs: number
      errorClass: ErrorClass
    }
  | { type: 'failed'; error: ProviderError }

export interface ModelProvider {
  preserveToolReasoning?(model: string): boolean
  stream(request: ChatRequest): AsyncGenerator<ProviderEvent>
}
