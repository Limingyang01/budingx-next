import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '../..')

export const MANIFEST = 'SP/SP001/capability-baseline/capability-manifest.md'
export const INVENTORY = 'SP/SP001/evaluation-suite/task-inventory.md'

const NECESSITY = ['必交', '建议', '可选', '范围外', '暂缓']
const ACCEPTANCE = ['逻辑', '协议fixture', '真实进程', 'UI', 'live Provider', '安装', '人工']
const ASSERTIONS = ['T', 'D', 'X', 'A', 'E']
const SIZES = ['S', 'M', 'L']
const DASH = '—'

const rows = (text, idPattern) =>
  text
    .split('\n')
    .filter((line) => idPattern.test(line.split('|')[1]?.trim() ?? ''))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))

/**
 * 能力清单自洽性检查。
 * 覆盖 plan 的复审重点第 1 条：必交能力被静默降级 / 统计数字与实算不一致。
 */
export function checkManifest(text) {
  const failures = []
  const items = rows(text, /^CAP-/)

  for (const item of items) {
    if (item.length !== 7) failures.push(`列数 ${item.length} != 7: ${item[0]}`)
    item.forEach((cell, i) => {
      if (!cell) failures.push(`空单元格 ${item[0]} 列${i + 1}`)
    })
  }

  const ids = items.map((item) => item[0])
  for (const id of new Set(ids)) {
    if (ids.filter((x) => x === id).length > 1) failures.push(`重复 ID: ${id}`)
    if (!/^CAP-L[1-4]-\d{2}$/.test(id)) failures.push(`ID 格式: ${id}`)
  }

  const counts = { 必交: 0, 建议: 0, 可选: 0, 范围外: 0, 暂缓: 0 }
  for (const item of items) {
    const [id, , , , sp, acceptance, necessity] = item
    if (!NECESSITY.includes(necessity)) {
      failures.push(`必需性非法 "${necessity}" @ ${id}`)
      continue
    }
    counts[necessity] += 1
    const scheduled = /^SP\d{3}(\/SP\d{3})*$/.test(sp)
    if (!scheduled && !(sp === DASH && ['可选', '范围外'].includes(necessity))) {
      failures.push(`归属 SP 非法 "${sp}" @ ${id}`)
    }
    if (acceptance === DASH) {
      if (!['可选', '范围外'].includes(necessity)) failures.push(`验收缺失但未标可选/范围外 @ ${id}`)
      if (sp !== DASH) failures.push(`验收缺失但已排期 @ ${id}`)
    } else {
      for (const method of acceptance.split('+').map((m) => m.trim())) {
        if (!ACCEPTANCE.includes(method)) failures.push(`验收方式非法 "${method}" @ ${id}`)
      }
    }
  }

  // 声明的统计必须与实算一致（声明值从正文解析，不写死在代码里）
  const declaredTotal = /^- 总条目：(\d+)/m.exec(text)
  const declared = /^- 必交：(\d+)｜建议：(\d+)｜可选：(\d+)｜范围外：(\d+)｜暂缓：(\d+)/m.exec(text)
  const denominator = /^- 覆盖度分母固定为\*\*必交 (\d+) 项\*\*/m.exec(text)
  if (!declaredTotal || !declared) failures.push('统计节缺失或格式变更，需同步本检查')
  else {
    const d = declared.slice(1).map(Number)
    if (Number(declaredTotal[1]) !== items.length)
      failures.push(`声明总条目 ${declaredTotal[1]} != 实算 ${items.length}`)
    const order = ['必交', '建议', '可选', '范围外', '暂缓']
    order.forEach((key, i) => {
      if (d[i] !== counts[key]) failures.push(`声明${key} ${d[i]} != 实算 ${counts[key]}`)
    })
  }
  if (denominator && Number(denominator[1]) !== counts['必交'])
    failures.push(`覆盖度分母 ${denominator[1]} != 实算必交 ${counts['必交']}`)

  // 用户已确认的必交能力不得降级。
  // 2026-11-17 用户决定 TUI 单端优先（路线图 r6）：远程/H5/IM 相关 4 项
  // （CAP-L2-18、CAP-L4-11、CAP-L4-12、CAP-L4-15）移出必交改为暂缓，
  // 与 Desktop/VS Code（CAP-L4-13/14）一起登记于 MUST_DEFER；其余必交不变。
  const MUST_KEEP = [
    'CAP-L2-11', 'CAP-L4-17', 'CAP-L2-15', 'CAP-L2-16',
    'CAP-L2-17', 'CAP-L4-16'
  ]
  for (const id of MUST_KEEP) {
    const item = items.find((x) => x[0] === id)
    if (!item) failures.push(`必交能力缺失: ${id}`)
    else if (item[6] !== '必交') failures.push(`必交能力被降级: ${id} = ${item[6]}`)
  }

  // 用户决定暂缓的能力不得被静默恢复、降级为其他状态或删除（恢复须用户另行决定）。
  const MUST_DEFER = [
    'CAP-L2-18', 'CAP-L4-11', 'CAP-L4-12',
    'CAP-L4-13', 'CAP-L4-14', 'CAP-L4-15'
  ]
  for (const id of MUST_DEFER) {
    const item = items.find((x) => x[0] === id)
    if (!item) failures.push(`暂缓能力缺失: ${id}`)
    else if (item[6] !== '暂缓') failures.push(`暂缓能力被静默变更: ${id} = ${item[6]}`)
  }

  return { failures, stats: { total: items.length, ...counts } }
}

/**
 * 评测任务清单自洽性检查：配额、盲测数量、编号连续、场景覆盖。
 */
export function checkInventory(text) {
  const failures = []
  const items = rows(text, /^(TASK-[BA]\d{2}|PROT-\d{2})$/)
  const basic = items.filter((i) => i[0].startsWith('TASK-B'))
  const advanced = items.filter((i) => i[0].startsWith('TASK-A'))
  const protection = items.filter((i) => i[0].startsWith('PROT'))

  if (basic.length !== 30) failures.push(`TASK-B 数量 ${basic.length} != 30`)
  if (advanced.length !== 30) failures.push(`TASK-A 数量 ${advanced.length} != 30`)
  if (protection.length !== 12) failures.push(`PROT 数量 ${protection.length} != 12`)

  for (const [prefix, separator, group] of [
    ['TASK-B', '', basic],
    ['TASK-A', '', advanced],
    ['PROT', '-', protection]
  ]) {
    const got = group.map((i) => i[0])
    for (let i = 1; i <= group.length; i++) {
      const want = `${prefix}${separator}${String(i).padStart(2, '0')}`
      if (!got.includes(want)) failures.push(`${prefix} 缺号: ${want}`)
    }
  }

  for (const item of items) {
    if (item[0].startsWith('PROT')) {
      if (item.length !== 4) failures.push(`列数 ${item.length} != 4: ${item[0]}`)
      item.forEach((cell, i) => {
        if (!cell) failures.push(`空单元格 ${item[0]} 列${i + 1}`)
      })
      continue
    }
    if (item.length !== 9) failures.push(`列数 ${item.length} != 9: ${item[0]}`)
    item.forEach((cell, i) => {
      if (!cell) failures.push(`空单元格 ${item[0]} 列${i + 1}`)
    })
    const directions = item[5].split('+').map((d) => d.trim())
    if (!directions.length || directions.some((d) => !ASSERTIONS.includes(d)))
      failures.push(`断言方向非法 "${item[5]}" @ ${item[0]}`)
    if (!SIZES.includes(item[4])) failures.push(`规模非法 "${item[4]}" @ ${item[0]}`)
    const budget = item[0].startsWith('TASK-B') ? 'B' : 'A'
    if (item[6] !== budget) failures.push(`预算档应为 ${budget}，实为 "${item[6]}" @ ${item[0]}`)
  }

  const blindBasic = basic.filter((i) => i[7].includes('true')).length
  const blindAdvanced = advanced.filter((i) => i[7].includes('true')).length
  if (blindBasic + blindAdvanced !== 20) failures.push(`盲测总数 ${blindBasic + blindAdvanced} != 20`)
  if (blindBasic !== 10) failures.push(`基本盲测 ${blindBasic} != 10`)
  if (blindAdvanced !== 10) failures.push(`高级盲测 ${blindAdvanced} != 10`)

  const QUOTA = {
    LOC: 5, FIX: 6, FEAT: 7, TST: 5, REF: 3, CTX: 2, CAN: 1, ADV: 1,
    TEAM: 6, BRWS: 5, CUSE: 5, REM: 5, IM: 6, SCH: 3
  }
  const actual = {}
  for (const item of [...basic, ...advanced]) actual[item[2]] = (actual[item[2]] || 0) + 1
  for (const [key, quota] of Object.entries(QUOTA)) {
    if ((actual[key] || 0) !== quota) failures.push(`类别 ${key} 实际 ${actual[key] || 0} != 配额 ${quota}`)
  }
  for (const key of Object.keys(actual)) {
    if (!(key in QUOTA)) failures.push(`未登记类别: ${key}`)
  }

  const notes = [...basic, ...advanced].map((i) => i[8]).join(' ')
  for (const [label, keyword] of [
    ['Windows 路径', 'Windows 路径'],
    ['超大仓库', '超大仓库'],
    ['非英语内容', '非英语内容'],
    ['长上下文', '长上下文']
  ]) {
    if (!notes.includes(keyword)) failures.push(`场景未覆盖: ${label}`)
  }

  for (const keyword of ['原产品效果基线缺口', '恢复条件']) {
    if (!text.includes(keyword)) failures.push(`缺关键条款: ${keyword}`)
  }

  return { failures, stats: { basic: basic.length, advanced: advanced.length, protection: protection.length, blind: blindBasic + blindAdvanced } }
}

/**
 * 禁用措辞检查：本轮无原产品效果基线，「已对齐」类达成声明一律不成立。
 * 该词只允许出现在明确禁止它的句子里。
 */
export function checkForbiddenClaims(files) {
  const failures = []
  const TOKEN = '已对齐'
  const EXEMPT = ['禁用', '禁止', '不成立', '一律不', '不得', '不可宣称']
  for (const { file, text } of files) {
    text.split('\n').forEach((line, index) => {
      if (!line.includes(TOKEN)) return
      if (EXEMPT.some((marker) => line.includes(marker))) return
      failures.push(`${file}:${index + 1} 出现未加限定的「${TOKEN}」表述`)
    })
  }
  return failures
}

export function checkSpec(root = ROOT) {
  const manifest = readFileSync(path.join(root, MANIFEST), 'utf8')
  const inventory = readFileSync(path.join(root, INVENTORY), 'utf8')
  const m = checkManifest(manifest)
  const i = checkInventory(inventory)
  const claims = checkForbiddenClaims([
    { file: MANIFEST, text: manifest },
    { file: INVENTORY, text: inventory },
    ...specDocs(root).map((file) => ({ file, text: readFileSync(path.join(root, file), 'utf8') }))
  ])
  return {
    failures: [...m.failures, ...i.failures, ...claims],
    manifest: m.stats,
    inventory: i.stats
  }
}

/** SP001 下的全部文档（用于措辞检查） */
export function specDocs(root = ROOT) {
  const base = path.join(root, 'SP/SP001')
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.md')) found.push(path.relative(root, full).replace(/\\/g, '/'))
    }
  }
  walk(base)
  return found
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkSpec()
  const m = result.manifest
  const i = result.inventory
  console.log(
    `能力清单 ${m.total} 项（必交 ${m.必交} / 建议 ${m.建议} / 可选 ${m.可选} / 范围外 ${m.范围外} / 暂缓 ${m.暂缓}）`
  )
  console.log(
    `任务清单 基本 ${i.basic} / 高级 ${i.advanced} / 保护 ${i.protection}，盲测 ${i.blind}`
  )
  if (result.failures.length) {
    console.error(`\nFAIL (${result.failures.length}):`)
    for (const failure of result.failures) console.error('  ' + failure)
    process.exitCode = 1
  } else {
    console.log('\nOK: 能力清单与任务清单自洽')
  }
}
