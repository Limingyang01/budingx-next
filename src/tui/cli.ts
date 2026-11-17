#!/usr/bin/env node
// budingx entry point (SP002 design §3.1/§3.6).
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { render } from 'ink'
import { Session } from '../core/session.js'
import { ConfigStore } from '../storage/config-store.js'
import { CredentialStore } from '../storage/credentials.js'
import { mergeSources, profileHost, type ResolvedConfig } from '../storage/profiles.js'
import { App } from './app.js'
import { createConfiguredSession } from './runtime.js'
import { InkApprovalGateway } from './approval.js'
import { runCommand } from './commands.js'

function readProductVersion(): string {
  let dir = new URL('.', import.meta.url)
  for (let depth = 0; depth < 8; depth++) {
    try {
      const parsed = JSON.parse(readFileSync(new URL('package.json', dir), 'utf8')) as {
        name?: string
        version?: string
      }
      if (parsed.name === 'budingx' && parsed.version) return parsed.version
    } catch {
      // keep walking up
    }
    dir = new URL('../', dir)
  }
  return '0.0.0'
}

const version = readProductVersion()
const help = `budingx ${version} — independent terminal coding agent (preview)
Usage: budingx [--model NAME] [--base-url URL] [--timeout MS] [--prompt TEXT]
Environment: BUDINGX_API_KEY, BUDINGX_MODEL, BUDINGX_BASE_URL
Commands: /help /config /models /model NAME /provider add|edit|rm|check|key|default|tools|orphans /clear /exit
Keys: Esc interrupts a running turn, Enter submits, Ctrl+C interrupts and exits.
Coding tools land in later releases; this build ships the model and session core.`

type Stores = {
  configStore: ConfigStore
  credentialStore: CredentialStore
  file: {
    profileId?: string
    baseUrl?: string
    model?: string
    apiKey?: string
  }
}

function loadStores(): Stores {
  const configStore = new ConfigStore()
  const credentialStore = new CredentialStore()
  const stored = configStore.load()
  const orphanCount = credentialStore.orphanIds(stored.models.map((p) => p.id)).length
  if (orphanCount)
    process.stderr.write(
      `Orphan credentials: ${orphanCount}; use /provider orphans [clean]\n`
    )
  const profile =
    stored.models.find((entry) => entry.id === stored.defaultModelId) ?? stored.models[0]
  const file = profile
    ? {
        profileId: profile.id,
        baseUrl: profile.baseUrl,
        model: profile.model,
        apiKey: credentialStore.get(profile.id, profileHost(profile))
      }
    : {}
  return { configStore, credentialStore, file }
}

/** Run one turn and stream the answer as plain text. */
function runTurn(session: Session, text: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const off = session.on((event) => {
      if (event.type === 'text_delta') process.stdout.write(event.text)
      if (event.type === 'turn_finalized') {
        off()
        if (event.outcome === 'error' && event.error) {
          process.stderr.write(`Error: ${event.error.message}\n`)
          resolve(1)
          return
        }
        resolve(0)
      }
    })
    session.submit(text)
  })
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

async function runPipe(config: ResolvedConfig, stores: Stores): Promise<number> {
  let current = config
  const session = createConfiguredSession(
    () => current,
    {
      async request() {
        return { outcome: 'deny', via: 'policy' }
      }
    },
    stores.configStore
  )
  const input = await readStdin()
  let code = 0
  for (const rawLine of input.split('\n')) {
    const text = rawLine.trim()
    if (!text) continue
    if (text === '/exit' || text === '/quit') break
    if (text.startsWith('/')) {
      const outcome = await runCommand(text, {
        session,
        configStore: stores.configStore,
        credentialStore: stores.credentialStore,
        getConfig: () => current,
        setConfig: (next) => {
          current = next
        },
        exit: () => {}
      })
      if (outcome.keyRequest) {
        process.stderr.write('Error: Key entry requires an interactive terminal\n')
        code = 1
      }
      if (outcome.error) {
        code = 1
        process.stderr.write(`Error: ${outcome.error}\n`)
      } else if (outcome.message) process.stdout.write(`${outcome.message}\n`)
      continue
    }
    if (!current.model.trim()) {
      process.stderr.write(
        'Error: Set BUDINGX_MODEL or use /model <name> before sending a prompt\n'
      )
      code = 1
      break
    }
    const turnCode = await runTurn(session, text)
    process.stdout.write('\n')
    if (turnCode !== 0) code = turnCode
  }
  session.dispose()
  return code
}

async function runInteractive(config: ResolvedConfig, stores: Stores): Promise<void> {
  const gateway = new InkApprovalGateway()
  let current = config
  const session = createConfiguredSession(() => current, gateway, stores.configStore)

  const instance = render(
    createElement(App, {
      session,
      gateway,
      commandContext: {
        configStore: stores.configStore,
        credentialStore: stores.credentialStore,
        getConfig: () => current,
        setConfig: (next: ResolvedConfig) => {
          current = next
        },
        exit: () => {
          instance.unmount()
        }
      },
      version,
      cwd: process.cwd(),
      onExit: () => {
        instance.unmount()
      }
    }),
    { exitOnCtrlC: false }
  )
  await instance.waitUntilExit()
  session.dispose()
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 1 && ['--version', '-v'].includes(args[0])) {
    process.stdout.write(`${version}\n`)
    return
  }
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(`${help}\n`)
    return
  }

  let stores: Stores
  try {
    stores = loadStores()
  } catch (error) {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : 'configuration unreadable'}\n`
    )
    process.exitCode = 1
    return
  }

  let config: ResolvedConfig
  try {
    config = mergeSources({ args, env: process.env, file: stores.file })
  } catch (error) {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : 'invalid configuration'}\n`
    )
    process.exitCode = 1
    return
  }

  if (config.prompt !== undefined) {
    if (!config.model.trim()) {
      process.stderr.write(
        'Error: Set BUDINGX_MODEL or use /model <name> before sending a prompt\n'
      )
      process.exitCode = 1
      return
    }
    const session = createConfiguredSession(
      () => config,
      {
        async request() {
          return { outcome: 'deny', via: 'policy' }
        }
      },
      stores.configStore
    )
    const code = await runTurn(session, config.prompt)
    process.stdout.write('\n')
    session.dispose()
    process.exitCode = code
    return
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.exitCode = await runPipe(config, stores)
    return
  }

  await runInteractive(config, stores)
}

main().catch((error) => {
  process.stderr.write(
    `Error: ${error instanceof Error ? error.message : 'budingx failed'}\n`
  )
  process.exitCode = 1
})
