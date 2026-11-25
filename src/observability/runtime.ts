// SP004 agent-observability §4.6、§4.10：追踪运行时。
// 负责开关、URL 校验、生命周期、有界后台发送与故障隔离。
// 追踪关闭或异常时，Agent 业务结果完全不受影响。

import type { TraceAttributes, TraceHandle, Tracer } from '../core/observability.js'
import { TraceContext, type TraceBatch } from './context.js'
import { OtlpExporter, REQUEST_TIMEOUT_MS, type Fetcher, type TraceBatchPayloads } from './exporter.js'

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
type ActiveTrace = {
  context: TraceContext
  rootId: string
  turnId: string
  handles: Set<string>
  payloads: TraceBatchPayloads
}

export class TracingRuntime implements Tracer {
  private readonly traces = new Map<string, ActiveTrace>()
  private readonly byHandle = new Map<string, ActiveTrace>()
  private readonly exporter: OtlpExporter
  private readonly report?: ReceiptReporter
  private readonly baseUrl: string
  private readonly sessionId: string

  /** 待发送批次队列。 */
  private pending: { batch: TraceBatch; payloads: TraceBatchPayloads }[] = []
  /** 在途批次数。 */
  private inFlight = 0
  /** 已禁用。 */
  private disabled = false
  /** 已关闭。 */
  private closed = false
  /** 是否启用。未启用时不创建任何观测。 */
  private readonly enabled: boolean
  private readonly captureContent: boolean

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
    this.captureContent = config.captureContent === true
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
      if (name === 'agent.run' || name === 'agent.side_question') {
        const turnId = String(attributes?.['turn.id'] ?? '')
        if (!turnId) return undefined
        const sessionId = String(attributes?.['session.id'] ?? this.sessionId)
        this.discardTurn(turnId)
        const context = new TraceContext()
        const root = context.beginTurn(sessionId, turnId, attributes ?? {}, name)
        if (!root) return undefined
        const trace: ActiveTrace = {
          context, rootId: root.id, turnId, handles: new Set([root.id]), payloads: new Map()
        }
        this.traces.set(turnId, trace)
        this.byHandle.set(root.id, trace)
        return root
      }
      const trace = parent ? this.byHandle.get(parent.id) : [...this.traces.values()].at(-1)
      const child = trace?.context.begin(name, attributes ?? {}, parent)
      if (child && trace) {
        this.byHandle.set(child.id, trace)
        trace.handles.add(child.id)
      }
      return child
    } catch {
      return undefined
    }
  }

  /** 结束一个观测。根观测收尾时封存整批并交给后台发送。 */
  end(handle: TraceHandle | undefined, outcome: 'success' | 'error' | 'cancelled' | 'blocked', error?: unknown): void {
    if (this.disabled || this.closed || !handle) return
    try {
      const trace = this.byHandle.get(handle.id)
      trace?.context.end(handle, outcome, error)
      if (trace?.rootId === handle.id) this.sealTurn(trace.turnId)
    } catch {
      /* 观测不得改变业务结果 */
    }
  }

  /** 设置属性。 */
  setAttributes(handle: TraceHandle | undefined, attributes: TraceAttributes): void {
    if (this.disabled || this.closed) return
    try {
      if (handle) this.byHandle.get(handle.id)?.context.setAttributes(handle, attributes)
    } catch {
      /* 观测不得改变业务结果 */
    }
  }

  /** 写入正文。 */
  setPayload(handle: TraceHandle | undefined, key: 'input' | 'output', value: unknown): void {
    if (this.disabled || this.closed || !this.captureContent || !handle) return
    try {
      const trace = this.byHandle.get(handle.id)
      if (!trace) return
      const payload = trace.payloads.get(handle.id) ?? {}
      payload[key] = value
      trace.payloads.set(handle.id, payload)
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
      const trace = this.traces.get(turnId)
      if (!trace) return
      const batch = trace.context.sealTurn(turnId)
      this.releaseTrace(trace)
      if (!batch || !batch.spans.length) return
      this.enqueue(batch, trace.payloads)
    } catch {
      /* 观测不得改变业务结果 */
    }
  }

  /** 丢弃一个未完成回合的观测。 */
  discardTurn(turnId: string): void {
    try {
      const trace = this.traces.get(turnId)
      if (!trace) return
      trace.context.discardTurn(turnId)
      this.releaseTrace(trace)
    } catch {
      /* 观测不得改变业务结果 */
    }
  }

  private releaseTrace(trace: ActiveTrace): void {
    for (const id of trace.handles) this.byHandle.delete(id)
    this.traces.delete(trace.turnId)
  }

  /** 入队一个批次并尝试后台发送。 */
  private enqueue(batch: TraceBatch, payloads: TraceBatchPayloads): void {
    if (this.pending.length >= MAX_PENDING_BATCHES) {
      // 队列满：丢弃新批并计数，不阻塞业务。
      this.pending = []
      return
    }
    this.pending.push({ batch, payloads })
    void this.drain()
  }

  /** 后台发送队列。 */
  private async drain(): Promise<void> {
    while (
      this.pending.length > 0 &&
      this.inFlight < MAX_INFLIGHT_BATCHES &&
      !this.closed
    ) {
      const entry = this.pending.shift()
      if (!entry) break
      this.inFlight++
      void this.exporter
        .sendBatch(entry.batch, entry.payloads)
        .then((ok) => this.emitReceipt(entry.batch, ok))
        .catch(() => this.emitReceipt(entry.batch, false))
        .finally(() => {
          this.inFlight--
          void this.drain()
        })
    }
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
    this.byHandle.clear()
    this.traces.clear()
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
    this.byHandle.clear()
    this.traces.clear()
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
