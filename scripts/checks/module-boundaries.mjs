#!/usr/bin/env node
// Module boundary check (SP002 PS-07 / SL-09 / TC-01, SP003 workspace).
// - core/provider/storage/workspace must not depend on UI or terminal libraries.
// - core must stay free of IO side effects and must not import
//   provider/storage/tui/workspace.
// - workspace owns file IO and must not depend on the TUI host.
// - the published package may only depend on the rendering whitelist.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const violations = []

const UI_BANNED = ['ink', 'lowlight', 'marked', 'react', 'node:readline', 'node:tty', 'chalk', 'ansi-', 'blessed', 'yoga-layout']
const CORE_IO_BANNED = [
  'node:fs',
  'node:http',
  'node:https',
  'node:net',
  'node:child_process',
  'node:dgram',
  'node:tls'
]

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'dist' || entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mts)$/.test(entry)) out.push(full)
  }
  return out
}

function importsOf(file) {
  const source = readFileSync(file, 'utf8')
  const found = []
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g
  ]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(source)) !== null) found.push(match[1])
  }
  return found
}

function packageName(spec) {
  if (spec.startsWith('.') || spec.startsWith('/')) return null
  if (spec.startsWith('node:')) return spec
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function report(file, reason) {
  violations.push(`${relative(root, file)}: ${reason}`)
}

const RULES = {
  // SP004 §3：core 只保留纯契约/状态机，新增的 exec/git/plan 也不得被 core 反向依赖。
  core: {
    ui: UI_BANNED,
    io: CORE_IO_BANNED,
    dirs: ['provider', 'storage', 'tui', 'workspace', 'exec', 'git', 'plan']
  },
  provider: { ui: UI_BANNED, io: [], dirs: ['storage', 'tui'] },
  storage: { ui: UI_BANNED, io: [], dirs: ['tui'] },
  workspace: { ui: UI_BANNED, io: [], dirs: ['tui'] },
  // 真实进程执行层：允许子进程/文件/路径 IO，但不得反向依赖宿主 UI 与其他能力层。
  exec: { ui: UI_BANNED, io: [], dirs: ['tui', 'git', 'plan'] },
  // Git 能力层：允许子进程/文件/路径 IO，不得依赖执行层、计划层或 UI。
  git: { ui: UI_BANNED, io: [], dirs: ['tui', 'exec', 'plan'] },
  // 计划层：状态机 + 持久化 + 宿主计划集成（T22 落盘用 node:fs，T15 读 Git HEAD 用 node:child_process）。
  plan: { ui: UI_BANNED, io: [], dirs: ['tui', 'exec', 'git'] }
}

for (const [moduleName, rule] of Object.entries(RULES)) {
  for (const file of walk(join(root, 'src', moduleName))) {
    for (const spec of importsOf(file)) {
      const pkg = packageName(spec)
      if (pkg) {
        if (rule.ui.some((ban) => pkg === ban || pkg.startsWith(ban + '-'))) {
          report(file, `禁止依赖 UI/终端库 ${pkg}`)
        }
        if (rule.io.includes(pkg)) report(file, `禁止依赖 IO 模块 ${pkg}`)
        continue
      }
      const target = resolve(dirname(file), spec)
      // 相对导入的模块目录位于仓库根下的 src/<模块>/，因此按前缀判断，
      // 不能用 '/src/<dir>/'（顶层路径不含前导斜杠，会漏报全部跨模块依赖）。
      const rel = relative(root, target).split('\\').join('/')
      const hit = rule.dirs.find((dir) => rel === `src/${dir}` || rel.startsWith(`src/${dir}/`))
      if (hit) report(file, `禁止依赖其他模块 src/${hit}（${spec}）`)
    }
  }
}

const productManifest = JSON.parse(
  readFileSync(join(root, 'src', 'tui', 'package.json'), 'utf8')
)
const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const allowedDeps = ['ink', 'lowlight', 'marked', 'react', 'string-width']
const actualDeps = Object.keys(productManifest.dependencies ?? {}).sort()
for (const dep of actualDeps) {
  if (!allowedDeps.includes(dep)) {
    violations.push(`src/tui/package.json: 运行时依赖 ${dep} 不在白名单 ${allowedDeps.join('/')} 内`)
  }
}
for (const dep of allowedDeps) {
  if (!actualDeps.includes(dep)) {
    violations.push(`src/tui/package.json: 白名单依赖 ${dep} 缺失`)
  }
  const rootVersion = rootManifest.devDependencies?.[dep]
  const productVersion = productManifest.dependencies?.[dep]
  if (!rootVersion) {
    violations.push(`package.json: devDependencies 缺少 ${dep}（构建需要）`)
  } else if (productVersion && rootVersion !== productVersion) {
    violations.push(
      `package.json: ${dep} 版本不一致（根 devDependencies ${rootVersion} / src/tui dependencies ${productVersion}）`
    )
  }
}
if (productManifest.bin?.budingx !== 'dist/tui/cli.js') {
  violations.push(
    `src/tui/package.json: bin.budingx 应为 dist/tui/cli.js，实际 ${productManifest.bin?.budingx}`
  )
}

if (violations.length > 0) {
  console.error('模块边界检查失败：')
  for (const violation of violations) console.error(' - ' + violation)
  process.exitCode = 1
} else {
  console.log('模块边界检查通过')
}
