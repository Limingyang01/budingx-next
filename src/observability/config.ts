// SP004 agent-observability §4.5：追踪配置加载。
// 只导入 5 个白名单变量；进程环境优先于用户指定的 env 文件。
// 不读取工作区设置，不扫描仓库 .env，不导入运行参数。

import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { parseEnv } from 'node:util'

/** 允许导入的变量白名单。 */
export const TRACING_ENV_KEYS = [
  'BUDINGX_LANGFUSE_ENABLED',
  'BUDINGX_LANGFUSE_CAPTURE_CONTENT',
  'LANGFUSE_BASE_URL',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY'
] as const

/**
 * 加载追踪配置。
 *
 * @param env 继承的进程环境
 * @param file 用户显式指定的 env 文件路径；必须是绝对路径
 * @param report 脱敏诊断回调
 */
export function loadTracingEnvironment(
  env: NodeJS.ProcessEnv,
  file: unknown,
  report: (message: string) => void = () => undefined
): NodeJS.ProcessEnv {
  if (typeof file !== 'string' || !file.trim()) return { ...env }
  const notify = (message: string): void => {
    try {
      report(message)
    } catch {
      /* 诊断不得中断启动 */
    }
  }
  try {
    if (!isAbsolute(file)) {
      throw new Error('Expected an absolute path')
    }
    const parsed = parseEnv(readFileSync(file, 'utf8'))
    const result = { ...env }
    for (const key of TRACING_ENV_KEYS) {
      // 继承环境优先：只有进程环境未定义该变量时才用文件值。
      if (env[key] === undefined && parsed[key] !== undefined) {
        result[key] = parsed[key]
      }
    }
    notify('Langfuse configuration file loaded (values hidden).')
    return result
  } catch {
    notify(
      'Cannot read the Langfuse environment file. Check its absolute path and file permissions; inherited environment remains available.'
    )
    return { ...env }
  }
}
