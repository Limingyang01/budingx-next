// SP007 T8 — 图片粘贴与路径附件（design §4.4，AC MM-02/MM-03/MM-10）。
// 剪贴板：Windows PowerShell Get-Clipboard -Format Image→临时 PNG→读字节→fire-and-forget 删；
// Linux xclip/wl-paste、macOS osascript 尽力而为（本机 Windows 验证，其他 UNVERIFIED）。
// 路径附件：识别输入中的图片路径 token（去外层引号＋还原双反斜杠转义），读文件失败明确报错。
import { execFileSync } from 'node:child_process'
import { readFileSync, unlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp)$/i
const TOKEN_PATTERN = /"[^"]*"|'[^']*'|\S+/g
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

/** 从输入文本提取图片路径 token（MM-03）。 */
export function extractImagePaths(text: string): ImagePathMatch[] {
  const matches: ImagePathMatch[] = []
  for (const raw of text.match(TOKEN_PATTERN) ?? []) {
    const path = cleanToken(raw)
    if (IMAGE_EXTENSION.test(path)) matches.push({ path, token: raw })
  }
  return matches
}

/** 提交时从文本移除已附件的路径 token（MM-03）。 */
export function stripImageTokens(text: string, paths: readonly string[]): string {
  const set = new Set(paths)
  return text
    .replace(TOKEN_PATTERN, (raw) => (set.has(cleanToken(raw)) ? '' : raw))
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
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
      execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore' })
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
