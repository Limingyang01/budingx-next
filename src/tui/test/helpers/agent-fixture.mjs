// Shared fixture for SP003 end-to-end tests: real workspace, real policy,
// real checkpoint store, scripted provider. The only fake is the model —
// everything else touches actual files, exactly as the product would.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspace } from '../../dist/workspace/paths.js'
import { createWorkspaceTools } from '../../dist/workspace/tools.js'
import { MODES_EN, MODES_ZH, createPermissionPolicy } from '../../dist/workspace/policy.js'
import { PermissionsStore } from '../../dist/storage/permissions.js'

export const SNAPSHOT = {
  modelId: 'm1',
  model: 'test-model',
  baseUrlHost: 'api.example.test',
  capabilities: { tools: true }
}

export function scriptProvider(script) {
  const calls = []
  const provider = {
    async *stream(request) {
      calls.push(request)
      const events = script.shift() ?? [
        { type: 'message_completed', finishReason: 'stop' }
      ]
      for (const event of events) yield event
    }
  }
  return { provider, calls }
}

export function toolTurn(name, args) {
  return [
    [
      {
        type: 'tool_call_delta',
        index: 0,
        callId: 'call_' + Math.random().toString(36).slice(2, 8),
        nameDelta: name,
        argsDelta: JSON.stringify(args)
      },
      { type: 'message_completed', finishReason: 'tool_calls' }
    ],
    [{ type: 'text_delta', text: 'ok' }, { type: 'message_completed', finishReason: 'stop' }]
  ]
}

export function agentFixture(options = {}) {
  const base = mkdtempSync(join(tmpdir(), 'budingx-agent-'))
  const root = join(base, 'workspace')
  mkdirSync(root)
  const userRoot = join(base, '.budingx')
  mkdirSync(userRoot)
  const workspace = createWorkspace(root)
  const { tools, checkpoint } = createWorkspaceTools(workspace)
  const denials = []
  const policy = createPermissionPolicy({
    workspace,
    dataRootOverride: userRoot,
    mode: options.mode ?? 'workspace_edit',
    autoAcceptWorkspaceEdits: options.autoAcceptWorkspaceEdits,
    ...(options.rules ? { rules: options.rules } : {})
  })
  const store = new PermissionsStore(join(base, 'permissions.json'))
  const permission = {
    policy,
    store,
    workspace,
    checkpointChanges: () => checkpoint.changes(),
    undo: (path) =>
      path ? checkpoint.undoPath(workspace, path) : checkpoint.undoTurn(workspace),
    denials: () => denials,
    modes: {
      order: ['read_only', 'workspace_edit', 'full_access'],
      zh: MODES_ZH,
      en: MODES_EN
    }
  }
  // The runtime collects denial records from session events; tests call
  // this after mountTty created the session.
  const attach = (session) => {
    session.on((event) => {
      if (event.type === 'denial_recorded') denials.push(event.denial)
    })
  }
  const writeSeedFile = (name, content) => {
    const full = join(root, name)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return { base, root, workspace, tools, checkpoint, policy, permission, denials, attach, writeSeedFile }
}
