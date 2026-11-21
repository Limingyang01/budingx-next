// Cross-validation gate for feature -> master integration (automation of the
// 2026-11-17 user delegation: agent self-review, merge only after gate green).
// Methodology: skills/buding-merge/SKILL.md §3.5 and docs/integration-gate.md.
// Pure helpers are unit-tested; the CLI orchestrates real checks and writes an
// auditable report under artifacts/merge-gate/ (gitignored).
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '../..')

const FORBIDDEN = [
  /^node_modules\//,
  /(^|\/)dist\//,
  /^artifacts\//,
  /^coverage\//,
  /^\.env/,
  /(^|\/)credentials[^/]*\.json$/,
  /\.(pem|key)$/,
  /^pnpm-lock\.yaml$/,
  /\.tsbuildinfo$/
]

/** Committed outgoing paths must not carry deps, artifacts or secrets. */
export function scanOutgoingPaths(files) {
  const violations = []
  for (const file of files) {
    const norm = file.replace(/\\/g, '/')
    if (FORBIDDEN.some((re) => re.test(norm))) violations.push(norm)
  }
  return violations
}

/**
 * Audit an iteration test report: no FAIL rows may survive; UNVERIFIED rows
 * are allowed only while a recovery-conditions section exists.
 */
/**
 * A summary row such as `| FAIL | **0** |` states the failure count, not a failure.
 * Only rows whose FAIL cell carries a non-zero count (or no count at all, e.g.
 * `| AC-01 | x | FAIL |`) denote an actual failure and must block the gate.
 */
function isFailureRow(line) {
  const cells = line
    .split('|')
    .map((part) => part.trim())
  const failIndex = cells.findIndex((part) => /^FAIL\b/i.test(part))
  if (failIndex === -1) {
    if (!/^FAIL\b/i.test(line.trim())) return false
    const bare = line.trim().replace(/^FAIL\b\s*[:：]?\s*/i, '')
    const bareNumber = /^(\d+)/.exec(bare)
    if (bareNumber) return Number(bareNumber[1]) !== 0
    return true
  }
  // `| FAIL | 0 |`: the FAIL cell is a label and the next cell carries the count.
  let raw = cells[failIndex].replace(/^FAIL\b\s*[:：]?\s*/i, '')
  if (raw === '' && failIndex + 1 < cells.length) raw = cells[failIndex + 1]
  const normalized = raw.replace(/[*`]/g, '').trim()
  if (normalized === '' || normalized === '-') return true
  // `0` / `**0**` / `0（说明）` are zero-count statements, not failures.
  if (/^0+$/.test(normalized)) return false
  if (/^0+(\s*[（(].*)?$/.test(normalized)) return false
  // `行 0` / `0 条` style prose counts: the first number decides.
  const counted = /^(?:行|条|项|个)?\s*(\d+)/.exec(normalized)
  if (counted) return Number(counted[1]) !== 0
  // A cell that merely mentions FAIL next to an explicit zero count
  // (e.g. `FAIL 行 0；UNVERIFIED 行 3`) states no failure.
  const anywhereZero = /(?:^|[；;，,、\s])(?:行|条|项|个)?\s*0\s*(?:行|条|项|个)?/.exec(normalized)
  if (anywhereZero) return false
  return true
}

export function auditReport(text) {
  const lines = text.split('\n')
  const isHeaderOrRule = (line) =>
    /AC 数/.test(line) || /^\s*\|[\s:|-]+\|\s*$/.test(line)
  const fails = lines.filter(
    (line) => !isHeaderOrRule(line) && isFailureRow(line)
  )
  const unverified = lines.filter((line) => /UNVERIFIED/.test(line)).length
  const hasRecovery = /恢复条件/.test(text)
  return { fails, unverified, hasRecovery }
}

export function reportPath(branch, stamp) {
  const safe = branch.replace(/[^A-Za-z0-9._-]+/g, '-')
  return path.join(ROOT, 'artifacts', 'merge-gate', `${safe}-${stamp}`)
}

/**
 * Report path convention: SP branches audit that round's test-report; non-SP
 * feature branches (e.g. cross-SP planning revisions) audit the ad-hoc
 * requirement record under docs/requirements/<slug>/ (SP/README convention).
 * Branches without either convention stay RED (missing report).
 */
export function reportFileForBranch(branch) {
  const sp = /SP(\d{3})/.exec(branch)
  if (sp) return path.join(ROOT, 'SP', `SP${sp[1]}`, 'test-report.md')
  const feature = /^feature\/([A-Za-z0-9._-]+)$/.exec(branch)
  if (feature) return path.join(ROOT, 'docs', 'requirements', feature[1], 'test-report.md')
  return null
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  return {
    command: [command, ...args].join(' '),
    exitCode: result.status ?? 1,
    tail: (result.stdout || '').split('\n').slice(-12).join('\n'),
    stderr: (result.stderr || '').split('\n').slice(-6).join('\n')
  }
}

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  return (result.stdout || '').trim()
}

export function crossValidate(options = {}) {
  const branch = options.branch ?? git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const target = options.target ?? 'master'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const steps = [
    run('npm', ['test']),
    run('npm', ['run', 'spec:check']),
    run('npm', ['run', 'skills:check']),
    run('node', ['scripts/release/pack-smoke.mjs'])
  ]
  const base = git(['merge-base', target, 'HEAD'])
  const outgoing = git(['diff', '--name-only', `${base}..HEAD`]).split('\n').filter(Boolean)
  const violations = scanOutgoingPaths(outgoing)
  const reportFile = reportFileForBranch(branch)
  const audit =
    reportFile && existsSync(reportFile)
      ? auditReport(readFileSync(reportFile, 'utf8'))
      : { fails: [], unverified: 0, hasRecovery: false, missing: true }
  const commits = git(['rev-list', '--count', `${base}..HEAD`])
  const ok =
    steps.every((step) => step.exitCode === 0) &&
    violations.length === 0 &&
    audit.fails.length === 0 &&
    (audit.unverified === 0 || audit.hasRecovery) &&
    !audit.missing
  const result = {
    branch,
    target,
    base,
    head: git(['rev-parse', 'HEAD']),
    outgoingCommits: Number(commits),
    outgoingFiles: outgoing.length,
    steps,
    violations,
    audit,
    ok,
    stamp
  }
  const baseName = reportPath(branch, stamp)
  mkdirSync(path.dirname(baseName), { recursive: true })
  writeFileSync(`${baseName}.json`, JSON.stringify(result, null, 2))
  const md = [
    `# 交叉验证门禁报告`,
    '',
    `- 分支：${branch} → ${target}`,
    `- merge-base：${base}｜HEAD：${result.head}｜outgoing：${commits} commits / ${outgoing.length} files`,
    `- 结论：${ok ? 'GREEN（允许合入）' : 'RED（禁止合入）'}`,
    '',
    '| 检查 | 退出码 |',
    '| --- | --- |',
    ...steps.map((step) => `| ${step.command} | ${step.exitCode} |`),
    '',
    `- 禁带路径违规：${violations.length ? violations.join(', ') : '无'}`,
    `- 报告 FAIL 行：${audit.fails.length}｜UNVERIFIED 行：${audit.unverified}｜恢复条件节：${audit.hasRecovery ? '有' : '无'}`,
    ''
  ].join('\n')
  writeFileSync(`${baseName}.md`, md)
  return { ...result, reportFile: `${baseName}.md` }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = crossValidate()
  console.log(result.ok ? 'GATE GREEN' : 'GATE RED')
  console.log(`report: ${path.relative(ROOT, result.reportFile)}`)
  for (const step of result.steps) {
    console.log(`${step.exitCode === 0 ? 'ok' : 'FAIL'} ${step.command}`)
    if (step.exitCode !== 0) console.log(step.tail, step.stderr)
  }
  if (result.violations.length) console.log('violations:', result.violations)
  if (result.audit.fails.length) console.log('report FAIL rows:', result.audit.fails)
  process.exitCode = result.ok ? 0 : 1
}
