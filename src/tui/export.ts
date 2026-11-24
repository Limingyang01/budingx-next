// /export：把当前或已保存会话导出为 JSONL、纯文本或 Markdown。
// 路径必须显式且在 ~/.budingx 内，避免命令面变成任意路径写入通道。
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import type { ChangeRecordSummary, Message } from '../core/events.js'
import { redactContent } from '../observability/redact.js'
import { dataRoot, exportsDir } from '../storage/paths.js'

export type ExportFormat = 'jsonl' | 'text' | 'markdown'

export type ExportOptions = {
  sessionId: string
  format: ExportFormat
  /** 显式给出的路径；相对路径按数据根解析，绝对路径必须位于数据根内。 */
  path?: string
  home?: string
  now?: Date
  title?: string
  changes?: readonly ChangeRecordSummary[]
  knownSecrets?: readonly string[]
}

export type ExportResult =
  | { ok: true; path: string; bytes: number }
  | { ok: false; error: string }

function markdownInline(text: string): string {
  return text.replace(/[\r\n\p{Cc}]+/gu, ' ').replace(/[\\`*_{}\[\]()#+.!<>|]/g, '\\$&')
}

export function serializeSession(
  messages: readonly Message[],
  format: ExportFormat,
  options: Pick<ExportOptions, 'title' | 'changes' | 'knownSecrets'> = {}
): string {
  const clean = messages.map((message) => redactContent({
    ...message,
    blocks: message.notificationDisplay
      ? [{ type: 'text', text: message.notificationDisplay }]
      : message.blocks.filter((block) => block.type !== 'context' || !block.source.startsWith('skill:'))
  }, options.knownSecrets) as Message)
  if (format === 'jsonl') {
    return clean.map((message) => JSON.stringify(message)).join('\n') + (clean.length ? '\n' : '')
  }
  const lines: string[] = []
  if (format === 'markdown') {
    const title = String(redactContent(options.title ?? '会话导出', options.knownSecrets))
    lines.push('# ' + markdownInline(title), '')
  }
  for (const message of clean) {
    const texts = message.blocks
      .filter((block): block is Extract<Message['blocks'][number], { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
    const body = texts.join('').trim()
    if (message.notificationDisplay) {
      lines.push('> ' + markdownInline(message.notificationDisplay), '')
    } else if (message.role === 'user') {
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
  if (format === 'markdown') {
    lines.push('## 会话代码改动', '')
    if (!options.changes?.length) {
      lines.push('没有可归属到此会话的已保存文件改动证据。', '')
    } else {
      for (const change of options.changes) {
        const path = markdownInline(String(redactContent(change.path, options.knownSecrets)))
        lines.push(`- ${path} · ${change.operation === 'create' ? '创建' : '修改'}（+${change.additions} / −${change.removals}）`)
      }
    }
  }
  return lines.join('\n').trimEnd() + '\n'
}

function within(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)
}

function resolveExportPath(options: ExportOptions): ExportResult | string {
  const root = resolve(dataRoot(options.home))
  let target: string
  if (options.path && options.path.trim()) {
    const raw = options.path.trim()
    target = isAbsolute(raw) ? resolve(raw) : resolve(join(root, raw))
  } else {
    const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, '-')
    const extension = { jsonl: 'jsonl', text: 'txt', markdown: 'md' }[options.format]
    target = join(exportsDir(options.home), `${options.sessionId}-${stamp}.${extension}`)
  }
  if (root === target || !within(root, target)) {
    return { ok: false, error: `导出路径必须位于 ${root} 内：${target}` }
  }
  return target
}

export function exportSession(messages: readonly Message[], options: ExportOptions): ExportResult {
  const target = resolveExportPath(options)
  if (typeof target !== 'string') return target
  if (existsSync(target)) return { ok: false, error: `导出目标已存在，未覆盖：${target}` }
  try {
    const root = resolve(dataRoot(options.home))
    mkdirSync(root, { recursive: true, mode: 0o700 })
    const physicalRoot = realpathSync(root)
    let existingParent = dirname(target)
    while (!existsSync(existingParent) && existingParent !== root) existingParent = dirname(existingParent)
    if (!within(physicalRoot, realpathSync(existingParent))) {
      return { ok: false, error: '导出目录链接指向数据根之外' }
    }
    mkdirSync(dirname(target), { recursive: true })
    if (!within(physicalRoot, realpathSync(dirname(target)))) {
      return { ok: false, error: '导出目录链接指向数据根之外' }
    }
    const content = serializeSession(messages, options.format, options)
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
