// SP004 T21 · 命令内受限编辑：只识别简单 `sed -i[-E|-r] 's/pat/repl/flags' file`（design §4.8）。
// 仅 s 命令；w/W/e/E/i/a/c/d 等一律拒绝；工作区外路径拒绝；产出 diff 并可登记 checkpoint。
import { readFileSync } from 'node:fs'
import type { DiffHunk } from '../workspace/diff.js'
import { diffLines, diffSummary } from '../workspace/diff.js'
import type { Workspace } from '../workspace/paths.js'
import type { CheckpointStore } from '../workspace/checkpoint.js'
import { writeWorkspaceFile, contentFingerprint } from '../workspace/write.js'

export type SedEditInfo = {
  /** 目标文件（模型提供，相对工作区或绝对路径）。 */
  filePath: string
  /** 正则模式（BRE，未转换）。 */
  pattern: string
  /** sed 替换文本（保留 & 与 \1 语义）。 */
  replacement: string
  /** 旗标，当前仅允许 g。 */
  flags: string
  /** 使用 -E / -r 扩展正则。 */
  extendedRegex: boolean
}

export type SedApplyResult =
  | {
      ok: true
      /** 工作区相对路径（统一正斜杠）。 */
      path: string
      before: string
      after: string
      diff: DiffHunk[]
      additions: number
      removals: number
      /** 替换未改变任何内容。 */
      unchanged: boolean
    }
  | { ok: false; reason: string }

const COMPOUND_OPERATORS = [';', '&', '|', '>', '<', '\n', '`', '$(']

/** 扫描引号外是否出现复合语句/重定向/命令替换字符。 */
function hasCompoundOperator(text: string): boolean {
  let quote: '"' | "'" | undefined
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string
    if (quote !== undefined) {
      if (char === '\\' && quote === '"') {
        index += 1
        continue
      }
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (COMPOUND_OPERATORS.includes(char)) return true
  }
  return quote !== undefined
}

/** 引号感知分词：单引号字面、双引号支持反斜杠转义；返回 undefined 表示不闭合。 */
function tokenize(text: string): string[] | undefined {
  const tokens: string[] = []
  let current = ''
  let started = false
  let quote: '"' | "'" | undefined
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string
    if (quote !== undefined) {
      if (char === '\\' && quote === '"' && index + 1 < text.length) {
        current += text[index + 1] as string
        index += 1
        continue
      }
      if (char === quote) {
        quote = undefined
        continue
      }
      current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (char === ' ' || char === '\t') {
      if (started || current.length > 0) {
        tokens.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += char
  }
  if (quote !== undefined) return undefined
  if (started || current.length > 0) tokens.push(current)
  return tokens
}

/** 解析短旗标串（-i / -E / -r 及其组合）；未知旗标返回 undefined。 */
function parseFlagsToken(token: string): { inPlace: boolean; extended: boolean } | undefined {
  let inPlace = false
  let extended = false
  for (const char of token.slice(1)) {
    if (char === 'i') inPlace = true
    else if (char === 'E' || char === 'r') extended = true
    else return undefined
  }
  return { inPlace, extended }
}

/** 拆分 sed s 命令脚本：s<delim>pattern<delim>replacement<delim>flags。 */
function parseSubstitute(
  script: string
): { pattern: string; replacement: string; flags: string } | undefined {
  if (!script.startsWith('s') || script.length < 4) return undefined
  const delimiter = script[1]
  if (delimiter === undefined || delimiter === '\\' || /[A-Za-z0-9]/.test(delimiter)) return undefined
  let index = 2
  const readSegment = (): string | undefined => {
    let out = ''
    while (index < script.length) {
      const char = script[index] as string
      if (char === '\\' && index + 1 < script.length) {
        const next = script[index + 1] as string
        // 转义的定界符按字面保留；其他转义保留给正则/替换语义。
        out += next === delimiter ? next : `\\${next}`
        index += 2
        continue
      }
      if (char === delimiter) {
        index += 1
        return out
      }
      out += char
      index += 1
    }
    return undefined
  }
  const pattern = readSegment()
  if (pattern === undefined || pattern.length === 0) return undefined
  const replacement = readSegment()
  if (replacement === undefined) return undefined
  const flags = script.slice(index)
  if (flags !== '' && flags !== 'g') return undefined
  return { pattern, replacement, flags }
}

/** 识别命令内受限编辑；非该形态返回 undefined（交由普通命令路径处理）。 */
export function parseSedEdit(command: string): SedEditInfo | undefined {
  const trimmed = command.trim()
  if (trimmed.length === 0) return undefined
  if (!/^sed(\s|$)/.test(trimmed)) return undefined
  if (hasCompoundOperator(trimmed)) return undefined
  const tokens = tokenize(trimmed)
  if (tokens === undefined || tokens.length === 0) return undefined
  if (tokens[0] !== 'sed') return undefined
  const rest = tokens.slice(1)

  let inPlace = false
  let extended = false
  let index = 0
  while (index < rest.length) {
    const token = rest[index] as string
    if (!token.startsWith('-') || token.length < 2) break
    if (token.startsWith('--')) return undefined
    const parsed = parseFlagsToken(token)
    if (parsed === undefined) return undefined
    inPlace = inPlace || parsed.inPlace
    extended = extended || parsed.extended
    index += 1
  }
  if (!inPlace) return undefined
  const script = rest[index]
  if (script === undefined) return undefined
  const substitute = parseSubstitute(script)
  if (substitute === undefined) return undefined
  const filePath = rest[index + 1]
  if (filePath === undefined || filePath.length === 0) return undefined
  // 只允许单一目标文件：多余参数（含备份后缀等）一律拒绝。
  if (index + 2 !== rest.length) return undefined
  return {
    filePath,
    pattern: substitute.pattern,
    replacement: substitute.replacement,
    flags: substitute.flags,
    extendedRegex: extended
  }
}

/** BRE → JS RegExp 源码：仅保留 sed 基础正则语义。 */
function breToJsSource(pattern: string): string {
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] as string
    if (char === '\\') {
      const next = pattern[index + 1]
      if (next === undefined) {
        source += '\\\\'
        break
      }
      if ('(){}+?|'.includes(next)) source += next
      else source += `\\${next}`
      index += 1
      continue
    }
    if ('(){}+?|'.includes(char)) {
      source += `\\${char}`
      continue
    }
    source += char
  }
  return source
}

/** sed 替换文本 → JS 替换文本（& 整段匹配，\1–\9 分组，转义 \& 为字面 &）。 */
function toJsReplacement(replacement: string): string {
  let result = ''
  for (let index = 0; index < replacement.length; index += 1) {
    const char = replacement[index] as string
    if (char === '\\' && index + 1 < replacement.length) {
      const next = replacement[index + 1] as string
      if (next >= '1' && next <= '9') result += `$${next}`
      else if (next === '&') result += '&'
      else if (next === '\\') result += '\\'
      else result += next
      index += 1
      continue
    }
    if (char === '&') {
      result += '$&'
      continue
    }
    result += char
  }
  return result
}

/** 校验目标文件位于工作区内且为已存在文件；不写盘、不抛异常。 */
export function validateSedEdit(
  info: SedEditInfo,
  workspace: Workspace
): { ok: boolean; reason?: string } {
  let resolved
  try {
    resolved = workspace.resolve(info.filePath)
  } catch {
    return { ok: false, reason: `目标文件不在工作区内：${info.filePath}` }
  }
  if (!resolved.existed) return { ok: false, reason: `目标文件不存在：${resolved.relative}` }
  if (resolved.isDirectory) return { ok: false, reason: `目标是目录而非文件：${resolved.relative}` }
  return { ok: true }
}

/** 应用受限编辑：写盘、产出 diff，并在提供 store 时登记 checkpoint。 */
export function applySedEdit(
  info: SedEditInfo,
  workspace: Workspace,
  options?: { checkpoint?: CheckpointStore; turnId?: string }
): SedApplyResult {
  const verdict = validateSedEdit(info, workspace)
  if (!verdict.ok) return { ok: false, reason: verdict.reason ?? '目标文件校验失败' }
  const resolved = workspace.resolve(info.filePath)
  const before = readFileSync(resolved.real, 'utf8')
  const source = info.extendedRegex ? info.pattern : breToJsSource(info.pattern)
  let regex: RegExp
  try {
    regex = new RegExp(source, info.flags)
  } catch {
    return { ok: false, reason: `无法解析替换正则：${info.pattern}` }
  }
  const jsReplacement = toJsReplacement(info.replacement)
  const lines = before.split('\n')
  const nextLines = lines.map((line) => line.replace(regex, jsReplacement))
  const after = nextLines.join('\n')
  const diff = diffLines(before, after)
  const summary = diffSummary(diff)
  if (after === before) {
    return {
      ok: true,
      path: resolved.relative,
      before,
      after,
      diff,
      additions: summary.additions,
      removals: summary.removals,
      unchanged: true
    }
  }
  const written = writeWorkspaceFile(workspace, {
    path: resolved.relative,
    content: after,
    expectedFingerprint: contentFingerprint(before)
  })
  options?.checkpoint?.record({
    path: resolved.relative,
    operation: 'update',
    before,
    after,
    diff,
    fingerprintAfter: written.fingerprint,
    ...(options.turnId !== undefined ? { turnId: options.turnId } : {})
  })
  return {
    ok: true,
    path: resolved.relative,
    before,
    after,
    diff,
    additions: summary.additions,
    removals: summary.removals,
    unchanged: false
  }
}