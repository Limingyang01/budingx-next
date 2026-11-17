// Isolated installation smoke for the product tarball (SP002 AC TC-08).
// Packs src/tui, installs the tarball outside the repository and runs the
// installed binary against a local fixture server. Never publishes.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const product = join(root, 'src', 'tui')

function npmCli() {
  const candidate = join(
    dirname(process.execPath),
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js'
  )
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
    const child = spawn(process.execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (data) => {
      out += data
    })
    child.stderr.on('data', (data) => {
      err += data
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out, err }))
  })
}

async function main() {
  const workspace = mkdtempSync(join(tmpdir(), 'budingx-pack-'))
  try {
    const packOutput = JSON.parse(
      npm(['pack', '--json', '--ignore-scripts', '--pack-destination', workspace], product)
    )
    const packed = Array.isArray(packOutput)
      ? packOutput[0]
      : Object.values(packOutput)[0]
    if (!packed || !Array.isArray(packed.files))
      throw new Error('Unexpected npm pack output')
    const tarball = join(workspace, packed.filename)
    const files = packed.files.map((file) => file.path)
    console.log('tarball:', packed.filename)
    console.log('files:', files.length)

    const allowedRoots = new Set(['package.json', 'README.md', 'LICENSE'])
    const unexpected = files.filter(
      (file) =>
        !allowedRoots.has(file) &&
        !(file.startsWith('dist/') && file.endsWith('.js'))
    )
    assert.deepEqual(unexpected, [], 'unexpected files in the tarball')
    assert.ok(files.includes('dist/tui/cli.js'), 'the CLI entry must be packed')

    const installDir = join(workspace, 'install')
    mkdirSync(installDir, { recursive: true })
    npm(['init', '-y'], installDir)
    npm(['install', tarball, '--no-audit', '--no-fund'], installDir)

    const installed = join(installDir, 'node_modules', 'budingx')
    const manifest = JSON.parse(
      readFileSync(join(installed, 'package.json'), 'utf8')
    )
    const cli = join(installed, 'dist', 'tui', 'cli.js')
    const version = (await runNode([cli, '--version'], { cwd: installDir })).out.trim()
    assert.equal(version, manifest.version)
    console.log('installed version:', version)

    let calls = 0
    const server = createServer(async (req, res) => {
      let body = ''
      for await (const chunk of req) body += chunk
      const request = JSON.parse(body)
      assert.equal(request.model, 'installed-fixture')
      assert.equal(request.messages.at(-1).content, 'installation test')
      calls++
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(
        'data: {"choices":[{"delta":{"content":"installed-stream-ok"}}]}\n\ndata: [DONE]\n\n'
      )
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const result = await runNode([cli, '--prompt', 'installation test'], {
        cwd: installDir,
        env: {
          ...process.env,
          BUDINGX_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
          BUDINGX_MODEL: 'installed-fixture',
          BUDINGX_API_KEY: ''
        }
      })
      assert.equal(result.code, 0, result.err)
      assert.match(result.out, /installed-stream-ok/)
      assert.equal(calls, 1)
    } finally {
      server.closeAllConnections()
      server.close()
    }

    console.log('isolated install smoke: PASS')
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
