import { spawn } from 'node:child_process'

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
export function npm(args, options = {}) {
  if (!process.env.npm_execpath)
    throw new Error('Run this command through npm run')
  return run(process.execPath, [process.env.npm_execpath, ...args], options)
}
