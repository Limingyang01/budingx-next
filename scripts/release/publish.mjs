// Publishing entry point (SP009 design D-1). The orchestration lives in
// publish-core.mjs so that every branch can be tested with an injected npm
// runner; this file only wires the real npm client and the exit code.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { npm } from './process.mjs'
import { runPublish } from './publish-core.mjs'
import { parseReleaseOptions, validatePublishContext } from './options.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

try {
  const options = parseReleaseOptions(process.argv.slice(2))
  validatePublishContext(options, process.env)
  const { report, exitCode } = await runPublish({
    root,
    options,
    env: process.env,
    npm,
    log: (message) => console.log(message)
  })
  if (exitCode !== 0) {
    const failure = report.failure || {}
    console.error(
      `Release failed at ${report.state}: ${failure.message || 'unknown failure'}`
    )
    if (failure.guidance) console.error(failure.guidance)
    process.exitCode = 1
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
