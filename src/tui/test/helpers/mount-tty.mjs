// Shared pseudo-TTY harness for in-process Ink end-to-end tests.
// Methodology: skills/buding-frontend-testing/SKILL.md (§TUI 帧级端到端).
// Real ink render() + real App/Session/approval gateway; stdin/stdout are
// PassThrough streams marked isTTY so Ink takes the interactive path and we
// capture exactly the ANSI frame bytes a terminal would receive. No native
// pty dependency; IME/preedit and real console rendering stay human-only.
import { PassThrough } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createElement } from 'react'
import { Session } from '../../dist/core/session.js'
import { InkApprovalGateway } from '../../dist/tui/approval.js'
import { ConfigStore } from '../../dist/storage/config-store.js'
import { CredentialStore } from '../../dist/storage/credentials.js'

// Deterministic truecolor so color assertions are possible in CI.
process.env.FORCE_COLOR = '3'
// Chalk reads color capability at module initialization, so pin before Ink/App.
const { render } = await import('ink')
const { App } = await import('../../dist/tui/app.js')

const pause = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))

export function fixtureStores() {
  const root = mkdtempSync(join(tmpdir(), 'budingx-tty-'))
  return {
    root,
    configStore: new ConfigStore(join(root, 'config.json')),
    credentialStore: new CredentialStore(join(root, 'credentials.json'))
  }
}

export async function mountTty(t, options = {}) {
  const {
    provider,
    tools = [],
    permissionPolicy,
    config: initialConfig,
    commandOverrides = {},
    sessionFactory,
    columns = 100,
    rows = 40,
    fullScreen = false,
    strategy = 'pixel',
    onExit = () => {}
  } = options
  // Pin the terminal strategy: the test runner has no modern-terminal env,
  // so without an explicit override the product would (correctly) fall back
  // to ASCII. Tests must state which terminal they simulate.
  const savedPixel = process.env.BUDINGX_FORCE_PIXEL_LOGO
  const savedAscii = process.env.BUDINGX_FORCE_ASCII_LOGO
  if (strategy === 'ascii') {
    process.env.BUDINGX_FORCE_ASCII_LOGO = '1'
    delete process.env.BUDINGX_FORCE_PIXEL_LOGO
  } else {
    process.env.BUDINGX_FORCE_PIXEL_LOGO = '1'
    delete process.env.BUDINGX_FORCE_ASCII_LOGO
  }
  t.after(() => {
    if (savedPixel === undefined) delete process.env.BUDINGX_FORCE_PIXEL_LOGO
    else process.env.BUDINGX_FORCE_PIXEL_LOGO = savedPixel
    if (savedAscii === undefined) delete process.env.BUDINGX_FORCE_ASCII_LOGO
    else process.env.BUDINGX_FORCE_ASCII_LOGO = savedAscii
  })
  const stores = fixtureStores()
  const gateway = new InkApprovalGateway()
  let config = {
    baseUrl: 'https://fixture.invalid/v1',
    model: '',
    apiKey: '',
    timeoutMs: 2000,
    source: 'env',
    ...initialConfig
  }
  const session = sessionFactory
    ? sessionFactory({ ...stores, gateway, getConfig: () => config })
    : new Session({
        provider,
        tools,
        ...(permissionPolicy ? { permissionPolicy } : {}),
        approval: gateway,
        resolveSnapshot: () => ({
          modelId: config.profileId ?? 'session',
          model: config.model,
          baseUrlHost: (() => {
            try {
              return new URL(config.baseUrl).host
            } catch {
              return ''
            }
          })(),
          capabilities: { tools: tools.length > 0 }
        })
      })

  const stdin = new PassThrough()
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  const stdout = new PassThrough()
  stdout.columns = columns
  stdout.rows = rows
  stdout.isTTY = true

  let raw = ''
  const frames = []
  stdout.on('data', (chunk) => {
    raw += chunk
    const clean = stripVTControlCharacters(chunk.toString())
    if (clean.trim()) frames.push(clean)
  })

  const exitCalls = []
  const app = render(
    createElement(App, {
      session,
      gateway,
      version: '0.1.1',
      cwd: 'D:\\fixture\\repo',
      fullScreen,
      commandContext: {
        ...stores,
        getConfig: () => config,
        setConfig: (next) => {
          config = next
        },
        exit: () => exitCalls.push('command'),
        ...commandOverrides
      },
      onExit: () => {
        exitCalls.push('app')
        onExit()
      }
    }),
    {
      stdin,
      stdout,
      stderr: stdout,
      interactive: true,
      alternateScreen: fullScreen,
      exitOnCtrlC: false,
      patchConsole: false
    }
  )
  t.after(() => {
    app.unmount()
    session.dispose()
    stdin.destroy()
    stdout.destroy()
  })
  await pause()
  await app.waitUntilRenderFlush()

  const last = () => frames[frames.length - 1] ?? ''
  return {
    ...stores,
    gateway,
    session,
    stdout,
    stdin,
    exitCalls,
    raw: () => raw,
    frames: () => frames,
    last,
    config: () => config,
    send: async (text) => {
      // Deliver keys the way a terminal does: printable runs and control
      // sequences as separate reads. A combined "abc\r" chunk loses the
      // Enter in Ink's keypress parser.
      const pieces = text.match(
        /\x1b\[[0-9;]*[A-Za-z~]|[\x00-\x1f]|[^\x00-\x1f\x1b]+/g
      ) ?? [text]
      for (const piece of pieces) {
        stdin.write(piece)
        await pause(10)
      }
      await pause()
      await app.waitUntilRenderFlush()
    },
    waitFor: async (predicate, timeoutMs = 3000) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        await app.waitUntilRenderFlush()
        if (predicate(last(), frames)) return last()
        await pause(20)
      }
      throw new Error(`waitFor timed out; last frame:\n${last()}`)
    },
    resize: async (nextColumns, nextRows = stdout.rows) => {
      stdout.columns = nextColumns
      stdout.rows = nextRows
      stdout.emit('resize')
      await pause()
      await app.waitUntilRenderFlush()
    }
  }
}

/** Display-width of every line of a captured frame (CJK-aware). */
export function frameWidths(frame, stringWidth) {
  return frame.split('\n').map((line) => stringWidth(line))
}
