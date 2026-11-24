import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateCheckpointTasks } from './lib/tasks.mjs'
import { repoRoot } from './lib/util.mjs'

try {
  const [, , flag, set, ...rest] = process.argv
  if (flag !== '--set' || set !== 'cp-v1' || rest.length !== 0) {
    throw new Error('Usage: node scripts/eval/validate.mjs --set cp-v1')
  }
  const root = repoRoot()
  const path = join(root, 'scripts', 'eval', 'tasks', 'set-cp-v1.json')
  const { errors, summary } = validateCheckpointTasks(JSON.parse(readFileSync(path, 'utf8')), root)
  if (errors.length > 0) throw new Error(errors.join('\n'))
  console.log('CP-SET-v1: ' + summary.total + ' tasks and ' + summary.blind + ' blind tasks verified')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
