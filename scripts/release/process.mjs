import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options })
    let out = '',
      err = ''
    child.stdout?.on('data', (chunk) => {
      out += chunk
    })
    child.stderr?.on('data', (chunk) => {
      err += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ out, err })
      else
        reject(
          Object.assign(new Error(`Command failed with exit code ${code}`), {
            code,
            out,
            err
          })
        )
    })
    if (options.input !== undefined) child.stdin?.end(options.input)
  })
}

/**
 * Locate the npm CLI. `npm_execpath` is set for scripts started through
 * `npm run`; the sibling lookup keeps the release scripts runnable as plain
 * `node scripts/release/*.mjs` too.
 */
export function npmCli() {
  if (process.env.npm_execpath) return process.env.npm_execpath
  const candidate = path.join(
    path.dirname(process.execPath),
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js'
  )
  if (existsSync(candidate)) return candidate
  throw new Error(
    'Cannot locate the npm CLI entry; run this command through npm run'
  )
}

export function npm(args, options = {}) {
  const { cache, ...rest } = options
  if (!cache) return run(process.execPath, [npmCli(), ...args], rest)
  // npm options must precede the `--` separator that starts the command.
  const separator = args.indexOf('--')
  const head = separator === -1 ? args : args.slice(0, separator)
  const tail = separator === -1 ? [] : args.slice(separator)
  return run(
    process.execPath,
    [npmCli(), ...head, '--cache', cache, ...tail],
    rest
  )
}
