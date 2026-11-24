import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { cli, spawnServe, startFixtureServer } from './helpers/host-process.mjs'
import { createProfile } from '../dist/storage/profiles.js'
import { ConfigStore } from '../dist/storage/config-store.js'
import { remotePeer } from './helpers/sp009-mcp-peer.mjs'

const stdioPeer = fileURLToPath(new URL('./helpers/sp009-mcp-peer.mjs', import.meta.url))

async function until(predicate, timeout = 20000) {
  const end = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > end) assert.fail('MCP entry point timed out')
    await delay(35)
  }
}

for (const entry of ['TUI', 'headless', 'serve']) {
  test('AC-MCP-01 ' + entry + ' entry loads all four configured transports', async (t) => {
    const home = mkdtempSync(join(tmpdir(), 'budingx-sp009-entry-'))
    t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
    const provider = await startFixtureServer(t)
    const dir = join(home, '.budingx')
    mkdirSync(dir)
    const profile = createProfile({
      label: 'fixture',
      baseUrl: provider.baseUrl,
      model: 'fixture',
      tools: true
    })
    new ConfigStore(join(dir, 'config.json')).save({
      version: 1,
      models: [profile],
      defaultModelId: profile.id
    })
    const mcpServers = { stdio: { command: process.execPath, args: [stdioPeer] } }
    for (const type of ['http', 'sse', 'ws']) {
      const peer = await remotePeer(t, type)
      mcpServers[type] = { type, url: peer.url }
    }
    writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ mcpServers }))

    if (entry === 'serve') {
      const proc = spawnServe(t, {
        args: ['--transport', 'stdio', '--session', 'mcp-entry'],
        baseUrl: provider.baseUrl,
        home
      })
      await proc.ready
      const { client } = await proc.connect()
      await client.request('submit', { text: 'hello' })
      await until(() => provider.requests.length)
      await client.request('shutdown')
      assert.equal((await proc.closed).code, 0)
    } else {
      // Force the actual CLI's interactive entry and Ink rendering onto test pipes.
      const preload = `for(const stream of [process.stdin,process.stdout])stream.isTTY=true;process.stdin.setRawMode=()=>{};process.stdout.columns=100;process.stdout.rows=40;`
      const args =
        entry === 'TUI'
          ? ['--import', 'data:text/javascript,' + encodeURIComponent(preload), cli]
          : [cli, '--prompt', 'hello', '--output-format', 'stream-json']
      const child = spawn(process.execPath, args, {
        cwd: home,
        windowsHide: true,
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          BUDINGX_MODEL: 'fixture',
          BUDINGX_API_KEY: 'fixture',
          BUDINGX_BASE_URL: provider.baseUrl,
          CI: 'false',
          TERM: 'xterm-256color',
          BUDINGX_FORCE_ASCII_LOGO: '1'
        }
      })
      t.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill()
      })
      const closed = once(child, 'close')
      let output = '',
        error = ''
      child.stdout.on('data', (chunk) => {
        output += chunk
      })
      child.stderr.on('data', (chunk) => {
        error += chunk
      })
      if (entry === 'TUI') {
        await until(() => stripVTControlCharacters(output).includes('fixture') || child.exitCode !== null)
        assert.equal(child.exitCode, null, error)
        await delay(100)
        child.stdin.write('hello')
        await delay(50)
        child.stdin.write('\r')
        await until(() => provider.requests.length)
        await until(() => stripVTControlCharacters(output).includes('pong'))
        child.stdin.write('/exit')
        await delay(60)
        child.stdin.write('\r')
      } else child.stdin.end()
      const [code] = await closed
      assert.equal(code, 0, error)
    }
    const names = provider.requests[0].tools.map((tool) => tool.function.name)
    for (const type of Object.keys(mcpServers)) {
      assert.ok(names.includes('mcp__' + type + '__echo'), type + ' tool')
      assert.ok(names.includes('mcp__' + type + '__read_resource'), type + ' resource')
    }
  })
}
