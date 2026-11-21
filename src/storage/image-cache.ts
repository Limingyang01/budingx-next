// SP007 T8 — 图片附件缓存（design §4.4，AC MM-06）。
// 落盘 ~/.budingx/image-cache/<sessionId>/<id>.<ext>，私有权限（同 storage 0o700/0o600 纪律）；
// 内存 Map 上限 200 逐旧淘汰（LRU），磁盘文件保留供重显链接。
import { writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { imageCacheDir } from './paths.js'
import { ensurePrivateDirectory, restrictToOwner, PRIVATE_FILE_MODE } from './private-file.js'

export type ImageCacheEntry = {
  id: number
  mediaType: string
  path: string
  url: string
  bytes: number
}

export type ImageCache = {
  put(id: number, mediaType: string, data: Buffer): ImageCacheEntry
  get(id: number): ImageCacheEntry | undefined
  readonly size: number
  readonly directory: string
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

export const IMAGE_CACHE_MAX_ENTRIES = 200

export function createImageCache(options: { sessionId: string; home?: string; maxEntries?: number }): ImageCache {
  const directory = imageCacheDir(options.sessionId, options.home)
  const max = options.maxEntries ?? IMAGE_CACHE_MAX_ENTRIES
  // Map 插入序即 LRU 序：get/put 移到末尾，超限逐最旧。
  const entries = new Map<number, ImageCacheEntry>()
  return {
    directory,
    get size() {
      return entries.size
    },
    put(id, mediaType, data) {
      ensurePrivateDirectory(directory)
      const ext = EXT_BY_TYPE[mediaType] ?? 'bin'
      const path = join(directory, id + '.' + ext)
      writeFileSync(path, data, { mode: PRIVATE_FILE_MODE })
      try {
        chmodSync(path, PRIVATE_FILE_MODE)
      } catch {
        // POSIX mode best effort; Windows ACL below is the real protection.
      }
      restrictToOwner(path)
      const entry: ImageCacheEntry = { id, mediaType, path, url: pathToFileURL(path).href, bytes: data.length }
      entries.delete(id)
      entries.set(id, entry)
      while (entries.size > max) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
      return entry
    },
    get(id) {
      const entry = entries.get(id)
      if (!entry) return undefined
      entries.delete(id)
      entries.set(id, entry)
      return entry
    }
  }
}
