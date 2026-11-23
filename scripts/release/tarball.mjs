// Shared tarball checks (SP009 design D-1/D-3).
//
// The publishing gate and the lifecycle gate must agree on what a release
// tarball may contain, so both use these helpers.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const allowedRoots = new Set(['package.json', 'README.md', 'LICENSE'])
const credentialPattern =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|npm_[A-Za-z0-9]{30,}|sk-proj-[A-Za-z0-9_-]{25,}/

/** Files that may ship in the public package. */
export function assertPackedFiles(packed) {
  if (!packed || !Array.isArray(packed.files))
    throw new Error('Unexpected npm pack output')
  const unexpected = packed.files.filter((file) => {
    if (allowedRoots.has(file.path)) return false
    return !(file.path.startsWith('dist/') && file.path.endsWith('.js'))
  })
  if (unexpected.length > 0)
    throw new Error(
      'Unexpected files in product tarball: ' +
        unexpected.map((file) => file.path).join(', ')
    )
  if (!packed.files.some((file) => file.path === 'dist/tui/cli.js'))
    throw new Error('Product tarball is missing dist/tui/cli.js')
  return packed.files.map((file) => file.path)
}

/** Refuse to ship credentials that ended up inside the package sources. */
export function scanForCredentials(productDirectory, files) {
  for (const file of files) {
    const contents = readFileSync(`${productDirectory}/${file}`, 'utf8')
    if (credentialPattern.test(contents))
      throw new Error('Possible credential in product package')
  }
}

export function tarballIntegrity(file) {
  return (
    'sha512-' + createHash('sha512').update(readFileSync(file)).digest('base64')
  )
}
