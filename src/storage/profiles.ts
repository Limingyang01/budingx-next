export type Config = {
  baseUrl: string
  model: string
  apiKey: string
  timeoutMs: number
  prompt?: string
}

export function normalizeBaseUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('Invalid base URL')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Base URL must not contain credentials, query or fragment')
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new Error(
      'Use HTTPS (HTTP is allowed only for explicit loopback endpoints)'
    )
  return url.toString().replace(/\/+$/, '')
}

export function loadConfig(args: string[], env: NodeJS.ProcessEnv): Config {
  const config: Config = {
    baseUrl: env.BUDINGX_BASE_URL || 'https://api.openai.com/v1',
    model: env.BUDINGX_MODEL || '',
    apiKey: env.BUDINGX_API_KEY || '',
    timeoutMs: 120000
  }
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (!['--base-url', '--model', '--timeout', '--prompt'].includes(flag))
      throw new Error('Unknown option; use --help')
    const value = args[++i]
    if (!value || value.startsWith('--'))
      throw new Error('Option requires a value')
    if (flag === '--base-url') config.baseUrl = value
    if (flag === '--model') config.model = value
    if (flag === '--timeout') config.timeoutMs = Number(value)
    if (flag === '--prompt') config.prompt = value
  }
  config.baseUrl = normalizeBaseUrl(config.baseUrl)
  if (
    !Number.isSafeInteger(config.timeoutMs) ||
    config.timeoutMs < 1 ||
    config.timeoutMs > 600000
  )
    throw new Error('Timeout must be 1–600000 milliseconds')
  if (config.model.length > 256 || /[\r\n\x00-\x1f]/.test(config.model))
    throw new Error('Invalid model name')
  if (/[\r\n]/.test(config.apiKey)) throw new Error('Invalid API key')
  return config
}
