// SP004 agent-observability §4.5：追踪配置加载。
// 只导入 5 个白名单变量；进程环境优先于用户指定的 env 文件。
// 不读取工作区设置，不扫描仓库 .env，不导入运行参数。
//
// 行为规格独立实现：文件读取与白名单合并拆为两个helper，
// 诊断经独立安全包装，控制流与参考实现不同。

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

const ALLOWLIST = new Set<string>(TRACING_ENV_KEYS)

/** 读取并解析显式 env 文件；非绝对路径或不可读时抛错。 */
function readEnvFile(file: string): Record<string, string | undefined> {
  if (!isAbsolute(file)) throw new Error('Expected an absolute path')
  return parseEnv(readFileSync(file, 'utf8'))
}

/** 合并白名单变量：仅当继承环境未定义该变量时才采用文件值。 */
function mergeAllowlisted(
  base: NodeJS.ProcessEnv,
  fileValues: Record<string, string | undefined>
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...base }
  for (const key of Object.keys(fileValues)) {
    if (!ALLOWLIST.has(key)) continue
    if (base[key] !== undefined) continue
    const value = fileValues[key]
    if (value === undefined) continue
    merged[key] = value
  }
  return merged
}

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
  const safeReport = (message: string): void => {
    try {
      report(message)
    } catch {
      /* 诊断不得中断启动 */
    }
  }
  if (typeof file !== 'string' || file.trim() === '') return { ...env }
  let fileValues: Record<string, string | undefined>
  try {
    fileValues = readEnvFile(file)
  } catch {
    safeReport(
      'Cannot read the Langfuse environment file. Check its absolute path and file permissions; inherited environment remains available.'
    )
    return { ...env }
  }
  safeReport('Langfuse configuration file loaded (values hidden).')
  return mergeAllowlisted(env, fileValues)
}
