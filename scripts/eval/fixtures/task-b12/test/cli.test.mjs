import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

test('greet subcommand prints a greeting', () => {
  const out = execFileSync(process.execPath, ['cli.mjs', 'greet', 'budingx'], {
    cwd: new URL('..', import.meta.url).pathname.replace(/\/$/, ''),
    encoding: 'utf8'
  })
  assert.match(out, /hello budingx/)
})
