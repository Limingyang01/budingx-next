/** Option names accepted by the publishing entry point. */
export const RELEASE_OPTION_NAMES = ['--tag', '--auth-mode', '--expected-version']

export function parseReleaseOptions(args) {
  const options = {
    dryRun: false,
    tag: 'latest',
    authMode: 'session',
    expectedVersion: undefined
  }
  const names = {
    '--tag': 'tag',
    '--auth-mode': 'authMode',
    '--expected-version': 'expectedVersion'
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      options.dryRun = true
      continue
    }
    const name = names[args[i]]
    const value = args[++i]
    if (!name || !value || value.startsWith('--'))
      throw new Error('Invalid release option or missing value')
    options[name] = value
  }
  if (!['session', 'oidc'].includes(options.authMode))
    throw new Error('Use session or oidc authentication')
  if (
    options.expectedVersion !== undefined &&
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/.test(
      options.expectedVersion
    )
  )
    throw new Error('Invalid expected version')
  return options
}

export function validatePublishContext(options, env) {
  if (options.authMode === 'session') {
    if ((env.CI || env.GITHUB_ACTIONS === 'true') && !options.dryRun)
      throw new Error('CI publishing must explicitly use OIDC')
    return
  }
  if (!options.expectedVersion)
    throw new Error('OIDC publishing requires an expected version')
  const expected = {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'Limingyang01/budingx-next',
    GITHUB_REF: 'refs/heads/master',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_WORKFLOW_REF:
      'Limingyang01/budingx-next/.github/workflows/publish-tui.yml@refs/heads/master',
    RUNNER_ENVIRONMENT: 'github-hosted'
  }
  for (const [name, value] of Object.entries(expected)) {
    if (env[name] !== value)
      throw new Error(
        `OIDC publishing requires the approved GitHub context: ${name}`
      )
  }
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)
    throw new Error('GitHub OIDC permission id-token: write is required')
  if (env.NODE_AUTH_TOKEN || env.NPM_TOKEN)
    throw new Error('OIDC publishing must not receive an npm token')
}
