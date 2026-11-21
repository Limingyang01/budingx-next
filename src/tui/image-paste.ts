// SP007 T8 — 图片粘贴与路径附件（design §4.4，AC MM-02/MM-03/MM-10）。
// 剪贴板：Windows PowerShell Get-Clipboard -Format Image→临时 PNG→读字节→fire-and-forget 删；
// Linux xclip/wl-paste、macOS osascript 尽力而为（本机 Windows 验证，其他 UNVERIFIED）。
// 路径附件：识别输入中的图片路径 token（去外层引号＋还原双反斜杠转义），读文件失败明确报错。
import { execFileSync } from 'node:child_process'
import { readFileSync, unlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'

// 图片路径形态：任何不含空白/引号/常见中英文标点的 run 收尾于图片扩展名。
// 中文没有空格分词，说明文字常紧贴路径，因此保留 run 从左剥离的能力（glue）。
const IMAGE_PATH_PATTERN = /[^\s"'<>|`，。；：！？、（）【】「」《》〔〕…]*\.(?:png|jpe?g|gif|webp)(?![A-Za-z0-9_])/gi
// 引号内路径可含空格（Windows 常见），单独先扫。
const QUOTED_PATTERN = /"([^"\n]{1,2048})"|'([^'\n]{1,2048})'/g
// 明确的本地路径前缀：盘符、UNC、根/相对分隔符。
const EXPLICIT_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|[\\/]|\.{1,2}[\\/])/
const URL_LIKE = /^(?:https?|data|ftp):\/\//i
const PS_BACKTICK = String.fromCharCode(96)

export type ImagePathMatch = { path: string; token: string }

const MEDIA_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

export function mediaTypeOf(path: string): string | undefined {
  return MEDIA_BY_EXT[extname(path).toLowerCase()]
}

/** 去外层引号＋还原双反斜杠/引号转义（单反斜杠路径分隔符保留）。 */
function cleanToken(raw: string): string {
  let value = raw
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  return value.replace(/\\\\/g, '\\').replace(/\\"/g, '"').replace(/\\'/g, "'")
}

/**
 * 从候选串里定位真实文件：先按原样试，再从左侧逐字剥离说明文字（最多 64 个字符）。
 * 中文说明常与路径直接相邻（无空格），剥离后命中已存在文件即认定。
 */
function resolveExistingCandidate(candidate: string): { path: string; glue: number } | undefined {
  if (existsSync(candidate)) return { path: candidate, glue: 0 }
  const limit = Math.min(candidate.length - 1, 64)
  for (let glue = 1; glue <= limit; glue += 1) {
    const rest = candidate.slice(glue)
    if (!rest || rest[0] !== candidate[glue]) break
    if (!/\.(?:png|jpe?g|gif|webp)(?![A-Za-z0-9_])/i.test(rest)) break
    if (existsSync(rest)) return { path: rest, glue }
  }
  return undefined
}

/** cleanToken 会折叠转义对，把「清洗后」的下标映射回原始 run 下标。 */
function rawIndexForCleaned(raw: string, cleanedIndex: number): number {
  let ci = 0
  let ri = 0
  while (ri < raw.length && ci < cleanedIndex) {
    if (raw[ri] === '\\' && (raw[ri + 1] === '\\' || raw[ri + 1] === '"' || raw[ri + 1] === "'")) ri += 2
    else ri += 1
    ci += 1
  }
  return ri
}

/**
 * 判定一个路径形态的候选（run 内匹配到的子串）：已存在或形如明确本地路径才认作图片附件。
 * 形如路径但不存在 → 保留，提交时明确报「无法读取」（MM-10），不假装已读。
 * 裸文件名且不存在 → 当普通文本，避免「为什么 a.png 没加载」这类叙述阻塞发送。
 */
function acceptCandidate(raw: string): ImagePathMatch | undefined {
  const candidate = cleanToken(raw)
  if (!candidate || URL_LIKE.test(candidate)) return undefined
  const found = resolveExistingCandidate(candidate)
  if (found) {
    const token = found.glue > 0 ? raw.slice(rawIndexForCleaned(raw, found.glue)) : raw
    return { path: found.path, token }
  }
  if (EXPLICIT_PATH.test(candidate) || /[\\/]/.test(candidate)) return { path: candidate, token: raw }
  return undefined
}

/** 从输入文本提取图片路径 token（MM-03）。 */
export function extractImagePaths(text: string): ImagePathMatch[] {
  const matches: ImagePathMatch[] = []
  const seen = new Set<string>()
  const push = (match: ImagePathMatch | undefined) => {
    if (!match || seen.has(match.path)) return
    seen.add(match.path)
    matches.push(match)
  }
  // 引号内路径优先（可含空格），并从后续扫描中挖空，避免重复识别。
  let remainder = text
  for (const quote of text.matchAll(QUOTED_PATTERN)) {
    const inner = quote[1] ?? quote[2] ?? ''
    const innerMatch = inner.match(IMAGE_PATH_PATTERN)?.[0]
    if (innerMatch) {
      const accepted = acceptCandidate(innerMatch)
      if (accepted) push({ path: accepted.path, token: quote[0] })
    }
    const start = quote.index ?? 0
    remainder = remainder.slice(0, start) + ' '.repeat(quote[0].length) + remainder.slice(start + quote[0].length)
  }
  for (const found of remainder.matchAll(IMAGE_PATH_PATTERN)) {
    push(acceptCandidate(found[0]))
  }
  return matches
}

/** 提交时从文本移除已附件的路径 token（MM-03）。 */
export function stripImageTokens(text: string, paths: readonly string[]): string {
  const set = new Set(paths)
  let out = text
  for (const match of extractImagePaths(text)) {
    if (!set.has(match.path)) continue
    const index = out.indexOf(match.token)
    if (index >= 0) out = out.slice(0, index) + ' ' + out.slice(index + match.token.length)
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim()
}

export type ClipboardImage = { data: Buffer; mediaType: string }

/**
 * 读取系统剪贴板图片（MM-02）。无图返回 undefined（调用方明确提示）。
 * 非 Windows 平台尽力而为；失败不抛错，返回 undefined。
 */
export function readClipboardImage(): ClipboardImage | undefined {
  if (process.platform === 'win32') {
    const temp = join(tmpdir(), 'budingx-clipboard-' + randomUUID() + '.png')
    const escaped = temp.replace(/"/g, PS_BACKTICK + '"')
    const script =
      'Add-Type -AssemblyName System.Drawing; ' +
      '$img = Get-Clipboard -Format Image; ' +
      'if ($null -eq $img) { exit 2 }; ' +
      '$img.Save("' + escaped + '", [System.Drawing.Imaging.ImageFormat]::Png)'
    try {
      execFileSync('powershell.exe', ['-NonInteractive', '-NoProfile', '-Command', script], { stdio: 'ignore', windowsHide: true, timeout: 5000 })
    } catch {
      return undefined
    }
    try {
      if (!existsSync(temp)) return undefined
      const data = readFileSync(temp)
      return data.length > 0 ? { data, mediaType: 'image/png' } : undefined
    } catch {
      return undefined
    } finally {
      try {
        unlinkSync(temp)
      } catch {
        // fire-and-forget cleanup
      }
    }
  }
  if (process.platform === 'darwin') {
    const temp = join(tmpdir(), 'budingx-clipboard-' + randomUUID() + '.png')
    try {
      execFileSync('osascript', ['-e', 'set png to (the clipboard as «class PNGf»)', '-e', 'set f to open for access POSIX file "' + temp + '" with write permission', '-e', 'write png to f', '-e', 'close access f'], { stdio: 'ignore' })
      const data = readFileSync(temp)
      return data.length > 0 ? { data, mediaType: 'image/png' } : undefined
    } catch {
      return undefined
    } finally {
      try {
        unlinkSync(temp)
      } catch {
        // best effort
      }
    }
  }
  // Linux：xclip / wl-paste 尽力而为
  for (const attempt of [
    { command: 'wl-paste', args: ['--type', 'image/png'] },
    { command: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/png', '-o'] }
  ]) {
    try {
      const data = execFileSync(attempt.command, attempt.args, { stdio: ['ignore', 'pipe', 'ignore'] })
      if (data.length > 0) return { data, mediaType: 'image/png' }
    } catch {
      // try next
    }
  }
  return undefined
}

/** 读取图片路径附件（MM-03/MM-10）：失败明确抛错，不假装已读。 */
export function readImageFile(path: string): ClipboardImage {
  const mediaType = mediaTypeOf(path)
  if (!mediaType) throw new Error('不支持的图片类型：' + path + '（仅 png/jpg/jpeg/gif/webp）')
  let data: Buffer
  try {
    data = readFileSync(path)
  } catch (error) {
    throw new Error('无法读取图片 ' + path + '：' + String((error as Error).message))
  }
  if (data.length === 0) throw new Error('图片文件为空：' + path)
  return { data, mediaType }
}
