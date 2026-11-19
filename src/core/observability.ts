// Core 侧追踪端口（SP004 agent-observability 设计 §4.2）。
// 纯类型契约，无 IO。Core 只依赖此文件，不 import 任何网络或文件系统模块。
// 实现由宿主注入；未注入时 Session 跳过所有埋点。

/** 观测终态。与 Langfuse 观测级别对应：error→ERROR，cancelled/blocked→WARNING。 */
export type TraceOutcome = 'success' | 'error' | 'cancelled' | 'blocked'

/** 观测属性。值只允许标量，避免 Core 侧构造复杂结构。 */
export type TraceAttributes = Record<string, string | number | boolean>

/** 观测句柄。实现方持有真实 span 身份，Core 只做不透明传递。 */
export type TraceHandle = { readonly id: string }

/**
 * 追踪端口。实现由宿主（`src/tui/runtime.ts`）注入到 Session。
 *
 * 约定：
 * - `begin` 失败返回 `undefined`，绝不抛出；
 * - 所有方法内部异常由实现方吞掉，绝不向 Core 传播；
 * - 父子关系由调用方显式传入 `parent` 句柄，不依赖隐式上下文。
 */
export interface Tracer {
  /**
   * 开始一个观测。
   * @param name 观测名：`agent.run` / `model.request` / `tool.<name>`
   * @param attributes 观测属性
   * @param parent 父观测句柄；根观测为 undefined，子观测传当前回合根句柄
   */
  begin(
    name: string,
    attributes?: TraceAttributes,
    parent?: TraceHandle
  ): TraceHandle | undefined
  /** 结束一个观测。outcome 决定观测级别与元数据。 */
  end(handle: TraceHandle | undefined, outcome: TraceOutcome, error?: unknown): void
  /** 在指定观测上设置属性。 */
  setAttributes(handle: TraceHandle | undefined, attributes: TraceAttributes): void
  /** 写入 input/output 正文。仅在正文采集开启时实际生效。 */
  setPayload(handle: TraceHandle | undefined, key: 'input' | 'output', value: unknown): void
}
