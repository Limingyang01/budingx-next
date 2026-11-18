#!/usr/bin/env node
// budingx entry point (SP002 design §3.1/§3.6).
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { render } from 'ink'
import { ConfigStore } from '../storage/config-store.js'
import { CredentialStore } from '../storage/credentials.js'
import { mergeSources, profileCredentialBinding, profileCredentialRef, startupProfile, type ResolvedConfig } from '../storage/profiles.js'
import { MODES_EN, MODES_ZH } from '../workspace/policy.js'
import type { PermissionMode } from '../core/permissions.js'
import { App } from './app.js'
import { createAgentRuntime, workspacePromptOptions, type AgentRuntime } from './runtime.js'
import type { CommandContext } from './commands.js'
import { InkApprovalGateway } from './approval.js'
import { runCommand } from './commands.js'
import { terminalStrategy } from './render/header.js'

const MODE_ORDER: PermissionMode[] = ['read_only', 'workspace_edit', 'full_access']

function permissionContext(
  runtime: AgentRuntime
): NonNullable<CommandContext['permission']> {
  return {
    policy: runtime.policy,
    setMode: runtime.setPermissionMode,
    store: runtime.permissionStore,
    workspace: runtime.workspace,
    checkpointChanges: () => runtime.checkpoint.changes(),
    undo: (path?: string) =>
      path
        ? runtime.checkpoint.undoPath(runtime.workspace, path)
        : runtime.checkpoint.undoTurn(runtime.workspace),
    denials: () => runtime.denials,
    modes: { order: MODE_ORDER, zh: MODES_ZH, en: MODES_EN }
  }
}

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
const help = `budingx ${version} — independent terminal coding agent
Usage: budingx [--model NAME] [--base-url URL] [--timeout MS] [--prompt TEXT]
Environment: BUDINGX_API_KEY, BUDINGX_MODEL, BUDINGX_BASE_URL
Commands: /help /config /models /model NAME
  /permission [read|workspace|full] /rules [add|rm] /diff [path] /undo [path] /denials /clear /exit
Keys: Esc interrupts, Shift+Tab switches Allow edits / Full auto in the TUI,
Enter submits, Ctrl+C interrupts and exits. @path attaches a workspace file, Tab completes.
File tools run under the permission modes; full access never overrides deny rules or credential protection.`

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
  const orphanCount = credentialStore.orphanIds(stored.models.map(profileCredentialRef)).length
  if (orphanCount)
    process.stderr.write(
      `Orphan credentials: ${orphanCount}; use O in the interactive /models panel\n`
    )
  const profile = startupProfile(stored)
  const file = profile
    ? {
        profileId: profile.id,
        baseUrl: profile.baseUrl,
        model: profile.model,
        apiKey: credentialStore.get(profileCredentialRef(profile), profileCredentialBinding(profile))
      }
    : {}
  return { configStore, credentialStore, file }
}

/** Run one turn and stream the answer as plain text. */
function runTurn({ session, workspace, policy }: AgentRuntime, text: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const off = session.on((event) => {
      if (event.type === 'text_delta') process.stdout.write(event.text)
      if (event.type === 'notice' && event.code === 'file_context') process.stderr.write(event.text + '\n')
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
    session.submit(text, workspacePromptOptions(text, workspace, policy))
  })
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

async function runPipe(config: ResolvedConfig, stores: Stores): Promise<number> {
  let current = config
  // Non-interactive runs keep the conservative default: read_only mode
  // answers reads and refuses writes before any approval could be asked.
  const runtime = createAgentRuntime({
    cwd: process.cwd(),
    getConfig: () => current,
    approval: {
      async request() {
        return { outcome: 'deny', via: 'policy' }
      }
    },
    configStore: stores.configStore,
    mode: 'read_only'
  })
  const session = runtime.session
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
        exit: () => {},
        permission: permissionContext(runtime)
      })
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
    const turnCode = await runTurn(runtime, text)
    process.stdout.write('\n')
    if (turnCode !== 0) code = turnCode
  }
  session.dispose()
  return code
}

async function runInteractive(config: ResolvedConfig, stores: Stores): Promise<void> {
  const gateway = new InkApprovalGateway()
  let current = config
  const runtime = createAgentRuntime({
    cwd: process.cwd(),
    getConfig: () => current,
    approval: gateway,
    configStore: stores.configStore,
    persistPermissionMode: true
  })
  for (const warning of runtime.warnings) {
    process.stderr.write(`Warning: ${warning}\n`)
  }
  const session = runtime.session

  const fullScreen = process.env.TERM !== 'dumb' &&
    terminalStrategy(process.env, process.platform) === 'pixel'
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
        },
        permission: permissionContext(runtime)
      },
      version,
      cwd: process.cwd(),
      fullScreen,
      onExit: () => {
        instance.unmount()
      }
    }),
    { exitOnCtrlC: false, alternateScreen: fullScreen }
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
    const runtime = createAgentRuntime({
      cwd: process.cwd(),
      getConfig: () => config,
      approval: {
        async request() {
          return { outcome: 'deny', via: 'policy' }
        }
      },
      configStore: stores.configStore,
      mode: 'read_only'
    })
    const code = await runTurn(runtime, config.prompt)
    process.stdout.write('\n')
    runtime.session.dispose()
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
