import { setTimeout as pause } from 'node:timers/promises'

export async function waitForRegistryVersion(
  read,
  version,
  {
    attempts = 31,
    intervalMs = 10000,
    sleep = pause,
    onPending = () => {}
  } = {}
) {
  if (
    !Number.isSafeInteger(attempts) ||
    attempts < 1 ||
    !Number.isFinite(intervalMs) ||
    intervalMs < 0
  )
    throw new Error('Invalid registry polling limits')
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const metadata = await read()
      if (metadata?.version === version) return metadata
      throw Object.assign(new Error('Version has not propagated'), {
        code: 'EREGISTRYPENDING'
      })
    } catch (error) {
      const details = `${error.code || ''} ${error.err || ''}`
      if (
        !/\b(E404|ETARGET|ENOVERSIONS|EREGISTRYPENDING|EAI_AGAIN|ECONNRESET|ETIMEDOUT|E502|E503)\b/.test(
          details
        )
      )
        throw error
      if (attempt === attempts)
        throw new Error(
          'Upload was accepted but the version is not publicly visible yet; do not publish again. Inspect the saved receipt and npm processing status.',
          { cause: error }
        )
      onPending(attempt, attempts)
      await sleep(intervalMs)
    }
  }
}
