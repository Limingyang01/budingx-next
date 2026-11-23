import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { runPublish } from './publish-core.mjs'

const VERSION = '1.2.3'

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'budingx-publish-'))
  const product = path.join(root, 'src', 'tui')
  mkdirSync(path.join(product, 'dist', 'tui'), { recursive: true })
  writeFileSync(
    path.join(product, 'package.json'),
    JSON.stringify(
      {
        name: 'budingx',
        version: VERSION,
        license: 'MIT',
        bin: { budingx: 'dist/tui/cli.js' },
        engines: { node: '>=22.18.0' },
        dependencies: { ink: '8.0.0' }
      },
      null,
      2
    )
  )
  writeFileSync(path.join(product, 'README.md'), '# budingx\n')
  writeFileSync(path.join(product, 'LICENSE'), 'MIT\n')
  writeFileSync(path.join(product, 'dist', 'tui', 'cli.js'), 'console.log("cli")\n')
  writeFileSync(
    path.join(root, 'release-ledger.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        releases: [
          { version: '1.2.2', iteration: 'SP008', status: 'published' },
          { version: VERSION, iteration: 'SP009', status: 'prepared' }
        ]
      },
      null,
      2
    )
  )
  mkdirSync(path.join(root, 'release-notes'), { recursive: true })
  writeFileSync(
    path.join(root, 'release-notes', `v${VERSION}.md`),
    [
      `# v${VERSION} · SP009`,
      '',
      '## 变更',
      '- 发布链路可判定',
      '',
      '## 兼容性',
      '- 无破坏性变化',
      '',
      '## 升级',
      '- `npm install -g budingx@latest`',
      '',
      '## 已知限制',
      '- 未验证 macOS',
      '',
      '## 验证',
      '- `npm test` 通过'
    ].join('\n')
  )
  return root
}

function npmError(code, message) {
  return Object.assign(new Error(message || `npm error code ${code}`), {
    code,
    err: `npm error code ${code}`
  })
}

function fakeNpm() {
  const calls = []
  const runner = async (args) => {
    calls.push(args)
    const command = args[0]
    const handler = runner.handlers[command]
    if (handler) {
      const result = await handler(args, calls.length)
      if (result instanceof Error) throw result
      if (result !== undefined) return { out: result, err: '' }
    }
    if (command === 'test') return { out: '', err: '' }
    if (command === 'pack') {
      const destination = args[args.indexOf('--pack-destination') + 1]
      const filename = `budingx-${VERSION}.tgz`
      const file = path.join(destination, filename)
      writeFileSync(file, 'fixture-tarball')
      const digest = createHash('sha512')
        .update(readFileSync(file))
        .digest('base64')
      return {
        out: JSON.stringify([
          {
            filename,
            integrity: 'sha512-' + digest,
            files: [
              { path: 'package.json' },
              { path: 'README.md' },
              { path: 'LICENSE' },
              { path: 'dist/tui/cli.js' }
            ]
          }
        ]),
        err: ''
      }
    }
    if (command === 'install') return { out: '', err: '' }
    if (command === 'exec') return { out: VERSION, err: '' }
    if (command === 'view') return { out: '', err: '' }
    if (command === 'publish') return { out: '', err: '' }
    if (command === 'whoami') return { out: 'maintainer', err: '' }
    return { out: '', err: '' }
  }
  runner.calls = calls
  runner.handlers = {}
  return runner
}

function tarballIntegrity(runner) {
  const packCall = runner.calls.find((args) => args[0] === 'pack')
  const destination = packCall[packCall.indexOf('--pack-destination') + 1]
  const file = path.join(destination, `budingx-${VERSION}.tgz`)
  return (
    'sha512-' + createHash('sha512').update(readFileSync(file)).digest('base64')
  )
}

const smoke = async () => ({ version: VERSION, fixtureRequests: 1 })
const ledgerOf = (root) =>
  JSON.parse(readFileSync(path.join(root, 'release-ledger.json'), 'utf8'))

test('dry-run runs the gate, packs and installs the tarball without touching the registry', async () => {
  const root = fixture()
  try {
    const npm = fakeNpm()
    const result = await runPublish({
      root,
      options: {
        dryRun: true,
        tag: 'latest',
        authMode: 'session',
        expectedVersion: VERSION
      },
      npm,
      smoke
    })
    assert.equal(result.exitCode, 0)
    assert.equal(result.report.state, 'dry-run-complete')
    const commands = npm.calls.map((args) => args[0])
    assert.ok(commands.includes('test'), 'the gate must run')
    assert.ok(commands.includes('pack'), 'the tarball must be packed')
    assert.ok(commands.includes('install'), 'the tarball must be installed')
    assert.ok(commands.includes('exec'), 'the command entry must be verified')
    assert.ok(!commands.includes('publish'), 'dry-run must never publish')
    assert.ok(!commands.includes('whoami'), 'dry-run must not authenticate')
    assert.equal(
      ledgerOf(root).releases.find((entry) => entry.version === VERSION).status,
      'prepared',
      'dry-run must not update the ledger'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failing gate stops the release before any upload', async () => {
  const root = fixture()
  try {
    const npm = fakeNpm()
    npm.handlers.test = () => npmError('EFAIL', 'gate failed')
    const result = await runPublish({
      root,
      options: {
        dryRun: false,
        tag: 'latest',
        authMode: 'session',
        expectedVersion: VERSION
      },
      npm,
      smoke
    })
    assert.equal(result.exitCode, 1)
    assert.equal(result.report.failure.kind, 'gate')
    assert.ok(!npm.calls.some((args) => args[0] === 'publish'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an existing remote version is refused instead of uploaded again', async () => {
  const root = fixture()
  try {
    const npm = fakeNpm()
    npm.handlers.view = () => VERSION
    const result = await runPublish({
      root,
      options: {
        dryRun: false,
        tag: 'latest',
        authMode: 'session',
        expectedVersion: VERSION
      },
      npm,
      smoke
    })
    assert.equal(result.exitCode, 1)
    assert.equal(result.report.failure.kind, 'conflict')
    assert.ok(!npm.calls.some((args) => args[0] === 'publish'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a permission failure during upload is classified and never retried', async () => {
  const root = fixture()
  try {
    const npm = fakeNpm()
    npm.handlers.view = () => npmError('E404', 'not found')
    npm.handlers.publish = () =>
      npmError('E403', 'You do not have permission to publish')
    const result = await runPublish({
      root,
      options: {
        dryRun: false,
        tag: 'latest',
        authMode: 'session',
        expectedVersion: VERSION
      },
      npm,
      smoke
    })
    assert.equal(result.exitCode, 1)
    assert.equal(result.report.failure.kind, 'permission')
    assert.equal(npm.calls.filter((args) => args[0] === 'publish').length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an uncertain upload keeps the receipt state and asks for a remote query', async () => {
  const root = fixture()
  try {
    const npm = fakeNpm()
    npm.handlers.view = () => npmError('E404', 'not found')
    const result = await runPublish({
      root,
      options: {
        dryRun: false,
        tag: 'latest',
        authMode: 'session',
        expectedVersion: VERSION
      },
      npm,
      smoke,
      waitForRegistry: async () => {
        throw new Error(
          'Upload was accepted but the version is not publicly visible yet; do not publish again.'
        )
      }
    })
    assert.equal(result.exitCode, 1)
    assert.equal(result.report.state, 'uploaded-awaiting-receipt')
    assert.match(result.report.failure.message, /resolve|query/i)
    assert.equal(npm.calls.filter((args) => args[0] === 'publish').length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a complete publication updates the ledger and the report state', async () => {
  const root = fixture()
  try {
    const npm = fakeNpm()
    let viewCalls = 0
    npm.handlers.view = () => {
      viewCalls++
      if (viewCalls === 1) throw npmError('E404', 'not found')
      return JSON.stringify({
        version: VERSION,
        dist: { integrity: tarballIntegrity(npm) },
        'dist-tags': { latest: VERSION }
      })
    }
    const result = await runPublish({
      root,
      options: {
        dryRun: false,
        tag: 'latest',
        authMode: 'session',
        expectedVersion: VERSION
      },
      npm,
      smoke
    })
    assert.equal(result.exitCode, 0)
    assert.equal(result.report.state, 'published-and-installed')
    const entry = ledgerOf(root).releases.find((item) => item.version === VERSION)
    assert.equal(entry.status, 'published')
    assert.equal(entry.integrity, tarballIntegrity(npm))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release notes without the required sections block the release', async () => {
  const root = fixture()
  try {
    writeFileSync(
      path.join(root, 'release-notes', `v${VERSION}.md`),
      `# v${VERSION} · SP009\n\n## 变更\n- 少量变更\n`
    )
    const npm = fakeNpm()
    const result = await runPublish({
      root,
      options: {
        dryRun: true,
        tag: 'latest',
        authMode: 'session',
        expectedVersion: VERSION
      },
      npm,
      smoke
    })
    assert.equal(result.exitCode, 1)
    assert.match(result.report.failure.message, /missing required sections/i)
    assert.ok(!npm.calls.some((args) => args[0] === 'test'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a prerelease version is refused on the latest channel', async () => {
  const root = fixture()
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(root, 'src', 'tui', 'package.json'), 'utf8')
    )
    manifest.version = '1.2.3-beta.1'
    writeFileSync(
      path.join(root, 'src', 'tui', 'package.json'),
      JSON.stringify(manifest, null, 2)
    )
    const ledger = ledgerOf(root)
    ledger.releases[ledger.releases.length - 1].version = '1.2.3-beta.1'
    writeFileSync(
      path.join(root, 'release-ledger.json'),
      JSON.stringify(ledger, null, 2)
    )
    const npm = fakeNpm()
    const result = await runPublish({
      root,
      options: {
        dryRun: true,
        tag: 'latest',
        authMode: 'session',
        expectedVersion: '1.2.3-beta.1'
      },
      npm,
      smoke
    })
    assert.equal(result.exitCode, 1)
    assert.match(result.report.failure.message, /prerelease/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
