import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { hooksPath } from '../../storage/paths.js'
import { HOOK_EVENTS, type HookConfig, type HookHandler, type HookMatcher, type LoadedHooks } from './types.js'

function backupCorrupt(path: string): string | undefined {
  const base = path + '.bak'
  let target = base
  let index = 1
  while (existsSync(target)) target = base + '.' + index++
  try {
    copyFileSync(path, target)
    return target
  } catch {
    return undefined
  }
}

function normalizeHandler(raw: any, event: string, warnings: string[]): HookHandler | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  if (raw.type === 'command') {
    if (typeof raw.command !== 'string' || raw.command.trim() === '') {
      warnings.push('hook 配置缺少 command，已忽略：' + event)
      return undefined
    }
    return {
      type: 'command',
      command: raw.command,
      ...(typeof raw.timeout === 'number' && raw.timeout > 0 ? { timeout: raw.timeout } : {})
    }
  }
  if (raw.type === 'prompt') {
    if (typeof raw.prompt !== 'string' || raw.prompt.trim() === '') {
      warnings.push('hook 配置缺少 prompt，已忽略：' + event)
      return undefined
    }
    return {
      type: 'prompt',
      prompt: raw.prompt,
      ...(typeof raw.timeout === 'number' && raw.timeout > 0 ? { timeout: raw.timeout } : {})
    }
  }
  // http / agent 本轮不实现（设计 §9.3 第 1 条，OPEN）。
  warnings.push('不支持的 hook 处理器类型，已忽略：' + String(raw.type) + '（' + event + '）')
  return undefined
}

function normalizeMatchers(raw: any, event: string, warnings: string[]): HookMatcher[] | undefined {
  if (raw === false) return undefined
  if (!Array.isArray(raw)) {
    warnings.push('hook 事件配置不是数组，已忽略：' + event)
    return undefined
  }
  const out: HookMatcher[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      warnings.push('hook matcher 无效，已忽略：' + event)
      continue
    }
    if (entry.enabled === false) continue
    const list = Array.isArray(entry.hooks) ? entry.hooks : []
    const hooks = list
      .map((handler: any) => normalizeHandler(handler, event, warnings))
      .filter((handler: HookHandler | undefined): handler is HookHandler => handler !== undefined)
    if (hooks.length === 0) continue
    out.push({
      ...(typeof entry.matcher === 'string' ? { matcher: entry.matcher } : {}),
      hooks
    })
  }
  return out
}

/** HK-08：损坏隔离——不启用损坏处理器、备份原文件、返回明确提示。 */
export function loadHooksConfig(homeDir?: string): LoadedHooks {
  const path = hooksPath(homeDir)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { config: {}, warnings: [] }
    return { config: {}, warnings: ['hooks 配置读取失败：' + path], corrupt: true }
  }
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    const backupPath = backupCorrupt(path)
    return {
      config: {},
      warnings: [
        'hooks 配置不是有效 JSON，已停用全部 hooks：' + path +
          (backupPath ? '（备份：' + backupPath + '）' : '')
      ],
      corrupt: true,
      ...(backupPath ? { backupPath } : {})
    }
  }
  const rawHooks = parsed?.hooks
  if (!rawHooks || typeof rawHooks !== 'object') {
    const backupPath = backupCorrupt(path)
    return {
      config: {},
      warnings: ['hooks 配置缺少 hooks 对象，已停用全部 hooks：' + path],
      corrupt: true,
      ...(backupPath ? { backupPath } : {})
    }
  }
  const warnings: string[] = []
  const config: HookConfig = {}
  for (const [event, raw] of Object.entries(rawHooks)) {
    if (!HOOK_EVENTS.includes(event as any)) {
      warnings.push('未知 hook 事件，已忽略：' + event)
      continue
    }
    const matchers = normalizeMatchers(raw, event, warnings)
    if (matchers) config[event as keyof HookConfig] = matchers
  }
  return { config, warnings }
}
