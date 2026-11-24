// SP004 agent-observability §4.4：观测正文脱敏与安全裁剪。
// 关键顺序：先生成脱敏结构，再从脱敏结构按长度裁剪。
// 裁剪、错误回退与上报阶段都只消费脱敏结果，原始密钥不会重新出现。
//
// 独立实现，不依赖 src/storage 的凭据存取；已知凭据由宿主传入。

/** 脱敏后的占位标记。 */
const REDACTED = '[redacted]'

/** 正文序列化上限。 */
const MAX_LENGTH = 8000

/** 消息数组保留的最大条数。 */
const MAX_MESSAGES = 8

/** 已知凭据的最短匹配长度，避免误伤短串。 */
const MIN_SECRET_LENGTH = 8

/** 敏感键名。命中即替换整个值。 */
const SENSITIVE_KEY = /^(?:api[_-]?key|secret(?:[_-]?key)?|password|passwd|pwd|authorization|token|access[_-]?token|refresh[_-]?token|session[_-]?token|cookie|set[_-]?cookie|private[_-]?key|client[_-]?secret|credential|credentials)$/i

/** 字符串内的凭据样式。 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  // PEM 私钥块
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  // Authorization: Bearer / bearer
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // OpenAI 风格
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  // GitHub token / PAT
  /\bgh[posru]_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // AWS access key
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Slack
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  // Google API key
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  // JWT
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
  // Cookie / Set-Cookie 头
  /\b(?:set[-_]?cookie|cookie)\s*[:=]\s*[^\r\n]*/gi,
  // 键值形式的凭据（api_key=..., "secret": "..."）
  /((?:["']?)(?:api[_-]?key|secret(?:[_-]?key)?|password|passwd|authorization|(?:access[_-]?|refresh[_-]?)?token|private[_-]?key|client[_-]?secret)(?:["']?)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,}\]]+)/gi
]

/**
 * 对字符串做凭据样式替换。
 * @param value 原始字符串
 * @param secrets 宿主提供的已知凭据字面量
 */
function redactText(value: string, secrets: readonly string[]): string {
  let result = value
  for (const pattern of CREDENTIAL_PATTERNS) {
    result = result.replace(pattern, (match, prefix?: string) => {
      // 键值形式保留前缀，只替换值部分。
      if (prefix !== undefined && pattern === CREDENTIAL_PATTERNS[CREDENTIAL_PATTERNS.length - 1]) {
        return `${prefix}${REDACTED}`
      }
      return REDACTED
    })
  }
  for (const secret of secrets) {
    if (secret.length >= MIN_SECRET_LENGTH) result = result.split(secret).join(REDACTED)
  }
  return result
}

/**
 * 递归生成脱敏后的结构。
 * 键名命中敏感模式时整个值被替换；其余字符串做样式替换。
 */
function redactStructure(value: unknown, secrets: readonly string[], seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactText(value, secrets)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) throw new TypeError('circular structure')
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => redactStructure(entry, secrets, seen))
    }
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) {
        result[key] = REDACTED
        continue
      }
      result[key] = redactStructure(entry, secrets, seen)
    }
    return result
  } finally {
    seen.delete(value)
  }
}

/** 是否为 user/assistant 消息数组。 */
function isMessageArray(value: unknown): value is { role: string; content: unknown }[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (row) =>
        row !== null &&
        typeof row === 'object' &&
        typeof (row as { role?: unknown }).role === 'string'
    )
  )
}

/** 消息正文转字符串。 */
function contentToString(content: unknown): string {
  if (typeof content === 'string') return content
  try {
    return JSON.stringify(content ?? null)
  } catch {
    return ''
  }
}

/**
 * 从已脱敏的消息数组裁剪正文，保留角色与数组形状。
 * 每次按最终序列化长度检查上限。
 */
function truncateMessages(
  messages: { role: string; content: unknown }[]
): string {
  const rows = messages.slice(-MAX_MESSAGES)
  for (let limit = 6000; limit >= 0; limit = limit > 0 ? Math.floor(limit / 2) : -1) {
    const encoded = JSON.stringify(
      rows.map((row) => ({
        role: row.role.slice(0, 32),
        content: contentToString(row.content).slice(0, limit) + ' [truncated]'
      }))
    )
    if (encoded.length <= MAX_LENGTH) return encoded
  }
  return JSON.stringify({ truncated: true, preview: '' })
}

/**
 * 从已脱敏的序列化结果裁剪为预览。
 * preview 只取自已脱敏的字符串。
 */
function truncatePreview(encoded: string): string {
  for (let limit = 6000; limit >= 0; limit = limit > 0 ? Math.floor(limit / 2) : -1) {
    const result = JSON.stringify({ truncated: true, preview: encoded.slice(0, limit) })
    if (result.length <= MAX_LENGTH) return result
  }
  return JSON.stringify({ truncated: true, preview: '' })
}

/**
 * 脱敏并序列化观测正文。
 *
 * 顺序：① 递归脱敏 → ② 序列化 → ③ 超限时从脱敏结果裁剪。
 * 任何异常都回退为不含原文的错误标记。
 *
 * @param value 待上报的结构
 * @param knownSecrets 宿主提供的已知凭据字面量
 */
export function redactContent(value: unknown, knownSecrets: readonly string[] = []): unknown {
  const secrets = knownSecrets.filter(
    (secret) => typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH
  )
  try {
    return redactStructure(value, secrets, new WeakSet<object>())
  } catch {
    return { error: 'unserializable' }
  }
}

export function redactValue(value: unknown, knownSecrets: readonly string[] = []): string {
  const redacted = redactContent(value, knownSecrets)
  let encoded: string
  try {
    encoded = JSON.stringify(redacted) ?? 'null'
  } catch {
    return JSON.stringify({ error: 'unserializable' })
  }
  if (encoded.length <= MAX_LENGTH) return encoded
  if (isMessageArray(redacted)) {
    const truncated = truncateMessages(redacted)
    if (truncated.length <= MAX_LENGTH) return truncated
    return truncatePreview(truncated)
  }
  return truncatePreview(encoded)
}
