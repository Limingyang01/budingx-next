// SP004 agent-observability §4.6、§4.10：追踪运行时。
// 负责开关、URL 校验、生命周期、有界后台发送与故障隔离。
// 追踪关闭或异常时，Agent 业务结果完全不受影响。

import type { TraceAttributes, TraceHandle, Tracer } from '../core/observability.js'
import { TraceContext, type TraceBatch } from './context.js'
import { OtlpExporter, REQUEST_TIMEOUT_MS, type Fetcher } from './exporter.js'

/** 后台最多在途的批次数。 */
export const MAX_INFLIGHT_BATCHES = 1

/** 后台最多等待发送的批次数。 */
export const MAX_PENDING_BATCHES = 8

/** 正常退出时 flush 的总预算（毫秒）。 */
export const SHUTDOWN_BUDGET_MS = 3000

/** 运行时配置。 */
export type TracingConfig = {
  enabled: boolean
  baseUrl?: string
  publicKey?: string
  secretKey?: string
  captureContent?: boolean
  knownSecrets?: readonly string[]
}

/** 宿主只读回执：按回合提供实际 trace ID、预期会话 ID 与发送结果。 */
export type TraceReceipt = {
  turnId: string
  traceId: string | null
  sessionId: string
  sent: boolean | null
}

/** 回执回调。 */
export type ReceiptReporter = (receipt: TraceReceipt) => void

/** 本机允许的 http 主机。 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * 校验 base URL。
 * https 可指向任意端点；http 仅限本机，避免明文外发凭据。
 */
export function isValidBaseUrl(raw: string | undefined): boolean {
  try {
    const url = new URL(raw || 'http://localhost:3000')
    if (url.username || url.password) return false
    if (url.protocol === 'https:') return true
    if (url.protocol === 'http:') return LOCAL_HOSTS.has(url.hostname)
    return false
  } catch {
    return false
  }
}

/**
 * 追踪运行时。实现 Core 侧 Tracer 端口。
 */
export class TracingRuntime implements Tracer {
  private readonly context = new TraceContext()
  private readonly exporter: OtlpExporter
  private readonly report?: ReceiptReporter
  private readonly baseUrl: string
  private readonly sessionId: string

  /** 待发送批次队列。 */
  private pending: TraceBatch[] = []
  /** 在途批次数。 */
  private inFlight = 0
  /** 已禁用。 */
  private disabled = false
  /** 已关闭。 */
  private closed = false
  /** 是否启用。未启用时不创建任何观测。 */
  private readonly enabled: boolean
  /** 本回合正文载荷。 */
  private readonly payloads = new Map<string, { input?: unknown; output?: unknown }>()
  /** 当前回合根观测句柄 ID 与回合标识。根收尾时封存整批。 */
  private rootHandleId?: string
  private currentTurnId = ''

  constructor(options: {
    config: TracingConfig
    sessionId: string
    report?: ReceiptReporter
    fetch?: Fetcher
  }) {
    const config = options.config
    this.enabled = config.enabled === true
    this.baseUrl = (config.baseUrl || 'http://localhost:3000').replace(/\/$/, '')
    this.sessionId = options.sessionId
    this.report = options.report
    this.context.captureContent = config.captureContent === true
    this.exporter = new OtlpExporter({
      baseUrl: this.baseUrl,
      publicKey: config.publicKey ?? '',
      secretKey: config.secretKey ?? '',
      knownSecrets: config.knownSecrets ?? [],
      captureContent: config.captureContent === true,
      ...(options.fetch ? { fetch: options.fetch } : {})
    })
  }

  /** 开始一个观测。 */
  begin(
    name: string,
    attributes?: TraceAttributes,
    parent?: TraceHandle
  ): TraceHandle | undefined {
    if (!this.enabled || this.disabled || this.closed) return undefined
    try {
      if (name === 'agent.run') {
        const turnId = String(attributes?.['turn.id'] ?? '')
        const sessionId = String(attributes?.['session.id'] ?? this.sessionId)
        const root = this.context.beginTurn(sessionId, turnId, attributes ?? {})
        this.rootHandleId = root?.id
        this.currentTurnId = turnId
        return root
      }
      return this.context.begin(name, attributes ?? {}, parent)
    } catch {
      return undefined
    }
  }

  /** 结束一个观测。根观测收尾时封存整批并交给后台发送。 */
  end(handle: TraceHandle | undefined, outcome: 'success' | 'error' | 'cancelled' | 'blocked', error?: unknown): void {
    if (this.disabled || this.closed || !handle) return
    try {
      this.context.end(handle, outcome, error)
      if (handle.id === this.rootHandleId && this.currentTurnId) {
        const turnId = this.currentTurnId
        this.rootHandleId = undefined
        this.currentTurnId = ''
        this.sealTurn(turnId)
      }
    } catch {
      /* 观测不得改变业务结果 */
    }
  }

  /** 设置属性。 */
  setAttributes(handle: TraceHandle | undefined, attributes: TraceAttributes): void {
    if (this.disabled || this.closed) return
    try {
      this.context.setAttributes(handle, attributes)
    } catch {
      /* 观测不得改变业务结果 */
    }
  }

  /** 写入正文。 */
  setPayload(handle: TraceHandle | undefined, key: 'input' | 'output', value: unknown): void {
    if (this.disabled || this.closed) return
    try {
      if (handle) {
        const existing = this.payloads.get(handle.id) ?? {}
        if (key === 'input') existing.input = value
        else existing.output = value
        this.payloads.set(handle.id, existing)
      }
      this.context.setPayload(handle, key, value)
    } catch {
      /* 观测不得改变业务结果 */
    }
  }

  /**
   * 收尾一个回合：封存整批并交给后台发送。
   * 回合终态不等待网络。
   */
  sealTurn(turnId: string): void {
    if (this.disabled || this.closed) return
    try {
      const batch = this.context.sealTurn(turnId)
      if (!batch || !batch.spans.length) return
      this.enqueue(batch)
    } catch {
      /* 观测不得改变业务结果 */
    }
  }

  /** 丢弃一个未完成回合的观测。 */
  discardTurn(turnId: string): void {
    try {
      this.context.discardTurn(turnId)
    } catch {
      /* 观测不得改变业务结果 */
    }
  }

  /** 入队一个批次并尝试后台发送。 */
  private enqueue(batch: TraceBatch): void {
    if (this.pending.length >= MAX_PENDING_BATCHES) {
      // 队列满：丢弃新批并计数，不阻塞业务。
      this.pending = []
      return
    }
    this.pending.push(batch)
    void this.drain()
  }

  /** 后台发送队列。 */
  private async drain(): Promise<void> {
    while (
      this.pending.length > 0 &&
      this.inFlight < MAX_INFLIGHT_BATCHES &&
      !this.closed
    ) {
      const batch = this.pending.shift()
      if (!batch) break
      this.inFlight++
      const payloads = this.payloadsFor(batch)
      void this.exporter
        .sendBatch(batch, payloads)
        .then((ok) => {
          this.inFlight--
          this.emitReceipt(batch, ok)
        })
        .catch(() => {
          this.inFlight--
        })
        .finally(() => {
          // 发送后清理正文载荷，避免无界增长。
          for (const span of batch.spans) this.payloads.delete(span.spanId)
        })
    }
  }

  /** 收集批次内各 span 的正文载荷。 */
  private payloadsFor(batch: TraceBatch): Map<string, { input?: unknown; output?: unknown }> {
    const payloads = new Map<string, { input?: unknown; output?: unknown }>()
    for (const span of batch.spans) {
      const payload = this.payloads.get(span.spanId)
      if (payload) payloads.set(span.spanId, payload)
    }
    return payloads
  }

  /** 向宿主回执发送结果。 */
  private emitReceipt(batch: TraceBatch, sent: boolean): void {
    if (!this.report) return
    try {
      this.report({
        turnId: batch.turnId,
        traceId: batch.traceId,
        sessionId: batch.sessionId,
        sent
      })
    } catch {
      /* 回执不得中断业务 */
    }
  }

  /**
   * 即时禁用：停止接收新观测，丢弃未完成回合与待发批次，取消在途发送。
   * Agent 继续运行，行为不变。
   */
  disable(): void {
    if (this.disabled) return
    this.disabled = true
    this.pending = []
    this.rootHandleId = undefined
    this.currentTurnId = ''
    this.context.discardCurrent()
  }

  /**
   * 正常退出：等待已封存批次发送，总预算 3 秒。
   * 到期取消在途请求并丢弃剩余批次。进程不挂起。
   */
  async shutdown(): Promise<void> {
    if (this.closed) return
    const deadline = Date.now() + SHUTDOWN_BUDGET_MS
    while (this.pending.length > 0 || this.inFlight > 0) {
      if (Date.now() >= deadline) {
        this.pending = []
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    this.closed = true
  }
}

let instance: TracingRuntime | undefined

/** 当前运行时实例。 */
export function tracing(): TracingRuntime | undefined {
  return instance
}

/**
 * 初始化追踪。
 * @returns 是否成功启用
 */
export function initializeTracing(
  env: NodeJS.ProcessEnv = process.env,
  options: { sessionId?: string; report?: ReceiptReporter; fetch?: Fetcher } = {}
): boolean {
  if (instance) return true
  if (env.BUDINGX_LANGFUSE_ENABLED !== '1') return false
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) return false
  const baseUrl = env.LANGFUSE_BASE_URL || 'http://localhost:3000'
  if (!isValidBaseUrl(baseUrl)) return false
  try {
    instance = new TracingRuntime({
      config: {
        enabled: true,
        baseUrl,
        publicKey: env.LANGFUSE_PUBLIC_KEY,
        secretKey: env.LANGFUSE_SECRET_KEY,
        captureContent: env.BUDINGX_LANGFUSE_CAPTURE_CONTENT === '1',
        knownSecrets: [env.LANGFUSE_SECRET_KEY]
      },
      sessionId: options.sessionId ?? '',
      ...(options.report ? { report: options.report } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {})
    })
    return true
  } catch {
    return false
  }
}

/** 即时禁用追踪。 */
export function disableTracing(): void {
  instance?.disable()
}

/** 正常退出：限时 flush。 */
export async function shutdownTracing(): Promise<void> {
  const current = instance
  instance = undefined
  await current?.shutdown()
}

/** 请求超时常量，供宿主复用。 */
export { REQUEST_TIMEOUT_MS }
