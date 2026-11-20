// SP006 §12：制品验收（NP-01…NP-05）。
// 打包 → 白名单 → 仓库外隔离安装 → --version → 无头 stream-json 真跑 → 台账 prepared 校验。
// 不发布、不写 registry、不触碰用户数据。
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const product = join(root, 'src', 'tui')
const packageJson = JSON.parse(readFileSync(join(product, 'package.json'), 'utf8'))
const ledger = JSON.parse(readFileSync(join(root, 'release-ledger.json'), 'utf8'))

const requiredDist = [
  'dist/tui/cli.js',
  'dist/tui/headless.js',
  'dist/tui/mcp/client.js',
  'dist/tui/hooks/runner.js',
  'dist/tui/commands/registry.js',
  'dist/tui/keybindings/resolver.js',
  'dist/tui/project-instructions.js',
  'dist/provider/web-fetch.js'
]

function npmCli() {
  const candidate = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (!existsSync(candidate)) throw new Error('Cannot locate the npm CLI entry')
  return candidate
}

function npm(args, cwd) {
  return execFileSync(process.execPath, [npmCli(), ...args], {
    encoding: 'utf8',
    cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function runNode(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
    let out = ''
    let err = ''
    child.stdout.on('data', (data) => { out += data })
    child.stderr.on('data', (data) => { err += data })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out, err }))
  })
}

async function main() {
  const prepared = ledger.releases.filter((entry) => entry.version === packageJson.version)
  assert.equal(prepared.length, 1, '当前版本必须恰好一条台账记录')
  assert.equal(prepared[0].status, 'prepared')
  assert.equal(prepared[0].iteration, 'SP006')
  console.log('ledger: PASS', packageJson.version, prepared[0].iteration, prepared[0].status)

  const notes = readFileSync(join(root, 'release-notes', 'v' + packageJson.version + '.md'), 'utf8')
  assert.doesNotMatch(notes, /replace this draft/, '发布说明仍是模板草稿')
  console.log('release notes: PASS', packageJson.version)

  const workspace = mkdtempSync(join(tmpdir(), 'budingx-sp006-pack-'))
  try {
    const packOutput = JSON.parse(
      npm(['pack', '--json', '--ignore-scripts', '--pack-destination', workspace], product)
    )
    const packed = Array.isArray(packOutput) ? packOutput[0] : Object.values(packOutput)[0]
    assert.ok(packed && Array.isArray(packed.files), 'unexpected npm pack output')
    const tarball = join(workspace, packed.filename)
    const files = packed.files.map((file) => file.path)
    const allowedRoots = new Set(['package.json', 'README.md', 'LICENSE'])
    const unexpected = files.filter(
      (file) => !allowedRoots.has(file) && !(file.startsWith('dist/') && file.endsWith('.js'))
    )
    assert.deepEqual(unexpected, [], 'tarball 含非白名单文件')
    for (const required of requiredDist) assert.ok(files.includes(required), '缺少制品文件：' + required)
    assert.ok(files.every((file) => !file.endsWith('.map')), '制品不得包含源码映射')
    console.log('tarball: PASS', packed.filename, files.length, 'files')

    const installDir = join(workspace, 'install')
    mkdirSync(installDir, { recursive: true })
    npm(['init', '-y'], installDir)
    npm(['install', tarball, '--no-audit', '--no-fund'], installDir)
    const installed = join(installDir, 'node_modules', 'budingx')
    const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
    const cli = join(installed, 'dist', 'tui', 'cli.js')
    const version = (await runNode([cli, '--version'], { cwd: installDir })).out.trim()
    assert.equal(version, manifest.version)
    assert.equal(manifest.version, packageJson.version)
    console.log('isolated install: PASS', version)

    const calls = []
    const server = createServer(async (req, res) => {
      let body = ''
      for await (const chunk of req) body += chunk
      calls.push(JSON.parse(body).messages)
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(
        'data: {"choices":[{"delta":{"content":"sp006-installed-ok"}}]}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
        'data: [DONE]\n\n'
      )
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const home = join(workspace, 'home')
    mkdirSync(home, { recursive: true })
    try {
      const result = await runNode(
        [cli, '--prompt', 'installation test', '--output-format', 'stream-json'],
        {
          cwd: installDir,
          env: {
            ...process.env,
            BUDINGX_BASE_URL: 'http://127.0.0.1:' + server.address().port + '/v1',
            BUDINGX_MODEL: 'installed-fixture',
            BUDINGX_API_KEY: 'fixture-key',
            HOME: home,
            USERPROFILE: home
          }
        }
      )
      assert.equal(result.code, 0, result.err)
      assert.doesNotMatch(result.out, /\u001b\[/)
      const events = result.out.trim().split('\n').map((line) => JSON.parse(line))
      assert.equal(events[0].type, 'system')
      assert.equal(events[0].subtype, 'init')
      assert.equal(events.at(-1).type, 'result')
      assert.equal(events.at(-1).subtype, 'success')
      assert.equal(events.at(-1).is_error, false)
      assert.equal(events.at(-1).num_turns, 1)
      assert.equal(
        events.filter((event) => event.type === 'assistant' && event.delta)
          .map((event) => event.message.content).join(''),
        'sp006-installed-ok'
      )
      assert.equal(calls.length, 1)
      assert.equal(existsSync(join(home, '.budingx', 'sessions')), false, '无头运行不得写会话数据')
      console.log('headless stream-json: PASS', events.length, 'events; no user data written')
    } finally {
      server.closeAllConnections()
      server.close()
    }

    const dryRun = npm(['publish', tarball, '--dry-run', '--ignore-scripts', '--json'], installDir)
    const published = JSON.parse(dryRun)
    assert.ok(published && (published.id || published.filename || published.name), 'dry-run 输出异常')
    console.log('publish --dry-run: PASS (no upload)')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error.stdout ?? '')
  console.error(error.stderr ?? '')
  console.error(error.message)
  process.exitCode = 1
})
