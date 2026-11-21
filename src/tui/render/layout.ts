import stringWidth from 'string-width'

/** 四区标识：顺序即渲染顺序，由 planLayout 保证。 */
export type RegionId = 'header' | 'transcript' | 'input' | 'footer'

export interface RegionSpec {
  id: RegionId
  minHeight: number
  maxHeight: number
  flexible: boolean
}

export interface LayoutInput {
  columns: number
  rows: number
  regions: RegionSpec[]
}

export interface LayoutPlan {
  regions: { id: RegionId; top: number; height: number }[]
  totalHeight: number
  overflow: 'none' | 'transcript' | 'input'
}

const REGION_ORDER: RegionId[] = ['header', 'transcript', 'input', 'footer']

export const DEFAULT_REGIONS: RegionSpec[] = [
  { id: 'header', minHeight: 0, maxHeight: 10, flexible: false },
  { id: 'transcript', minHeight: 1, maxHeight: Number.POSITIVE_INFINITY, flexible: true },
  { id: 'input', minHeight: 3, maxHeight: 12, flexible: false },
  { id: 'footer', minHeight: 1, maxHeight: 1, flexible: false },
]

export interface RegionOptions {
  headerVisible?: boolean
  headerHeight?: number
}

/** 按可见性生成区域规格：首屏仅在消息区为空时占行。 */
export function regionsFor(options: RegionOptions = {}): RegionSpec[] {
  const headerHeight = options.headerVisible === false ? 0 : Math.max(0, options.headerHeight ?? 6)
  return [
    { id: 'header', minHeight: headerHeight, maxHeight: headerHeight, flexible: false },
    { id: 'transcript', minHeight: 1, maxHeight: Number.POSITIVE_INFINITY, flexible: true },
    { id: 'input', minHeight: 3, maxHeight: 12, flexible: false },
    { id: 'footer', minHeight: 1, maxHeight: 1, flexible: false },
  ]
}

/** 宽度感知的显示宽度（CJK 双宽），供布局与状态栏截断复用。 */
export function displayWidth(text: string): number {
  return stringWidth(text)
}

/**
 * 纯函数布局：区域顺序固定，剩余高度给 flexible 区域；
 * 不足时先压消息区（最低 1 行），输入区不低于 3 行、页脚恒 1 行。
 */
export function planLayout(input: LayoutInput): LayoutPlan {
  const rows = Math.max(1, Math.floor(input.rows))
  const specs = normalizeSpecs(input.regions)
  const heights = new Map<RegionId, number>()
  let used = 0
  for (const spec of specs) {
    const height = Math.max(0, spec.minHeight)
    heights.set(spec.id, height)
    used += height
  }

  let overflow: LayoutPlan['overflow'] = 'none'
  if (used > rows) {
    // 先压缩消息区到 1 行，其余区域保持最小值（输入区/页脚受保护）。
    const transcript = specs.find((spec) => spec.id === 'transcript')
    const current = heights.get('transcript') ?? 0
    if (transcript) {
      const floor = Math.min(1, current)
      const next = Math.max(floor, current - (used - rows))
      heights.set('transcript', next)
      used += next - current
    }
    if (used > rows) overflow = 'transcript'
  } else {
    let extra = rows - used
    for (const spec of specs) {
      if (!spec.flexible || extra <= 0) continue
      const current = heights.get(spec.id) ?? 0
      const room = Math.max(0, spec.maxHeight - current)
      const give = Math.min(room, extra)
      if (give > 0) {
        heights.set(spec.id, current + give)
        used += give
        extra -= give
      }
    }
  }

  let top = 0
  const regions = specs.map((spec) => {
    const height = heights.get(spec.id) ?? 0
    const region = { id: spec.id, top, height }
    top += height
    return region
  })

  return { regions, totalHeight: top, overflow }
}

function normalizeSpecs(regions: RegionSpec[]): RegionSpec[] {
  const byId = new Map(regions.map((region) => [region.id, region]))
  const normalized: RegionSpec[] = []
  for (const id of REGION_ORDER) {
    const spec = byId.get(id)
    if (spec) {
      normalized.push({
        id,
        minHeight: Math.max(0, spec.minHeight),
        maxHeight: Math.max(0, spec.maxHeight),
        flexible: Boolean(spec.flexible),
      })
      byId.delete(id)
    }
  }
  for (const spec of byId.values()) {
    normalized.push({
      id: spec.id,
      minHeight: Math.max(0, spec.minHeight),
      maxHeight: Math.max(0, spec.maxHeight),
      flexible: Boolean(spec.flexible),
    })
  }
  return normalized
}
