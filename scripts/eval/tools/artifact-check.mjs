#!/usr/bin/env node
// SP010 T8：最终候选制品核对。
// 从当前源码打 tarball，在仓库外、隔离 HOME 的前缀里安装同一 tarball，
// 用已安装的 CLI 跑一条非盲只读定位题，核对答案、入口、版本与数据根隔离。
// 用法：
//   node scripts/eval/tools/artifact-check.mjs [--provider http://127.0.0.1:PORT/v1]
//   node scripts/eval/tools/artifact-check.mjs --real            # 用 .env.e2e.local 的真实 Provider
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repoRoot } from '../lib/util.mjs'
import { npm } from '../../release/process.mjs'

const ROOT = repoRoot()

/** 目标文件与符号：定位题的预期答案（预先冻结）。 */
const TARGET_FILE = 'src/calc.js'
const TARGET_SYMBOL = 'addTwo'
const EXPECTED_ANSWER = TARGET_FILE + ' 中的 ' + TARGET_SYMBOL

/** 被测仓库夹具（只读定位题）。 */
function writeFixture(dir) {
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'src', 'calc.js'),
    'export function addTwo(a, b) {\n  return a + b\n}\n\nexport function subTwo(a, b) {\n  return a - b\n}\n'
  )
  writeFileSync(join(dir, 'README.md'), '# 计算夹具\n\n只有一个源文件 src/calc.js。\n')
}

/** 本机 SSE fixture：按请求顺序返回工具调用与最终回答。 */
async function startFixture() {
  let index = 0
  const requests = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    let body
    try {
      body = JSON.parse(Buffer.concat(chunks).toString())
    } catch {
      body = undefined
    }
    requests.push(body)
    const step = index
    index += 1
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    if (step === 0) {
      res.end(
        'data: ' +
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-read-1',
                      function: {
                        name: 'Read',
                        arguments: JSON.stringify({ file_path: TARGET_FILE })
                      }
                    }
                  ]
                }
              }
            ]
          }) +
          '\n\n' +
          'data: ' +
          JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) +
          '\n\n' +
          'data: [DONE]\n\n'
      )
      return
    }
    res.end(
      'data: ' +
        JSON.stringify({
          choices: [
            {
              delta: {
                content:
                  '目标函数是 ' + EXPECTED_ANSWER + '，定义在 ' + TARGET_FILE + '。'
              },
              finish_reason: 'stop'
            }
          ]
        }) +
        '\n\n' +
        'data: [DONE]\n\n'
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1',
    requests,
    async close() {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}

function parseEnv(filePath) {
  const env = {}
  if (!existsSync(filePath)) return env
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return env
}

function sh(command, args, options = {}) {
  const run = spawnSync(command, args, { encoding: 'utf8', ...options })
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' }
}

/**
 * 异步执行子进程：父进程事件循环必须保持运转，
 * 否则本机 SSE fixture 无法响应被测 CLI 的请求。
 */
function runAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, options.timeoutMs ?? 120_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ status: code, stdout, stderr })
    })
  })
}

async function main() {
  const args = process.argv.slice(2)
  const real = args.includes('--real')
  const workdir = mkdtempSync(join(tmpdir(), 'sp010-artifact-'))
  const problems = []
  const evidence = {}
  let fixture
  try {
    // 1) 打包当前源码。
    const packDir = join(workdir, 'pack')
    mkdirSync(packDir, { recursive: true })
    let packed
    try {
      const result = await npm(['pack', '--pack-destination', packDir], { cwd: join(ROOT, 'src', 'tui') })
      packed = { status: 0, stdout: result.out, stderr: result.err }
    } catch (error) {
      packed = { status: error.code ?? 1, stdout: error.out ?? '', stderr: error.err ?? String(error.message) }
    }
    if (packed.status !== 0) {
      problems.push('npm pack 失败：' + (packed.stderr || packed.stdout).slice(0, 400))
      throw new Error('pack failed')
    }
    const tarball = join(packDir, packed.stdout.trim().split('\n').pop().trim())
    if (!existsSync(tarball)) {
      problems.push('未找到 tarball：' + tarball)
      throw new Error('tarball missing')
    }
    evidence.tarball = tarball

    // 2) 仓库外、隔离 HOME 的前缀安装。
    const prefix = join(workdir, 'prefix')
    const home = join(workdir, 'home')
    mkdirSync(prefix, { recursive: true })
    mkdirSync(home, { recursive: true })
    let installed
    try {
      const result = await npm(
        ['install', '--prefix', prefix, '--no-audit', '--no-fund', '--ignore-scripts', tarball],
        { cwd: workdir }
      )
      installed = { status: 0, stdout: result.out, stderr: result.err }
    } catch (error) {
      installed = { status: error.code ?? 1, stdout: error.out ?? '', stderr: error.err ?? String(error.message) }
    }
    if (installed.status !== 0) {
      problems.push('隔离安装失败：' + (installed.stderr || installed.stdout).slice(0, 400))
      throw new Error('install failed')
    }
    // 命令入口：读已安装包的 bin 声明，用 node 直接执行入口脚本
    // （Windows 下 .cmd 包装不能被直接 spawn）。
    const installedRoot = join(prefix, 'node_modules', 'budingx')
    const installedManifest = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'))
    const binField = typeof installedManifest.bin === 'string' ? installedManifest.bin : installedManifest.bin?.budingx
    if (!binField) {
      problems.push('已安装包没有声明 budingx 命令入口')
      throw new Error('entry missing')
    }
    const entry = join(installedRoot, binField)
    if (!existsSync(entry)) {
      problems.push('安装后找不到命令入口：' + entry)
      throw new Error('entry missing')
    }
    evidence.entry = entry
    evidence.entryDeclaration = binField
    const entryCmd = process.execPath
    const entryArgs = [entry]

    // 3) 入口版本与隔离数据根。
    const version = await runAsync(entryCmd, [...entryArgs, '--version'], {
      env: { ...process.env, HOME: home, USERPROFILE: home }
    })
    evidence.version = (version.stdout || version.stderr).trim()
    if (version.status !== 0) {
      problems.push('入口 --version 失败：' + (version.stderr || version.stdout).slice(0, 300))
    }

    // 4) 跑非盲只读定位题。
    const project = join(workdir, 'project')
    mkdirSync(project, { recursive: true })
    writeFixture(project)

    let baseUrl
    let apiKey = 'fixture'
    let model = 'artifact-fixture'
    if (real) {
      const env = parseEnv(join(ROOT, '.env.e2e.local'))
      if (!env.BUDINGX_API_KEY) {
        problems.push('真实模式缺少 BUDINGX_API_KEY')
        throw new Error('no credentials')
      }
      baseUrl = env.BUDINGX_BASE_URL
      apiKey = env.BUDINGX_API_KEY
      model = env.BUDINGX_MODEL
      evidence.provider = 'real'
    } else {
      fixture = await startFixture()
      baseUrl = fixture.baseUrl
      evidence.provider = 'local-fixture'
    }

    const run = await runAsync(
      entryCmd,
      [
        ...entryArgs,
        '--prompt',
        '请定位仓库中定义 ' + TARGET_SYMBOL + ' 的文件，并说明它的位置。',
        '--output-format',
        'stream-json',
        '--base-url',
        baseUrl,
        '--model',
        model
      ],
      {
        cwd: project,
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          BUDINGX_API_KEY: apiKey,
          BUDINGX_BASE_URL: baseUrl,
          BUDINGX_MODEL: model,
          BUDINGX_SMOKE_MODEL: model,
          BUDINGX_SMOKE_MODEL_KEY: apiKey,
          BUDINGX_SMOKE_MODEL_BASE_URL: baseUrl,
          BUDINGX_E2E_MAX_REQUESTS: '12',
          BUDINGX_E2E_BUDGET_USD: '1'
        }
      }
    )
    evidence.exitCode = run.status
    evidence.stdout = run.stdout
    evidence.stderr = run.stderr.slice(0, 800)
    if (run.status !== 0) {
      problems.push('已安装 CLI 运行退出码非 0：' + run.status + '\n' + (run.stderr || run.stdout).slice(0, 400))
    }
    // 5) 核对答案、成对读取事件与数据根隔离。
    const stdout = run.stdout
    if (!stdout.includes(TARGET_FILE) || !stdout.includes(TARGET_SYMBOL)) {
      problems.push('输出未命中预期文件与符号')
    }
    const readUse = stdout.includes('"name":"Read"') || stdout.includes('"name": "Read"')
    const readResult = stdout.includes('call-read-1')
    if (!readUse || !readResult) {
      problems.push('转录中缺少目标 Read 调用或成对结果（tool_use_id）')
    }
    const dataRoot = join(home, '.budingx')
    evidence.dataRoot = dataRoot
    evidence.dataRootExists = existsSync(dataRoot)
    // 正向证据：直接问已安装制品自己的数据根解析结果，
    // 它必须跟随 HOME 指向隔离目录，而不是真实用户目录。
    const probeFile = join(workdir, 'probe-data-root.mjs')
    writeFileSync(
      probeFile,
      [
        "import { pathToFileURL } from 'node:url'",
        "const m = await import(pathToFileURL(process.argv[2]))",
        'process.stdout.write(m.dataRoot())',
        ''
      ].join('\n'),
      'utf8'
    )
    const probe = await runAsync(
      process.execPath,
      [probeFile, join(installedRoot, 'dist', 'storage', 'paths.js')],
      {
        cwd: workdir,
        env: { ...process.env, HOME: home, USERPROFILE: home }
      }
    )
    evidence.resolvedDataRoot = probe.stdout.trim()
    evidence.dataRootProbeError = probe.stderr.trim().slice(0, 300)
    if (!evidence.resolvedDataRoot.startsWith(home)) {
      problems.push(
        '已安装制品的数据根未跟随隔离 HOME：' + evidence.resolvedDataRoot + '（期望以 ' + home + ' 开头）'
      )
    }
    // 负向证据：隔离 HOME 下不得出现旧目录，且项目目录不得出现数据根。
    const legacy = readdirSafe(join(home, '.claude'))
    if (legacy.length > 0) {
      problems.push('安装后读取了 ~/.claude')
    }
    if (existsSync(join(project, '.budingx'))) {
      problems.push('CLI 在项目目录内写入了数据根')
    }
  } catch (error) {
    if (!problems.length) problems.push(String(error?.message ?? error))
  } finally {
    await fixture?.close()
    rmSync(workdir, { recursive: true, force: true })
  }

  console.log(JSON.stringify({ evidence, problems }, null, 2))
  if (problems.length > 0) {
    for (const problem of problems) console.error('FAIL: ' + problem)
    process.exitCode = 1
    return
  }
  console.log('OK: 候选制品核对通过')
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

main()
