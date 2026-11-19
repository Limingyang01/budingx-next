// SP004 T15 · 生产宿主的计划模式集成（设计 §6.1/§6.2/§6.3）。
// 计划正文落盘在 ~/.budingx/plans/<sessionId>/<planId>.md；批准指纹绑定
// 工作区根、Git HEAD 与计划里显式提到的目标文件前像，避免跨外部改动误批。
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import {
  isPlanTargetPaths,
  type Plan, type PlanDriftItem, type PlanModeHost, type PlanModeSnapshot
} from '../core/plan.js'
import { MAX_READ_RANGE_BYTES } from '../workspace/constants.js'
import { isCredentialLike } from '../workspace/policy.js'
import type { ResolvedPath, Workspace } from '../workspace/paths.js'
import { createPlanStore } from './store.js'
import { parsePlan, planFilePath } from './serialize.js'
import { validateBeforeExecute } from './validate.js'

export type PlanModeHostOptions = {
  sessionId: string
  workspace: Workspace
  /** 用户数据根（测试注入）；缺省 ~/.budingx。 */
  home?: string
  now?: () => number
  canReadPath?(path: string): boolean
}

// Markdown code spans, link destinations, quoted paths, then unquoted path tokens.
const FILE_REFERENCE =
  /`+([^`\r\n]+)`+|\[[^\]\r\n]*\]\((<[^<>\r\n]+>|[^)\r\n]+)\)|"([^"\r\n]+)"|'([^'\r\n]+)'|“([^”\r\n]+)”|‘([^’\r\n]+)’|([\p{L}\p{M}\p{N}_@./\\-]+\.[\p{L}\p{N}]+)(?![\p{L}\p{M}\p{N}_@./\\-])/gu
const FILE_SUFFIX = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|txt|py|go|rs|java|kt|css|html|sh|yml|yaml)$/iu
const MISSING_FILE = '(缺失)'
const UNAVAILABLE_FILE = '(无法读取)'

function normalizePlanPath(raw: string): string | undefined {
  const path = raw.trim().replace(/\\/g, '/')
  if (path.startsWith('/') || /[:<>?"|*\p{Cc}]/u.test(path)) return undefined
  const parts = path.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.length === 0 || parts.includes('..')) return undefined
  return parts.join('/')
}

function* markdownPlanPaths(text: string): Iterable<string> {
  for (const match of text.matchAll(FILE_REFERENCE)) {
    const [, codeSpan, link, doubleQuote, singleQuote, doubleCurlyQuote, singleCurlyQuote, bare] = match
    let path = codeSpan ?? doubleQuote ?? singleQuote ?? doubleCurlyQuote ?? singleCurlyQuote ?? bare
    if (link !== undefined) {
      const destination = link.trim()
      try {
        const target = destination.startsWith('<')
          ? destination.slice(1, -1)
          : destination.replace(/\s+["'][^"']*["']$/, '')
        path = decodeURIComponent(target.split('#', 1)[0])
      } catch {
        continue
      }
    }
    if (FILE_SUFFIX.test(path.trim())) yield path
  }
}

function isProtectedPlanPath(path: string): boolean {
  return path.split('/').some((part) =>
    ['.git', '.budingx', '.claude'].includes(part.toLowerCase()) || isCredentialLike(part))
}

/** 生产宿主的 PlanModeHost：计划文件 + 工作区/Git 快照 + 执行前校验。 */
export function createPlanModeHost(options: PlanModeHostOptions): PlanModeHost & {
  writePlanText(text: string, goal: string, steps: string[], targetPaths?: readonly string[]): Plan
} {
  const planId = `plan-${options.sessionId}`
  const filePath = planFilePath(options.sessionId, planId, options.home)

  function loadPlanText(): string {
    const text = readFileSync(filePath, 'utf8')
    if (/^---\r?\n/.test(text)) return parsePlan(text).draftText ?? text
    return text
  }

  function readPlanText(): Promise<string | undefined> {
    try {
      return Promise.resolve(loadPlanText())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Promise.resolve(undefined)
      return Promise.reject(error)
    }
  }

  function gitHead(root: string): string | undefined {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim() || undefined
    } catch {
      return undefined
    }
  }

  function resolveTarget(path: string): ResolvedPath | undefined {
    if (isProtectedPlanPath(path) || options.canReadPath?.(path) === false) return undefined
    try {
      const target = options.workspace.resolve(path)
      if (target.isDirectory || !target.relative || isProtectedPlanPath(target.relative) ||
        (target.relative !== path && options.canReadPath?.(target.relative) === false)) return undefined
      return target
    } catch {
      return undefined
    }
  }

  function fingerprint(path: string, target: ResolvedPath): string {
    if (!target.existed) return MISSING_FILE
    try {
      const status = statSync(target.real)
      if (!status.isFile() || status.size > MAX_READ_RANGE_BYTES) return UNAVAILABLE_FILE
      const hash = createHash('sha256')
      // Keep the lexical key and bind symlink target identity as well as bytes.
      if (path !== target.relative) hash.update(target.relative).update('\0')
      return hash.update(readFileSync(target.real)).digest('hex')
    } catch {
      return UNAVAILABLE_FILE
    }
  }

  function snapshot(
    planText?: string,
    targetPaths: readonly string[] = planText === undefined ? store.current()?.targetPaths ?? [] : []
  ): PlanModeSnapshot {
    const root = options.workspace.root
    const files = new Map<string, string>()
    const text = planText ?? (() => {
      try {
        return loadPlanText()
      } catch {
        return ''
      }
    })()
    for (const raw of targetPaths) {
      const path = normalizePlanPath(raw)
      const target = path ? resolveTarget(path) : undefined
      files.set(path ?? raw, path && target ? fingerprint(path, target) : UNAVAILABLE_FILE)
    }
    for (const raw of markdownPlanPaths(text)) {
      const path = normalizePlanPath(raw)
      if (!path || files.has(path)) continue
      const target = resolveTarget(path)
      if (target) files.set(path, fingerprint(path, target))
    }
    const head = gitHead(root)
    return { root, ...(head !== undefined ? { head } : {}), files: Object.fromEntries(files) }
  }

  function diff(baseline: PlanModeSnapshot, current: PlanModeSnapshot, strictFiles = false): PlanDriftItem[] {
    const drift: PlanDriftItem[] = []
    if (baseline.root !== current.root) {
      drift.push({ item: 'root', expected: baseline.root, actual: current.root })
    }
    if ((baseline.head ?? '') !== (current.head ?? '')) {
      drift.push({ item: 'head', expected: baseline.head ?? '(无)', actual: current.head ?? '(无)' })
    }
    // 只比较基线已知的目标文件：调研期计划正文新增引用的文件属于「新目标」，
    // 由批准指纹与执行前校验（validate）覆盖，不当作研究期漂移。
    const paths = strictFiles
      ? new Set([...Object.keys(baseline.files), ...Object.keys(current.files)])
      : Object.keys(baseline.files)
    for (const path of [...paths].sort()) {
      const before = Object.hasOwn(baseline.files, path) ? baseline.files[path] : undefined
      const after = Object.hasOwn(current.files, path) ? current.files[path] : undefined
      if (before !== after) {
        drift.push({ item: `files:${path}`, expected: before ?? '(缺失)', actual: after ?? '(缺失)' })
      }
    }
    return drift
  }

  const store = createPlanStore({
    snapshot,
    id: () => planId,
    filePath,
    ...(options.now !== undefined ? { now: options.now } : {})
  })

  return {
    store,
    readPlanText,
    writePlanText(text, goal, steps, targetPaths) {
      if (targetPaths !== undefined && !isPlanTargetPaths(targetPaths)) throw new Error('无效的计划 targetPaths')
      const paths = [...new Set(targetPaths?.map((raw) => {
        const path = normalizePlanPath(raw)
        const target = path ? resolveTarget(path) : undefined
        if (!path || !target || fingerprint(path, target) === UNAVAILABLE_FILE) {
          throw new Error(`targetPaths 必须指向工作区内可读取的文件：${raw}`)
        }
        return path
      }))]
      return store.create(goal, steps.map((title) => ({ title })), text, targetPaths !== undefined ? paths : undefined)
    },
    snapshot,
    diff,
    validate(plan) {
      const current = snapshot(plan.approvedText ?? plan.draftText, plan.targetPaths)
      const checked = validateBeforeExecute(plan, current)
      if (!checked.ok) return checked
      const drift = Object.entries(current.files).filter(([, value]) => value === UNAVAILABLE_FILE)
        .map(([path]) => ({ item: `files:${path}`, expected: '可核验的文件', actual: UNAVAILABLE_FILE }))
      return { ok: drift.length === 0, drift }
    }
  }
}

/** 生产计划文件路径（测试与诊断用）。 */
export function planModeFilePath(sessionId: string, home?: string): string {
  return planFilePath(sessionId, `plan-${sessionId}`, home)
}
