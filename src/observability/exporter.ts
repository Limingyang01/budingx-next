// SP004 agent-observability §4.3：手写 OTLP JSON 导出器。
// 直接向 Langfuse 的 OTLP 端点投递，不引入 OTel SDK。
// 协议与属性命名见设计 §4.3 与 Langfuse 官方 Attribute Mapping。

import { redactValue } from './redact.js'
import type { TraceBatch } from './context.js'

/** 上报端点路径。 */
export const TRACES_PATH = '/api/public/otel/v1/traces'

/** 单次请求超时（毫秒）。 */
export const REQUEST_TIMEOUT_MS = 3000

/** 发送器接口，可在测试中注入替身。 */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

/** 导出器配置。 */
export type ExporterConfig = {
  baseUrl: string
  publicKey: string
  secretKey: string
  /** 已知凭据字面量，脱敏时匹配。 */
  knownSecrets?: readonly string[]
  /** 是否采集正文。 */
  captureContent?: boolean
  /** 发送实现。 */
  fetch?: Fetcher
}

/** OTLP 属性值。 */
type OtlpValue = { stringValue: string }

/** OTLP 属性。 */
type OtlpAttribute = { key: string; value: OtlpValue }

/** OTLP span。 */
type OtlpSpan = {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: OtlpAttribute[]
  status?: { code: number }
}

/** 构造属性数组。 */
function toAttributes(values: Record<string, string>): OtlpAttribute[] {
  return Object.entries(values).map(([key, value]) => ({
    key,
    value: { stringValue: value } satisfies OtlpValue
  }))
}

/** 一批 span 及其正文载荷。 */
export type TraceBatchPayloads = Map<string, { input?: unknown; output?: unknown }>

/**
 * 把一批 span 组装成 OTLP JSON 请求体。
 *
 * `service.name` 固定为 budingx-tui，scope 名为 budingx-agent。
 * 正文属性只在开启正文采集时写入。
 */
export function buildRequestBody(
  batch: TraceBatch,
  options: {
    captureContent?: boolean
    knownSecrets?: readonly string[]
    payloads?: TraceBatchPayloads
  } = {}
): Record<string, unknown> {
  const capture = options.captureContent === true
  const secrets = options.knownSecrets ?? []
  const spans: OtlpSpan[] = batch.spans.map((span) => {
    const attributes: Record<string, string> = { ...span.attributes }
    if (capture) {
      const payload = options.payloads?.get(span.spanId)
      if (payload?.input !== undefined) {
        attributes['langfuse.observation.input'] = redactValue(payload.input, secrets)
      }
      if (payload?.output !== undefined) {
        attributes['langfuse.observation.output'] = redactValue(payload.output, secrets)
      }
    }
    const result: OtlpSpan = {
      traceId: span.traceId,
      spanId: span.spanId,
      ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
      name: span.name,
      kind: 1,
      startTimeUnixNano: span.startTimeUnixNano,
      endTimeUnixNano: span.endTimeUnixNano,
      attributes: toAttributes(attributes)
    }
    if (span.status) result.status = span.status
    return result
  })
  return {
    resourceSpans: [
      {
        resource: {
          attributes: toAttributes({ 'service.name': 'budingx-tui' })
        },
        scopeSpans: [
          {
            scope: { name: 'budingx-agent' },
            spans
          }
        ]
      }
    ]
  }
}

/** 构造 OTLP 上报请求 init。协议字段由 Langfuse 公开规范规定。 */
function buildRequestInit(body: string, publicKey: string, secretKey: string): RequestInit {
  const credential = Buffer.from(`${publicKey}:${secretKey}`).toString('base64')
  return {
    method: 'POST',
    headers: {
      authorization: `Basic ${credential}`,
      'content-type': 'application/json',
      'x-langfuse-ingestion-version': '4'
    },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }
}

/**
 * OTLP 导出器。负责把封存的批次投递到 Langfuse。
 */
export class OtlpExporter {
  private readonly config: ExporterConfig
  private readonly send: Fetcher

  constructor(config: ExporterConfig) {
    this.config = config
    this.send = config.fetch ?? fetch
  }

  /** 发送一个批次。失败静默，不影响 Agent 业务结果。 */
  async sendBatch(batch: TraceBatch, payloads?: TraceBatchPayloads): Promise<boolean> {
    if (!batch || !batch.spans.length) return true
    const body = buildRequestBody(batch, {
      captureContent: this.config.captureContent === true,
      knownSecrets: this.config.knownSecrets ?? [],
      ...(payloads ? { payloads } : {})
    })
    const endpoint = new URL(TRACES_PATH, this.config.baseUrl).toString()
    const init = buildRequestInit(
      JSON.stringify(body),
      this.config.publicKey,
      this.config.secretKey
    )
    try {
      const response = await this.send(endpoint, init)
      return response.ok
    } catch {
      // 可观测性不得改变业务结果。
      return false
    }
  }
}
