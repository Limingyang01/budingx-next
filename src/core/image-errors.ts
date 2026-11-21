// SP007 MM-08：图片不支持错误判定（design §4.4）。错误驱动降级——无静态
// vision 表，供应商拒绝消息即信号。纯逻辑置于 core 供 Session 消费；provider
// 侧 re-export 保持 T2 测试入口不变（core 禁 import provider，provider→core 合法）。

/**
 * 供应商错误消息表明端点/模型拒绝图片输入时为真（会话据此剥离图片重试一次）。
 * 普通错误（限流、鉴权、上下文长度、工具支持）永不匹配。
 */
export function isImageUnsupportedError(message: unknown): boolean {
  if (typeof message !== 'string' || !message) return false
  const m = message.toLowerCase()
  const hasMedia = /image|vision|multimodal|modality/.test(m)
  if (!hasMedia) return false
  // image_url schema 拒绝（OpenAI 兼容网关）
  if (/image_url/.test(m) && /(schema|invalid|not supported|unsupported)/.test(m)) return true
  return /not support|unsupported|does not support|doesn't support|no support|not available|invalid schema/.test(m)
}
