// SP004 agent-observability 模块出口。
export { loadTracingEnvironment, TRACING_ENV_KEYS } from './config.js'
export { redactValue } from './redact.js'
export {
  TraceContext,
  MAX_SPANS_PER_TURN,
  hexId,
  nanos,
  type PendingSpan,
  type TraceBatch
} from './context.js'
export {
  OtlpExporter,
  buildRequestBody,
  TRACES_PATH,
  REQUEST_TIMEOUT_MS,
  type ExporterConfig,
  type Fetcher
} from './exporter.js'
export {
  TracingRuntime,
  disableTracing,
  initializeTracing,
  isValidBaseUrl,
  shutdownTracing,
  tracing,
  MAX_INFLIGHT_BATCHES,
  MAX_PENDING_BATCHES,
  SHUTDOWN_BUDGET_MS,
  type TraceReceipt,
  type ReceiptReporter,
  type TracingConfig
} from './runtime.js'
