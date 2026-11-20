// SP006 §6.3 /export：把当前会话导出为 JSONL 或纯文本（CMD-11）。
// 路径必须显式且在 ~/.budingx 内，避免命令面变成任意路径写入通道。
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { Message } from '../core/events.js'
import { dataRoot, exportsDir } from '../storage/paths.js'

export type ExportFormat = 'jsonl' | 'text'

export type ExportOptions = {
  sessionId: string
  format: ExportFormat
  /** 显式给出的路径；相对路径按数据根解析，绝对路径必须位于数据根内。 */
  path?: string
  home?: string
  now?: Date
}

export type ExportResult =
  | { ok: true; path: string; bytes: number }
  | { ok: false; error: string }

export function serializeSession(messages: readonly Message[], format: ExportFormat): string {
  if (format === 'jsonl') {
    return messages.map((message) => JSON.stringify(message)).join('\n') + (messages.length ? '\n' : '')
  }
  const lines: string[] = []
  for (const message of messages) {
    const texts = message.blocks
      .filter((block): block is Extract<Message['blocks'][number], { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
    const body = texts.join('').trim()
    if (message.role === 'user') {
      if (body) lines.push('## 用户\n\n' + body, '')
    } else if (message.role === 'assistant') {
      if (body) lines.push('## 助手\n\n' + body, '')
      for (const block of message.blocks) {
        if (block.type === 'tool_use') lines.push(`> 工具调用：${block.name}`, '')
      }
    } else {
      for (const block of message.blocks) {
        if (block.type === 'tool_result') {
          lines.push(`> 工具结果${block.isError ? '（失败）' : ''}`, '', block.content, '')
        }
      }
    }
  }
  return lines.join('\n').trimEnd() + '\n'
}

function resolveExportPath(options: ExportOptions): ExportResult | string {
  const root = resolve(dataRoot(options.home))
  let target: string
  if (options.path && options.path.trim()) {
    const raw = options.path.trim()
    target = isAbsolute(raw) ? resolve(raw) : resolve(join(root, raw))
  } else {
    const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, '-')
    target = join(exportsDir(options.home), `${options.sessionId}-${stamp}.${options.format === 'jsonl' ? 'jsonl' : 'txt'}`)
  }
  const rel = relative(root, target)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, error: `导出路径必须位于 ${root} 内：${target}` }
  }
  return target
}

export function exportSession(messages: readonly Message[], options: ExportOptions): ExportResult {
  const target = resolveExportPath(options)
  if (typeof target !== 'string') return target
  if (existsSync(target)) return { ok: false, error: `导出目标已存在，未覆盖：${target}` }
  try {
    mkdirSync(dirname(target), { recursive: true })
    const content = serializeSession(messages, options.format)
    writeFileSync(target, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    return { ok: true, path: target, bytes: Buffer.byteLength(content) }
  } catch (error) {
    return { ok: false, error: `导出失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** 默认导出目录，命令帮助里展示给用户。 */
export function defaultExportDir(home?: string): string {
  return exportsDir(home ?? homedir())
}
