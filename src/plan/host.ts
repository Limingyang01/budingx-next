// SP004 T15 · 生产宿主的计划模式集成（设计 §6.1/§6.2/§6.3）。
// 计划正文落盘在 ~/.budingx/plans/<sessionId>/<planId>.md；批准指纹绑定
// 工作区根、Git HEAD 与计划里显式提到的目标文件前像，避免跨外部改动误批。
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import type { Plan, PlanDriftItem, PlanModeHost, PlanModeSnapshot } from '../core/plan.js'
import { createPlanStore } from './store.js'
import { parsePlan, planFilePath } from './serialize.js'
import { validateBeforeExecute } from './validate.js'
import type { Workspace } from '../workspace/paths.js'

export type PlanModeHostOptions = {
  sessionId: string
  workspace: Workspace
  /** 用户数据根（测试注入）；缺省 ~/.budingx。 */
  home?: string
  now?: () => number
}

/** 计划正文里显式提到的文件：只给这些文件做前像指纹，避免扫描整仓。 */
const FILE_REFERENCE =
  /[\w@./-]*[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|go|rs|java|kt|css|html|sh|yml|yaml)/g

function toPosix(path: string): string {
  return path.split('\\').join('/')
}

function digest(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

/** 生产宿主的 PlanModeHost：计划文件 + 工作区/Git 快照 + 执行前校验。 */
export function createPlanModeHost(options: PlanModeHostOptions): PlanModeHost & {
  writePlanText(text: string, goal: string, steps: string[]): Plan
} {
  const root = options.workspace.root
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

  function gitHead(): string | undefined {
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

  function fingerprint(relativePath: string): string | undefined {
    let resolved
    try {
      resolved = options.workspace.resolve(relativePath)
    } catch {
      return undefined
    }
    if (!resolved.existed || resolved.isDirectory) return undefined
    try {
      return digest(readFileSync(resolved.real))
    } catch {
      return undefined
    }
  }

  function resolveRelative(candidate: string): string | undefined {
    try {
      const resolved = options.workspace.resolve(candidate)
      const relativePath = toPosix(relative(root, resolved.real))
      if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) return undefined
      return relativePath
    } catch {
      return undefined
    }
  }

  function snapshot(planText?: string): PlanModeSnapshot {
    const files: Record<string, string> = {}
    const text = planText ?? (() => {
      try {
        return loadPlanText()
      } catch {
        return ''
      }
    })()
    for (const match of text.matchAll(FILE_REFERENCE)) {
      const candidate = toPosix(match[0].replace(/^\.\//, ''))
      if (candidate === '' || isAbsolute(candidate)) continue
      const relativePath = resolveRelative(candidate)
      if (relativePath === undefined) continue
      const value = fingerprint(candidate)
      if (value !== undefined) files[relativePath] = value
    }
    const head = gitHead()
    return { root, ...(head !== undefined ? { head } : {}), files }
  }

  function diff(baseline: PlanModeSnapshot, current: PlanModeSnapshot): PlanDriftItem[] {
    const drift: PlanDriftItem[] = []
    if (baseline.root !== current.root) {
      drift.push({ item: 'root', expected: baseline.root, actual: current.root })
    }
    if ((baseline.head ?? '') !== (current.head ?? '')) {
      drift.push({ item: 'head', expected: baseline.head ?? '(无)', actual: current.head ?? '(无)' })
    }
    // 只比较基线已知的目标文件：调研期计划正文新增引用的文件属于「新目标」，
    // 由批准指纹与执行前校验（validate）覆盖，不当作研究期漂移。
    for (const path of Object.keys(baseline.files).sort()) {
      const before = baseline.files[path]
      const after = current.files[path]
      if (after === undefined) {
        drift.push({ item: `files:${path}`, expected: before, actual: '(缺失)' })
      } else if (before !== after) {
        drift.push({ item: `files:${path}`, expected: before, actual: after })
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
    writePlanText(text, goal, steps) {
      return store.create(goal, steps.map((title) => ({ title })), text)
    },
    snapshot,
    diff,
    validate: (plan) => validateBeforeExecute(plan, snapshot(plan.approvedText ?? plan.draftText))
  }
}

/** 生产计划文件路径（测试与诊断用）。 */
export function planModeFilePath(sessionId: string, home?: string): string {
  return planFilePath(sessionId, `plan-${sessionId}`, home)
}
