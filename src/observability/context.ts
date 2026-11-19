// SP004 agent-observability §4.3：观测上下文与回合缓冲。
//
// 父子关系由调用方显式传入父句柄建立，不依赖隐式上下文（AsyncLocalStorage）。
// 每个回合独立缓冲，收尾时整批封存交给发送器。

import { randomBytes } from 'node:crypto'
import type { TraceAttributes, TraceHandle, TraceOutcome } from '../core/observability.js'

/** 单回合 span 上限（含根）。超出丢弃该回合整批。 */
export const MAX_SPANS_PER_TURN = 200

/** 一条待上报的 span。 */
export type PendingSpan = {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: Record<string, string>
  status?: { code: number }
}

/** 一个回合的观测批。 */
export type TraceBatch = {
  traceId: string
  sessionId: string
  turnId: string
  spans: PendingSpan[]
}

/** 句柄对应的内部观测状态。 */
type Observation = {
  spanId: string
  traceId: string
  parentSpanId?: string
  name: string
  startedAt: number
  attributes: Record<string, string>
  ended: boolean
  outcome?: TraceOutcome
  statusMessage?: string
  input?: unknown
  output?: unknown
}

/** 纳秒时间戳。 */
export function nanos(time: number): string {
  return (BigInt(time) * 1_000_000n).toString()
}

/** 十六进制 ID。 */
export function hexId(bytes: number): string {
  return randomBytes(bytes).toString('hex')
}

/**
 * 追踪上下文：维护当前回合的观测缓冲与句柄表。
 *
 * 一个实例对应一个会话。回合之间互不串写。
 */
export class TraceContext {
  /** 句柄 ID → 观测状态。 */
  private readonly observations = new Map<string, Observation>()
  /** 当前回合的 span 列表。 */
  private spans: PendingSpan[] = []
  /** 当前回合标识。 */
  private turnId = ''
  /** 当前回合的 trace ID。 */
  private traceId = ''
  /** 当前会话标识。 */
  private sessionId = ''
  /** 已被丢弃的批次数。 */
  private droppedBatches = 0
  /** 当前回合是否已因超限被丢弃。 */
  private turnDropped = false

  /** 开始一个回合，返回根句柄。 */
  beginTurn(sessionId: string, turnId: string, attributes: TraceAttributes): TraceHandle | undefined {
    this.sessionId = sessionId
    this.turnId = turnId
    this.traceId = hexId(16)
    this.spans = []
    this.turnDropped = false
    const root = this.observe('agent.run', attributes, undefined, this.traceId)
    return root
  }

  /** 在当前回合创建一个子观测。 */
  begin(
    name: string,
    attributes: TraceAttributes,
    parent?: TraceHandle
  ): TraceHandle | undefined {
    if (!this.traceId) return undefined
    const parentObservation = parent ? this.observations.get(parent.id) : undefined
    // 父句柄必须仍属于当前回合；否则视为无效父，不创建游离子观测。
    if (parent && !parentObservation) return undefined
    const traceId = parentObservation?.traceId ?? this.traceId
    return this.observe(name, attributes, parentObservation?.spanId, traceId)
  }

  /** 创建一个观测并登记到当前回合缓冲。 */
  private observe(
    name: string,
    attributes: TraceAttributes,
    parentSpanId: string | undefined,
    traceId: string
  ): TraceHandle | undefined {
    if (this.spans.length >= MAX_SPANS_PER_TURN) {
      // 超出上限：丢弃该回合整批，不再继续累积，也不产生残缺观测。
      this.spans = []
      this.turnDropped = true
      this.droppedBatches++
      return undefined
    }
    const observation: Observation = {
      spanId: hexId(8),
      traceId,
      parentSpanId,
      name,
      startedAt: Date.now(),
      attributes: this.toAttributeMap(attributes),
      ended: false
    }
    this.observations.set(observation.spanId, observation)
    this.spans.push({
      traceId,
      spanId: observation.spanId,
      ...(parentSpanId ? { parentSpanId } : {}),
      name,
      startTimeUnixNano: nanos(observation.startedAt),
      endTimeUnixNano: nanos(observation.startedAt),
      attributes: observation.attributes
    })
    return { id: observation.spanId }
  }

  /** 设置属性。 */
  setAttributes(handle: TraceHandle | undefined, attributes: TraceAttributes): void {
    if (!handle) return
    const observation = this.observations.get(handle.id)
    if (!observation) return
    const span = this.spans.find((entry) => entry.spanId === handle.id)
    if (!span) return
    const values = this.toAttributeMap(attributes)
    Object.assign(observation.attributes, values)
    Object.assign(span.attributes, values)
  }

  /** 写入正文。只有开启正文采集时才记录。 */
  setPayload(handle: TraceHandle | undefined, key: 'input' | 'output', value: unknown): void {
    if (!handle || !this.captureContent) return
    const observation = this.observations.get(handle.id)
    if (!observation) return
    if (key === 'input') observation.input = value
    else observation.output = value
  }

  /** 结束观测。 */
  end(handle: TraceHandle | undefined, outcome: TraceOutcome, error?: unknown): void {
    if (!handle) return
    const observation = this.observations.get(handle.id)
    if (!observation || observation.ended) return
    observation.ended = true
    observation.outcome = outcome
    const span = this.spans.find((entry) => entry.spanId === handle.id)
    if (!span) return
    span.endTimeUnixNano = nanos(Date.now())
    span.attributes['langfuse.observation.metadata.outcome'] = outcome
    if (outcome === 'error') {
      span.attributes['langfuse.observation.level'] = 'ERROR'
      span.status = { code: 2 }
      span.attributes['langfuse.observation.status_message'] = this.statusMessage(error)
    } else if (outcome === 'cancelled' || outcome === 'blocked') {
      span.attributes['langfuse.observation.level'] = 'WARNING'
      if (error !== undefined) {
        span.attributes['langfuse.observation.status_message'] = this.statusMessage(error)
      }
    }
  }

  /** 错误消息只保留错误码，不带原文。 */
  private statusMessage(error: unknown): string {
    if (error === undefined || error === null) return 'operation_failed'
    const candidate = (error as { code?: unknown }).code
    if (typeof candidate === 'string' && candidate) return candidate
    const name = (error as { name?: unknown }).name
    if (typeof name === 'string' && name) return name
    return 'operation_failed'
  }

  /**
   * 收尾当前回合，返回整批 span。
   * 若该回合因超限被丢弃，返回 undefined。
   */
  sealTurn(turnId: string): TraceBatch | undefined {
    if (this.turnId !== turnId) return undefined
    const spans = this.spans
    const traceId = this.traceId
    // 该回合因超限被丢弃：不产出残缺批次。
    const dropped = this.turnDropped
    // 清理本回合的句柄，避免跨回合残留。
    for (const span of spans) this.observations.delete(span.spanId)
    this.spans = []
    this.traceId = ''
    this.turnId = ''
    this.turnDropped = false
    if (dropped) return undefined
    const batch: TraceBatch = {
      traceId,
      sessionId: this.sessionId,
      turnId,
      spans
    }
    return batch
  }

  /** 丢弃当前回合未完成的观测。 */
  discardTurn(turnId: string): void {
    if (this.turnId !== turnId) return
    for (const span of this.spans) this.observations.delete(span.spanId)
    this.spans = []
    this.traceId = ''
    this.turnId = ''
  }

  /** 丢弃当前未完成回合（用于即时禁用）。 */
  discardCurrent(): void {
    for (const span of this.spans) this.observations.delete(span.spanId)
    this.spans = []
    this.traceId = ''
    this.turnId = ''
  }

  /** 是否处于正文采集模式。 */
  captureContent = false

  /** 属性值转字符串映射。 */
  private toAttributeMap(attributes: TraceAttributes): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(attributes ?? {})) {
      if (value === undefined || value === null) continue
      result[key] = typeof value === 'string' ? value : String(value)
    }
    return result
  }
}
