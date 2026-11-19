#!/usr/bin/env node
// SP004 独立来源 AST 复核（设计 §9.8）。
// 只读比较本仓 SP004 改动模块与参考仓中与 SP004 相关的源码模块：
//   1. 用本仓 TypeScript 解析器提取函数/组件单元；
//   2. 归一化语法节点（忽略 trivia、统一局部标识符、保留操作符与控制流、保留 JSX 结构）；
//   3. 报告「≥30 节点连续相同归一化子树」或「双方均 ≥60 节点且归一化节点序列相似度 ≥0.80」的函数对；
//   4. 报告只输出路径、范围、指标与处置，不输出参考源码片段。

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import ts from 'typescript'

const TEXT_NODE_MIN = 30
const FUNCTION_NODE_MIN = 60
const SIMILARITY_MIN = 0.8
const CANDIDATE_SIMILARITY_MIN = 0.45

// 本仓模块 → 参考仓中允许比较的源码位置（仅 SP004 相关）。
// theirs 为空表示参考仓没有对应模块：仍属已审查路径（无比较对象），理由写在 note。
const REFERENCE_ALLOWLIST = [
  { ours: 'src/core/coding.ts', theirs: ['src/Task.ts', 'src/tools/TaskOutputTool', 'src/tools/TaskCreateTool'] },
  { ours: 'src/core/constants.ts', theirs: [], note: '纯常量/错误码表，参考仓无同名协议模块且不参与相似实现比较' },
  { ours: 'src/core/events.ts', theirs: ['src/QueryEngine.ts'] },
  { ours: 'src/core/exec.ts', theirs: ['src/tools/BashTool'] },
  { ours: 'src/core/permissions.ts', theirs: ['src/components/permissions', 'src/hooks/useCanUseTool.tsx'] },
  { ours: 'src/core/plan.ts', theirs: ['src/tools/EnterPlanModeTool', 'src/tools/ExitPlanModeTool'] },
  { ours: 'src/core/questions.ts', theirs: ['src/tools/AskUserQuestionTool'] },
  { ours: 'src/core/session.ts', theirs: ['src/QueryEngine.ts'] },
  { ours: 'src/core/tools.ts', theirs: ['src/Tool.ts'] },
  { ours: 'src/exec/background.ts', theirs: ['src/tools/BashTool', 'src/tasks'] },
  { ours: 'src/exec/destructive.ts', theirs: ['src/tools/BashTool'] },
  { ours: 'src/exec/host-sandbox.ts', theirs: ['src/utils/sandbox/sandbox-adapter.ts'] },
  { ours: 'src/exec/index.ts', theirs: [], note: '模块导出面（barrel），仅 re-export，无可比较实现' },
  { ours: 'src/exec/interpreter.ts', theirs: ['src/tools/BashTool'] },
  { ours: 'src/exec/output.ts', theirs: ['src/tools/BashTool'] },
  { ours: 'src/exec/persist.ts', theirs: [], note: '本仓会话输出落盘实现（设计 §4.4 规定路径），参考仓使用不同机制' },
  { ours: 'src/exec/readonly-commands.ts', theirs: ['src/tools/BashTool'] },
  { ours: 'src/exec/runner.ts', theirs: ['src/tools/BashTool', 'src/utils/Shell.ts'] },
  { ours: 'src/exec/sandbox-policy.ts', theirs: ['src/utils/sandbox'] },
  { ours: 'src/exec/sed-edit.ts', theirs: ['src/tools/FileEditTool'] },
  { ours: 'src/exec/tools.ts', theirs: ['src/tools/BashTool'] },
  { ours: 'src/git/attribution.ts', theirs: [], note: '参考仓未实现 Git 工具层（Git 由用户 shell 直接执行），无比较对象' },
  { ours: 'src/git/commit.ts', theirs: [], note: '参考仓未实现 Git 工具层（Git 由用户 shell 直接执行），无比较对象' },
  { ours: 'src/git/index.ts', theirs: [], note: '模块导出面（barrel），仅 re-export，无可比较实现' },
  { ours: 'src/git/porcelain.ts', theirs: [], note: '参考仓未实现 Git 工具层（Git 由用户 shell 直接执行），无比较对象' },
  { ours: 'src/git/status.ts', theirs: [], note: '参考仓未实现 Git 工具层（Git 由用户 shell 直接执行），无比较对象' },
  { ours: 'src/git/worktree.ts', theirs: ['src/tools/EnterWorktreeTool', 'src/tools/ExitWorktreeTool'] },
  { ours: 'src/plan/host.ts', theirs: ['src/tools/EnterPlanModeTool', 'src/tools/ExitPlanModeTool'] },
  { ours: 'src/plan/index.ts', theirs: [], note: '模块导出面（barrel），仅 re-export，无可比较实现' },
  { ours: 'src/plan/serialize.ts', theirs: ['src/tools/EnterPlanModeTool', 'src/tools/ExitPlanModeTool'] },
  { ours: 'src/plan/store.ts', theirs: ['src/tools/EnterPlanModeTool'] },
  { ours: 'src/plan/tools.ts', theirs: ['src/tools/EnterPlanModeTool', 'src/tools/ExitPlanModeTool'] },
  { ours: 'src/plan/validate.ts', theirs: ['src/tools/EnterPlanModeTool'] },
  { ours: 'src/tui/app.tsx', theirs: ['src/components', 'src/screens'] },
  { ours: 'src/tui/approval.ts', theirs: ['src/components/permissions'] },
  { ours: 'src/tui/cli.ts', theirs: ['src/entrypoints/cli.tsx', 'src/entrypoints/tui.ts'] },
  { ours: 'src/tui/git-tools.ts', theirs: ['src/tools/EnterWorktreeTool', 'src/tools/ExitWorktreeTool', 'src/components/WorktreeExitDialog.tsx'] },
  {
    ours: 'src/tui/render/cards.ts',
    theirs: [
      'src/components/TaskListV2.tsx',
      'src/components/BashModeProgress.tsx',
      'src/components/permissions/AskUserQuestionPermissionRequest',
      'src/components/permissions/ExitPlanModePermissionRequest'
    ]
  },
  { ours: 'src/tui/render/reducer.ts', theirs: ['src/components'] },
  { ours: 'src/tui/render/types.ts', theirs: ['src/components'] },
  { ours: 'src/tui/runtime.ts', theirs: ['src/bootstrap', 'src/application'] },
  { ours: 'src/workspace/policy.ts', theirs: ['src/components/permissions', 'src/hooks/useCanUseTool.tsx'] }
]

// 人工处置：命中项的复核结论（按「本仓路径::单元名」）。
const DISPOSITIONS = new Map([
  [
    'src/core/session.ts::constructor',
    '与参考 QueryEngine 同属「会话对象持有 provider/审批/工具表」的公共协议形状（字段由 SP004 设计 §4/§6 规定），实现为独立编写'
  ],
  ['src/git/status.ts::readGitStatus', 'Git 只读状态字段是 §7.1 规定的公共协议；恢复逻辑按本仓 porcelain 解析器独立实现'],
  ['src/exec/runner.ts::run', '进程启动/超时/截断为 §4.3 行为规格的惯用样板（spawn + 事件），无逐字借用']
])

function parseArgs(argv) {
  const args = { reference: process.env.BUDINGX_REFERENCE_DIR, referenceRevision: 'b5c9be8', base: 'master' }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--reference') args.reference = argv[++index]
    else if (value === '--reference-revision') args.referenceRevision = argv[++index]
    else if (value === '--base') args.base = argv[++index]
    else if (value === '--worktree') args.worktree = true
    else if (value === '--help' || value === '-h') args.help = true
    else throw new Error(`未知参数：${value}`)
  }
  return args
}

function git(cwd, args, input) {
  return execFileSync('git', ['--no-replace-objects', ...args], {
    cwd,
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024
  })
}

function gitCommit(cwd, revision) {
  if (typeof revision !== 'string' || revision === '') throw new Error('缺少 Git revision')
  return git(cwd, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]).toString().trim()
}

function gitSourceFiles(cwd, commit, targets) {
  if (targets.length === 0) return new Map()
  const tree = git(cwd, ['--literal-pathspecs', 'ls-tree', '-r', '--full-tree', '-z', commit, '--', ...targets])
  const files = new Map()
  for (const record of tree.toString().split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t')
    const [mode, type, oid] = record.slice(0, tab).split(' ')
    const path = record.slice(tab + 1)
    if (type === 'blob' && ['100644', '100755'].includes(mode) && /\.tsx?$/.test(path) && !path.endsWith('.d.ts')) {
      files.set(path, oid)
    }
  }
  return files
}

function gitBlobs(cwd, files) {
  const oids = [...new Set(files.values())]
  if (oids.length === 0) return new Map()
  const output = git(cwd, ['cat-file', '--batch'], oids.join('\n') + '\n')
  const blobs = new Map()
  let offset = 0
  for (const oid of oids) {
    const end = output.indexOf(10, offset)
    if (end < 0) throw new Error(`Git blob 响应缺失：${oid}`)
    const [actual, type, length] = output.toString('ascii', offset, end).split(' ')
    const size = Number(length)
    const next = end + 1 + size
    if (actual !== oid || type !== 'blob' || !Number.isSafeInteger(size) || size < 0 || output[next] !== 10) {
      throw new Error(`Git blob 响应无效：${oid}`)
    }
    blobs.set(oid, output.toString('utf8', end + 1, next))
    offset = next + 1
  }
  return blobs
}

function parseSource(path, text) {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const diagnostic = source.parseDiagnostics[0]
  if (diagnostic) {
    const position = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
    throw new Error(`语法解析失败：${path}:${position.line + 1} TS${diagnostic.code}`)
  }
  return source
}

const TRIVIAL_KINDS = new Set([
  ts.SyntaxKind.SemicolonToken,
  ts.SyntaxKind.CommaToken,
  ts.SyntaxKind.CloseBraceToken,
  ts.SyntaxKind.OpenBraceToken,
  ts.SyntaxKind.CloseParenToken,
  ts.SyntaxKind.OpenParenToken
])

function tokenOf(node) {
  if (ts.isIdentifier(node)) return 'id'
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return 'str'
  if (ts.isNumericLiteral(node)) return 'num'
  if (ts.isBinaryExpression(node) || ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    return `op:${ts.SyntaxKind[node.operator] ?? ''}`
  }
  if (ts.isPropertyAccessExpression(node)) return 'member'
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return 'jsx'
  return ''
}

function isJsxKind(kind) {
  return kind >= ts.SyntaxKind.JsxElement && kind <= ts.SyntaxKind.JsxNamespacedName
}

function normalizedSequence(node) {
  const out = []
  const visit = (current) => {
    if (!TRIVIAL_KINDS.has(current.kind)) {
      const token = tokenOf(current)
      out.push(token ? `${ts.SyntaxKind[current.kind]}:${token}` : `${ts.SyntaxKind[current.kind]}`)
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return out
}

// 结构化子树索引：签名 → { nodes, jsx }，只保留 ≥30 节点的子树。
function subtreeIndex(body) {
  const index = new Map()
  const visit = (node) => {
    const parts = []
    let nodes = 1
    let jsx = isJsxKind(node.kind) ? 1 : 0
    ts.forEachChild(node, (child) => {
      const info = visit(child)
      parts.push(info.signature)
      nodes += info.nodes
      jsx += info.jsx
    })
    const token = tokenOf(node)
    const signature = `${ts.SyntaxKind[node.kind]}:${token}(${parts.join(',')})`
    if (!TRIVIAL_KINDS.has(node.kind) && nodes >= TEXT_NODE_MIN) {
      const known = index.get(signature)
      index.set(signature, { nodes, jsx, count: (known?.count ?? 0) + 1 })
    }
    return { signature, nodes, jsx }
  }
  visit(body)
  return index
}

function trigramSet(sequence) {
  const set = new Set()
  for (let index = 0; index + 3 <= sequence.length; index += 1) {
    set.add(createHash('sha1').update(`${sequence[index]}|${sequence[index + 1]}|${sequence[index + 2]}`).digest('base64'))
  }
  return set
}

function dice(a, b) {
  let shared = 0
  for (const value of a) if (b.has(value)) shared += 1
  return (2 * shared) / (a.size + b.size || 1)
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  )
}

function ownName(node, sf) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text
  const parent = node.parent
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  if (parent && ts.isPropertyAssignment(parent)) return 'property'
  const position = sf.getLineAndCharacterOfPosition(node.getStart(sf))
  return `anonymous@${position.line + 1}`
}

function collectUnits(filePath, text) {
  const sf = parseSource(filePath, text)
  const units = []
  const visit = (node) => {
    if (isFunctionLike(node)) {
      const body = node.body ?? node
      const sequence = normalizedSequence(body)
      if (sequence.length >= 10) {
        const start = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        const end = sf.getLineAndCharacterOfPosition(node.getEnd())
        units.push({
          file: filePath,
          name: ownName(node, sf),
          startLine: start.line + 1,
          endLine: end.line + 1,
          nodeCount: sequence.length,
          trigrams: trigramSet(sequence),
          subtrees: subtreeIndex(body)
        })
      }
      return
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sf, visit)
  return units
}

function findHit(ours, theirs) {
  if (ours.trigrams.size === 0 || theirs.trigrams.size === 0) return undefined
  const similarity = dice(ours.trigrams, theirs.trigrams)
  let shared
  for (const [signature, info] of ours.subtrees) {
    const other = theirs.subtrees.get(signature)
    if (!other) continue
    if (!shared || info.nodes > shared.nodes) shared = { nodes: info.nodes, jsx: info.jsx, theirs: other }
  }
  const similar = similarity >= SIMILARITY_MIN && ours.nodeCount >= FUNCTION_NODE_MIN && theirs.nodeCount >= FUNCTION_NODE_MIN
  if (!shared && !similar) return undefined
  if (shared && similarity < CANDIDATE_SIMILARITY_MIN) {
    // 结构子树相同但整体序列差异明显：仍按设计报告，只是相似度低。
  }
  return {
    similarity,
    shared,
    metric: shared ? 'subtree' : 'trigram-dice',
    jsxRatio: shared ? shared.jsx / shared.nodes : 0,
    boilerplate: Boolean(shared) && shared.jsx / shared.nodes >= 0.4
  }
}

function selfTest() {
  const cases = []

  const base = `export function collect(items: string[]): string[] {\n  const output: string[] = []\n  for (const item of items) {\n    if (item.length > 2) {\n      const trimmed = item.trim()\n      if (trimmed.startsWith('#')) continue\n      output.push(trimmed)\n    }\n  }\n  return output\n}\n`
  const copy = `export function gather(values: string[]): string[] {\n  const result: string[] = []\n  for (const value of values) {\n    if (value.length > 2) {\n      const normalized = value.trim()\n      if (normalized.startsWith('#')) continue\n      result.push(normalized)\n    }\n  }\n  return result\n}\n`
  const different = `export async function runProcess(command: string, timeoutMs: number): Promise<number> {\n  const started = Date.now()\n  await new Promise((resolve) => setTimeout(resolve, 1))\n  if (Date.now() - started > timeoutMs) throw new Error('timeout')\n  return command.length\n}\n`

  const unitsA = collectUnits('a.ts', base)
  const unitsB = collectUnits('b.ts', copy + different)
  const same = findHit(unitsA[0], unitsB.find((unit) => unit.name === 'gather'))
  const other = findHit(unitsA[0], unitsB.find((unit) => unit.name === 'runProcess'))
  cases.push({ name: '相似片段命中', ok: Boolean(same && same.metric === 'subtree' && same.shared.nodes >= TEXT_NODE_MIN) })
  cases.push({ name: '无关实现不命中', ok: other === undefined })
  const shortUnits = collectUnits('c.ts', 'export const add = (a: number, b: number) => a + b\n')
  cases.push({
    name: '样板（<60 节点短函数）排除',
    ok: shortUnits.every((unit) => findHit(unit, unitsA[0]) === undefined)
  })
  let invalidSourceRejected = false
  try {
    collectUnits('invalid.ts', 'export function invalid( {')
  } catch (error) {
    invalidSourceRejected = /invalid\.ts:1 TS\d+/.test(error.message)
  }
  cases.push({ name: '无效 TypeScript 阻断', ok: invalidSourceRejected })
  return cases
}

function ourChangedFiles(cwd, base, head, worktree) {
  const sourceGlobs = ['src/**/*.ts', 'src/**/*.tsx']
  const revisions = worktree ? [base] : [base, head]
  const output = git(cwd, ['diff', '--diff-filter=ACMRT', '--name-only', '-z', ...revisions, '--', ...sourceGlobs])
  const changed = new Set(output.toString().split('\0').filter(Boolean))
  if (worktree) {
    const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...sourceGlobs])
    for (const file of untracked.toString().split('\0').filter(Boolean)) changed.add(file)
  }
  return [...changed].sort()
}

function run() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('用法：node scripts/review/sp004-ast.mjs --reference <参考仓> --reference-revision <rev> --base <功能基线> [--worktree]')
    return 0
  }
  if (!args.reference || !existsSync(args.reference)) throw new Error(`参考仓不存在：${args.reference ?? '(未提供)'}`)

  const failures = []
  const selfChecks = selfTest()
  for (const check of selfChecks) if (!check.ok) failures.push(`自检失败：${check.name}`)

  const cwd = process.cwd()
  const referenceRevision = gitCommit(args.reference, args.referenceRevision)
  const head = gitCommit(cwd, 'HEAD')
  const baseCommit = git(cwd, ['merge-base', gitCommit(cwd, args.base), head]).toString().trim()
  const changed = ourChangedFiles(cwd, baseCommit, head, args.worktree)
  if (changed.length === 0) failures.push('没有可审核的 SP004 源码变更')
  const mapped = changed.map((file) => ({ file, rule: REFERENCE_ALLOWLIST.find((entry) => file === entry.ours) }))
  const uncovered = mapped.filter((entry) => entry.rule === undefined).map((entry) => entry.file)
  for (const file of uncovered) failures.push(`未覆盖路径（无映射）：${file}`)

  const compared = mapped.filter((entry) => entry.rule !== undefined)
  const referenceTargets = [...new Set(compared.flatMap(({ rule }) => rule.theirs))]
  const referenceTree = gitSourceFiles(args.reference, referenceRevision, referenceTargets)
  const referenceBlobs = gitBlobs(args.reference, referenceTree)
  const referenceUnits = new Map()
  for (const [path, oid] of referenceTree) {
    referenceUnits.set(path, collectUnits(path, referenceBlobs.get(oid)))
  }

  const ownTree = args.worktree ? new Map() : gitSourceFiles(cwd, head, changed)
  const ownBlobs = gitBlobs(cwd, ownTree)
  const referenceByOurs = new Map()
  const noCounterpart = []
  for (const { rule } of compared) {
    if (rule.theirs.length === 0) {
      noCounterpart.push({ file: rule.ours, note: rule.note ?? '参考仓无对应模块' })
      continue
    }
    const units = []
    for (const target of rule.theirs) {
      const paths = [...referenceTree.keys()].filter((path) => path === target || path.startsWith(`${target}/`))
      if (paths.length === 0) failures.push(`参考侧路径缺失：${rule.ours} → ${target}`)
      for (const path of paths) units.push(...referenceUnits.get(path))
    }
    if (units.length === 0) failures.push(`参考侧没有可比较单元：${rule.ours}`)
    referenceByOurs.set(rule.ours, units)
  }

  let comparisonPairs = 0
  let oursUnitCount = 0
  const hits = []
  for (const entry of compared) {
    const content = args.worktree ? readFileSync(entry.file, 'utf8') : ownBlobs.get(ownTree.get(entry.file))
    if (content === undefined) {
      failures.push(`缺少本仓 Git blob：${entry.file}`)
      continue
    }
    const oursUnits = collectUnits(entry.file, content)
    const candidates = referenceByOurs.get(entry.file) ?? []
    if (candidates.length === 0) continue
    oursUnitCount += oursUnits.length
    comparisonPairs += oursUnits.length * candidates.length
    for (const ours of oursUnits) {
      let best
      for (const theirs of candidates) {
        const hit = findHit(ours, theirs)
        if (!hit) continue
        if (!best) best = { hit, ref: theirs }
        else if (best.hit.metric !== 'subtree' && hit.metric === 'subtree') best = { hit, ref: theirs }
        else if (best.hit.metric === hit.metric && hit.similarity > best.hit.similarity) best = { hit, ref: theirs }
      }
      if (!best) continue
      const key = `${entry.file}::${ours.name}`
      const disposition =
        DISPOSITIONS.get(key) ??
        (best.hit.boilerplate ? '惯用样板：Ink/JSX 布局结构（公开 UI 惯用写法，非业务逻辑）' : 'UNRESOLVED')
      hits.push({
        oursFile: entry.file,
        oursRange: `${ours.startLine}-${ours.endLine}`,
        oursName: ours.name,
        oursNodes: ours.nodeCount,
        refFile: best.ref.file,
        refRange: `${best.ref.startLine}-${best.ref.endLine}`,
        refNodes: best.ref.nodeCount,
        metric: best.hit.metric,
        similarity: best.hit.similarity.toFixed(2),
        sharedNodes: best.hit.shared ? best.hit.shared.nodes : 0,
        disposition
      })
    }
  }

  const unresolved = hits.filter((hit) => hit.disposition === 'UNRESOLVED')
  for (const hit of unresolved) failures.push(`未处理的命中：${hit.oursFile}::${hit.oursName}（${hit.metric}）`)
  if (comparisonPairs === 0) failures.push('没有实际比较的函数对')

  console.log('SP004 AST 复核（设计 §9.8）')
  console.log(`参考提交：${referenceRevision}`)
  console.log(`本仓输入：${args.worktree ? '工作树（含未跟踪源码）' : head}`)
  console.log(`功能基线：${baseCommit.slice(0, 7)}，改动文件 ${changed.length} 个，映射 ${changed.length - uncovered.length} 个`)
  console.log('自检：')
  for (const check of selfChecks) console.log(`  ${check.ok ? 'PASS' : 'FAIL'} ${check.name}`)
  if (noCounterpart.length > 0) {
    console.log('无对应参考模块（已审查，无比较对象）：')
    for (const entry of noCounterpart) console.log(`  ${entry.file}：${entry.note}`)
  }
  console.log(`比较规模：本仓单元 ${oursUnitCount} 个，参考单元 ${[...referenceByOurs.values()].reduce((sum, units) => sum + units.length, 0)} 个，函数对 ${comparisonPairs} 组`)
  console.log('命中：')
  if (hits.length === 0) console.log('  无（未发现达到阈值的函数对）')
  for (const hit of hits) {
    const metric =
      hit.metric === 'subtree'
        ? `subtree=${hit.sharedNodes} 节点`
        : `trigram-dice=${hit.similarity}（双方 ${hit.oursNodes}/${hit.refNodes} 节点，需 ≥0.80 且 ≥60）`
    console.log(
      `  ${hit.oursFile}::${hit.oursName}（${hit.oursRange}，${hit.oursNodes} 节点） vs ${hit.refFile}（${hit.refRange}，${hit.refNodes} 节点） 指标=${metric} 处置=${hit.disposition}`
    )
  }
  console.log(`结论：${failures.length === 0 ? 'PASS' : 'FAIL'}`)
  for (const failure of failures) console.log(`  - ${failure}`)
  return failures.length === 0 ? 0 : 1
}

process.exitCode = run()
